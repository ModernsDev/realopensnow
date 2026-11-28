use anyhow::Result;
use jiff::Timestamp;
use realopensnow::{catalog::catalog, time::*};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    process::Command,
};

fn read(path: &str) -> Value {
    serde_json::from_slice(
        &fs::read(format!(
            "{}/tests/fixtures/{path}",
            env!("CARGO_MANIFEST_DIR")
        ))
        .unwrap(),
    )
    .unwrap()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NodeCalendar {
    node_tzdb: String,
    jiff_tzdb: String,
    zones: BTreeMap<String, Vec<[i64; 5]>>,
    half_hour_windows: BTreeMap<String, Window>,
}

#[test]
fn calendar_parity() -> Result<()> {
    let output = Command::new("node")
        .arg("tests/parity/timezone.mjs")
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()?;
    anyhow::ensure!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let node: NodeCalendar = serde_json::from_slice(&output.stdout)?;
    let index = read("recorded/index.json");
    for page in index["page"].as_array().unwrap() {
        if let Some(tz) = page["custom"]["timezone"].as_str() {
            let now = index["recordedAt"].as_i64().unwrap();
            assert_eq!(
                forecast_window(now, tz, 8, 16)?,
                node.half_hour_windows[page["file"].as_str().unwrap()]
            );
        }
    }
    let zones: BTreeSet<_> = catalog()
        .resorts
        .iter()
        .map(|r| r.timezone.as_str())
        .collect();
    assert!(
        zones
            .iter()
            .copied()
            .eq(node.zones.keys().map(String::as_str))
    );
    let first = "2026-01-01T00:00:00Z"
        .parse::<Timestamp>()?
        .as_millisecond();
    let mut entries = Vec::new();
    for (timezone, days) in node.zones {
        assert_eq!(days.len(), 730);
        for (i, expected) in days.into_iter().enumerate() {
            let midnight = first + i as i64 * 86_400_000;
            let iso = iso_ms(midnight)?;
            let date = &iso[..10];
            let win = forecast_window(midnight + 43_200_000, &timezone, 8, 16)?;
            let [day, night, end] = period_endpoints(date, &timezone)?;
            assert!([day, night, end].iter().all(|ms| ms % 1000 == 0));
            let actual = [win.start, win.end, day / 1000, night / 1000, end / 1000];
            if actual != expected {
                entries
                    .push(json!({"timezone":timezone,"date":date,"node":expected,"jiff":actual}));
            }
        }
    }
    let actual = json!({"nodeTzdb":node.node_tzdb,"jiffTzdb":node.jiff_tzdb,"entries":entries});
    if std::env::var("UPDATE_TZ_DIFFERENCES").as_deref() == Ok("1") {
        fs::write(
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/fixtures/expected/tz-differences.json"
            ),
            format!("{actual}\n"),
        )?;
    }
    assert_eq!(actual, read("expected/tz-differences.json"));
    Ok(())
}

#[test]
fn open_meteo_recorded_endpoints() -> Result<()> {
    let index = read("recorded/index.json");
    let now = index["recordedAt"].as_i64().unwrap();
    for page in index["page"].as_array().unwrap() {
        let file = page["file"].as_str().unwrap();
        let raw = read(&format!("recorded/{file}"));
        let tz = page["custom"]["timezone"].as_str().unwrap_or_else(|| {
            let (resort, _) = catalog().point(page["point"].as_str().unwrap()).unwrap();
            &resort.timezone
        });
        let window = forecast_window(now, tz, 8, 16)?;
        let times = raw["hourly"]["time"].as_array().unwrap();
        assert_eq!(times[0], window.start, "{file}");
        let last = times.last().unwrap().as_i64().unwrap();
        let request = request_zone(tz, now)?;
        assert_eq!(raw["timezone"], request);
        if request == tz {
            assert_eq!(last, window.end, "{file}");
        } else {
            assert!(last >= window.end, "{file}");
        }
    }
    Ok(())
}

fn ms(at: &str) -> i64 {
    at.parse::<Timestamp>().unwrap().as_millisecond()
}

#[test]
fn civil_dates_and_expiry() -> Result<()> {
    let data = json!({"fetched":"2026-11-17T09:00:00Z","timezone":"UTC","dates":["2026-11-17"]});
    assert!(!forecast_expired(&data, ms("2026-11-17T14:59:59Z"))?);
    assert!(forecast_expired(&data, ms("2026-11-17T15:00:00Z"))?);
    let data = json!({"fetched":"2026-11-18T06:59:59Z","timezone":"America/Denver","dates":["2026-11-17"]});
    assert!(forecast_expired(&data, ms("2026-11-18T07:00:00Z"))?);
    Ok(())
}

#[test]
fn whole_half_and_repeated_hours() -> Result<()> {
    let now = ms("2026-11-28T00:50:00Z");
    for (tz, start, end) in [
        (
            "America/St_Johns",
            "2026-11-19T03:00:00Z",
            "2026-12-13T02:00:00Z",
        ),
        (
            "America/Los_Angeles",
            "2026-11-19T08:00:00Z",
            "2026-12-13T07:00:00Z",
        ),
    ] {
        assert_eq!(
            forecast_window(now, tz, 8, 16)?,
            Window {
                start: ms(start) / 1000,
                end: ms(end) / 1000
            }
        );
    }
    for (date, count) in [("2026-03-01T12:00:00Z", 575), ("2026-10-25T12:00:00Z", 577)] {
        let window = forecast_window(ms(date), "America/New_York", 8, 16)?;
        assert_eq!((window.end - window.start) / 3600 + 1, count);
    }
    for (tz, at, expected) in [
        ("America/St_Johns", now, "Etc/GMT+3"),
        ("America/St_Johns", ms("2026-07-01T12:00:00Z"), "Etc/GMT+2"),
        ("Asia/Kolkata", now, "Etc/GMT-6"),
        ("America/New_York", now, "America/New_York"),
        ("UTC", now, "UTC"),
    ] {
        assert_eq!(request_zone(tz, at)?, expected);
    }
    assert_eq!(
        in_zone(
            json!({"timezone":"Etc/GMT+3", "x":1}),
            "Etc/GMT+3",
            "America/St_Johns"
        ),
        json!({"timezone":"America/St_Johns","x":1})
    );
    assert_eq!(
        in_zone(
            json!({"timezone":"Etc/GMT+4"}),
            "Etc/GMT+3",
            "America/St_Johns"
        ),
        json!({"timezone":"Etc/GMT+4"})
    );
    for hour in [5, 6] {
        assert!(ambiguous(
            ms(&format!("2026-11-01T0{hour}:00:00Z")) / 1000,
            "America/New_York"
        )?);
    }
    assert_eq!(
        iso_ms(ms("2026-11-28T00:20:00Z"))?,
        "2026-11-28T00:20:00.000Z"
    );
    Ok(())
}

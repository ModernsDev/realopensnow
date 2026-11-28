mod common;

use anyhow::Result;
use common::{assert_json, fixture};
use realopensnow::accuracy::{
    Snapshot, hourly_snow, observation_window, paired_snow, parse_reports, reports_url,
    select_snapshots, station_hour, summarize_accuracy,
};
use realopensnow::catalog::catalog;
use realopensnow::snapshot::{manual_snapshot, snapshot_request};
use realopensnow::time::iso_ms;
use serde_json::{Value, json};

fn check_selection(
    snapshots: &[Snapshot],
    reports: &[Value],
    now: i64,
    expected: &Value,
) -> Result<()> {
    let selection = select_snapshots(snapshots, &catalog().waterbury, now);
    let ids: Vec<_> = selection.iter().map(|snapshot| snapshot.id).collect();
    assert_eq!(json!(ids), expected["ids"]);
    assert_json(
        &summarize_accuracy(&selection, reports, now)?,
        &expected["summary"],
    );
    assert_eq!(reports_url(35), expected["reportsUrl"]);
    Ok(())
}

#[test]
fn recorded_waterbury_history() -> Result<()> {
    let now = fixture("recorded/index.json")["recordedAt"]
        .as_i64()
        .unwrap();
    let snapshots: Vec<Snapshot> =
        serde_json::from_value(fixture("recorded/waterbury-snapshots.json"))?;
    let reports = parse_reports(200, include_bytes!("fixtures/recorded/cocorahs.json"))?;
    assert_json(
        &json!(reports),
        &fixture("recorded/cocorahs.json")["results"],
    );
    check_selection(
        &snapshots,
        &reports,
        now,
        &fixture("expected/accuracy.json")["recorded"],
    )
}

#[test]
fn exact_station_windows_and_model_leads() -> Result<()> {
    let case = &fixture("expected/accuracy.json")["synthetic"];
    let reports = case["reports"].as_array().unwrap();
    let mut snapshots: Vec<Snapshot> = serde_json::from_value(case["snapshots"].clone())?;
    let now = case["now"].as_i64().unwrap();
    let ranked: Vec<Snapshot> = serde_json::from_value(case["ranked"].clone())?;
    check_selection(&ranked, reports, now, &case["selection"])?;
    let threshold = &case["threshold"];
    let daily: Vec<Snapshot> = serde_json::from_value(threshold["snapshots"].clone())?;
    assert_json(
        &summarize_accuracy(
            &daily.iter().collect::<Vec<_>>(),
            threshold["reports"].as_array().unwrap(),
            now,
        )?,
        &threshold["summary"],
    );
    assert_json(
        &summarize_accuracy(&snapshots.iter().collect::<Vec<_>>(), reports, now)?,
        &case["summary"],
    );
    for test in case["windows"].as_array().unwrap() {
        assert_json(
            &observation_window(&test["row"], Some(&test["previous"])),
            &test["window"],
        );
    }
    assert!(station_hour("2026-11-01T01:00:00+00:00").is_none());
    assert!(station_hour("2026-03-08T02:00:00+00:00").is_none());
    assert!(station_hour("2026-11-16T06:00:00.+00:00").is_none());
    for test in case["pairs"].as_array().unwrap() {
        snapshots[2].query = test["query"].clone();
        let error = paired_snow(
            &snapshots[2],
            test["model"].as_u64().unwrap() as usize,
            &test["window"],
        );
        assert_json(&json!(error), &test["error"]);
    }
    Ok(())
}

#[test]
fn manual_snapshots_use_request_zone_and_reject_redirects() -> Result<()> {
    for case in fixture("expected/accuracy.json")["manualSnapshots"]
        .as_array()
        .unwrap()
    {
        let (resort, point) = catalog().point(case["point"].as_str().unwrap()).unwrap();
        let mut data = fixture(&format!("recorded/{}", case["file"].as_str().unwrap()));
        data["elevation"] = json!(point.elevation);
        let from = case["from"].as_u64().unwrap() as usize;
        let until = case["until"].as_u64().unwrap() as usize;
        for col in data["hourly"].as_object_mut().unwrap().values_mut() {
            *col = Value::Array(col.as_array().unwrap()[from..until].to_vec());
        }
        let now = case["now"].as_i64().unwrap();
        let request = snapshot_request(resort, point, now)?;
        assert_eq!(request.source, case["source"]);
        assert_eq!(request.redirect, case["redirect"]);
        let status = case["status"].as_u64().unwrap() as u16;
        let result = manual_snapshot(
            &request,
            status,
            data,
            resort,
            point,
            &iso_ms(now)?,
            &iso_ms(now + 173)?,
        );
        if status == 302 {
            assert_eq!(result.unwrap_err().to_string(), "Open-Meteo HTTP 302");
        } else {
            assert_json(&serde_json::to_value(result?)?, &case["content"]);
        }
    }
    Ok(())
}

#[test]
fn reports_and_hourly_measurements_reject_invalid_values() {
    for case in fixture("expected/accuracy.json")["failures"]
        .as_array()
        .unwrap()
    {
        let result = parse_reports(
            case["status"].as_u64().unwrap() as u16,
            &serde_json::to_vec(&case["body"]).unwrap(),
        );
        assert_eq!(result.unwrap_err().to_string(), case["error"]);
    }
    assert!(parse_reports(200, b"invalid JSON").is_err());
    let hourly = hourly_snow(&json!({
        "hourly": {"time": [3600,7200,10800], "snowfall_ecmwf_ifs025":[0,-1,"2"], "snowfall_gfs_seamless":[1], "snowfall_icon_seamless":[1,2,3]},
        "hourly_units":{"snowfall_ecmwf_ifs025":"cm", "snowfall_gfs_seamless":"cm", "snowfall_icon_seamless":"mm"}
    }));
    assert_json(&hourly["values"][0], &json!([0, null, null]));
    assert!(
        hourly["values"].as_array().unwrap()[1..]
            .iter()
            .all(Value::is_null)
    );
}

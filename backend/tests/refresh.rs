mod common;

use anyhow::Result;
use realopensnow::catalog::{Point, Resort, catalog};
use realopensnow::ready::{ReadyRow, latest_forecast};
use realopensnow::refresh::{Outcome, PayloadWrite, PointRow, apply, plan};
use serde_json::{Value, json};

use common::assert_json;

fn read(scenario: &str) -> Value {
    common::fixture(&format!("expected/refresh-{scenario}.json"))
}

fn ready(
    row: Option<&PointRow>,
    payload: Option<&Value>,
    catalog_point: (&Resort, &Point),
    now: i64,
) -> Result<Value> {
    let row = row.map(|row| ReadyRow {
        config: row.config.as_deref(),
        state: &row.state,
        built_date: row.built_date.as_deref(),
        payload,
    });
    Ok(latest_forecast(row, catalog_point, now)?.unwrap_or(Value::Null))
}

fn replay(scenario: &str) -> Result<()> {
    let fixture = read(scenario);
    let value = |reference: &Value| -> &Value {
        reference
            .as_u64()
            .map_or(&Value::Null, |i| &fixture["values"][i as usize])
    };
    let point = catalog().point(fixture["point"].as_str().unwrap()).unwrap();
    let mut row: Option<PointRow> = None;
    let mut payload: Option<Value> = None;
    for round in fixture["rounds"].as_array().unwrap() {
        eprintln!("{scenario}: {}", round["name"]);
        let now = round["now"].as_i64().unwrap();
        let metas = serde_json::from_value(round["metas"].clone())?;
        if let Some(row) = &mut row {
            if round["staleConfig"] == true {
                row.config = Some("stale".into());
            }
            if round["staleDate"] == true {
                row.built_date = Some("2026-01-01".into());
            }
            if round["unbuilt"] == true {
                row.built = false;
                payload = None;
            }
        }
        assert_json(
            &ready(row.as_ref(), payload.as_ref(), point, now)?,
            value(&round["before"]),
        );
        let next = plan(row.as_ref(), point.0, point.1, &metas, now)?;
        assert_eq!(json!(next.request), round["request"]);
        let outcome = match &round["response"] {
            Value::Number(_) => Outcome::Ok(value(&round["response"]).clone()),
            status if status == "limited" => Outcome::Limited,
            status if status == "failed" || status.is_null() => Outcome::Failed,
            _ => panic!("invalid fixture response"),
        };
        let c = apply(next, outcome, &metas, round["slot"].as_i64(), now)?;
        let version = row.as_ref().map_or(0, |r| r.version);
        assert_eq!(c.expected_version, version);
        assert_eq!(
            json!(c.result(c.expected_version == version)),
            round["result"]
        );
        assert_eq!(c.config, round["config"]);
        assert_eq!(c.state, round["state"]);
        assert_json(&c.series, value(&round["series"]));
        assert_json(&json!(c.snapshot), &round["snapshot"]);
        let mut built_date = row.as_ref().and_then(|r| r.built_date.clone());
        match c.payload {
            PayloadWrite::Keep => assert_eq!(round["write"], "keep"),
            PayloadWrite::Clear => {
                assert_eq!(round["write"], "clear");
                built_date = None;
                payload = None;
            }
            PayloadWrite::Set {
                built_date: date,
                payload: new,
            } => {
                assert_eq!(round["write"], "set");
                built_date = Some(date);
                payload = Some(new);
            }
        }
        assert_eq!(json!(built_date), round["built_date"]);
        assert_eq!(version + 1, round["version"]);
        assert_json(
            payload.as_ref().unwrap_or(&Value::Null),
            value(&round["payload"]),
        );
        row = Some(PointRow {
            version: version + 1,
            config: Some(c.config),
            state: c.state,
            series: c.series,
            built_date,
            built: payload.is_some(),
        });
        assert_json(
            &ready(row.as_ref(), payload.as_ref(), point, now)?,
            value(&round["latest"]),
        );
    }
    Ok(())
}

#[test]
fn recorded_multiround_forecasts() -> Result<()> {
    for scenario in ["waterbury", "alta", "niseko", "invalid"] {
        replay(scenario)?;
    }
    Ok(())
}

#[test]
fn whole_half_and_fall_back_request_hours() -> Result<()> {
    for scenario in ["stowe-base", "marble", "fall-back"] {
        replay(scenario)?;
    }
    Ok(())
}

#[test]
fn stored_ts_payload_drops_legacy_report() -> Result<()> {
    let fixture = read("stowe-base");
    let r = &fixture["rounds"][0];
    let now = r["now"].as_i64().unwrap();
    let mut payload = fixture["values"][r["payload"].as_u64().unwrap() as usize].clone();
    payload["report"] = json!({"blocked":"legacy"});
    let row = ReadyRow {
        config: r["config"].as_str(),
        state: &r["state"],
        built_date: r["built_date"].as_str(),
        payload: Some(&payload),
    };
    let latest = latest_forecast(Some(row), catalog().point("stowe-base").unwrap(), now)?.unwrap();
    assert_json(
        &latest,
        &fixture["values"][r["latest"].as_u64().unwrap() as usize],
    );
    Ok(())
}

#[test]
fn version_token_retained_from_read_through_apply() -> Result<()> {
    let fixture = read("stowe-base");
    let round = &fixture["rounds"][0];
    let now = round["now"].as_i64().unwrap();
    let (r, p) = catalog().point("stowe-base").unwrap();
    let metas = serde_json::from_value(round["metas"].clone())?;
    let data = &fixture["values"][round["response"].as_u64().unwrap() as usize];
    let a = plan(None, r, p, &metas, now)?;
    let b = plan(None, r, p, &metas, now)?;
    let first = apply(a, Outcome::Ok(data.clone()), &metas, Some(now), now)?;
    let next_version = first.expected_version + 1;
    let stale = apply(b, Outcome::Ok(data.clone()), &metas, Some(now), now)?;
    assert!(
        !stale
            .result(stale.expected_version == next_version)
            .committed
    );
    assert_eq!(first.expected_version, stale.expected_version);
    Ok(())
}

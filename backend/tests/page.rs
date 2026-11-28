mod common;

use common::{assert_json, fixture};
use jiff::Timestamp;
use realopensnow::{
    aggregate::{
        PageQuery, aggregate_hourly, aggregate_periods, forecast_batch, number_string,
        page_forecast, page_forecast_for, page_source_for, read_hourly, slice_period,
    },
    catalog::catalog,
    models::MODELS,
    time::{forecast_dates, forecast_expired, past_dates},
};
use serde_json::{Value, json};
use std::collections::HashMap;

fn edit(data: &mut Value, edits: &Value) {
    for e in edits.as_array().unwrap() {
        let key = e[1].as_str().unwrap();
        match e[0].as_str().unwrap() {
            "shift" => {
                for t in data["hourly"]["time"].as_array_mut().unwrap() {
                    *t = (t.as_i64().unwrap() + e[2].as_i64().unwrap()).into();
                }
            }
            "zone" => data["timezone"] = key.into(),
            "remove" => {
                data["hourly"].as_object_mut().unwrap().remove(key);
            }
            "unit" => data["hourly_units"][key] = e[3].clone(),
            "fill" => data["hourly"][key].as_array_mut().unwrap()
                [e[2].as_u64().unwrap() as usize..]
                .fill(e[3].clone()),
            "set" => data["hourly"][key][e[2].as_u64().unwrap() as usize] = e[3].clone(),
            op => panic!("unknown fixture edit {op}"),
        }
    }
}

fn fixed(value: Option<f64>) -> String {
    let Some(n) = value else { return "—".into() };
    let scaled = n * 10.0;
    let lo = scaled.floor();
    number_string((lo + if scaled - lo >= 0.5 { 1.0 } else { 0.0 }) / 10.0)
}

fn snow(value: Option<f64>, divisor: f64) -> String {
    let Some(n) = value else { return "—".into() };
    let n = n / divisor;
    let bits = n.abs().to_bits();
    let exponent = ((bits >> 52) as i32).max(1) - 1023 - 52;
    let mantissa = u128::from((bits & ((1 << 52) - 1)) + if bits >> 52 == 0 { 0 } else { 1 << 52 });
    let scaled = mantissa * 10;
    let rounded = if exponent >= 0 {
        scaled << exponent
    } else if exponent <= -127 {
        0
    } else {
        (scaled + (1 << (-exponent - 1))) >> -exponent
    };
    format!(
        "{}{}.{}",
        if n < 0.0 { "-" } else { "" },
        rounded / 10,
        rounded % 10
    )
}

fn formatted(n: Option<f64>) -> Value {
    json!({"fixed":fixed(n), "snow":[snow(n,1.0),snow(n,2.54)], "temp":[fixed(n),fixed(n.map(|x|x*9.0/5.0+32.0))]})
}

fn compare_formats(actual: &Value, expected: &Value, formats: &HashMap<Option<u64>, Value>) {
    for (series, expected) in [
        (actual, expected),
        (&actual["extended"], &expected["extended"]),
        (&actual["past"], &expected["past"]),
        (&actual["periods"], &expected["periods"]),
    ] {
        assert!(
            series["daily"]
                .as_object()
                .unwrap()
                .keys()
                .eq(expected["daily"].as_object().unwrap().keys())
        );
        for (key, column) in series["daily"].as_object().unwrap() {
            for (v, e) in column
                .as_array()
                .unwrap()
                .iter()
                .zip(expected["daily"][key].as_array().unwrap())
            {
                assert_eq!(
                    formatted(v.as_f64()),
                    formats[&e.as_f64().map(f64::to_bits)],
                    "{key}, {v}"
                );
            }
        }
    }
    for series in [actual, &actual["extended"]] {
        assert!(
            series["modelStatus"]
                .as_object()
                .unwrap()
                .keys()
                .map(String::as_str)
                .eq(MODELS)
        );
    }
}

#[test]
fn recorded_pages_and_synthetic_variants() {
    let expected = fixture("expected/pages.json");
    let formats: HashMap<_, _> = expected["formatted"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| {
            let mut row = row.clone();
            let n = row.as_object_mut().unwrap().remove("n").unwrap();
            (n.as_f64().map(f64::to_bits), row)
        })
        .collect();
    for case in expected["cases"].as_array().unwrap() {
        let mut data = fixture(&format!("recorded/{}", case["file"].as_str().unwrap()));
        edit(&mut data, &case["edits"]);
        let query: PageQuery = serde_json::from_value(case["query"].clone()).unwrap();
        let requested = case["requested"].as_str().unwrap();
        let fetched = case["fetched"].as_str().unwrap();
        let result = if case["query"]["resortId"] == "custom-resort" {
            page_forecast_for(&query, &data, requested, fetched)
        } else {
            let (resort, point) = catalog().point(&query.point_id).unwrap();
            page_forecast(&data, resort, point, requested, fetched)
        };
        if case["invalid"] == true {
            assert_eq!(
                result.unwrap_err().to_string(),
                "天气服务的时区或小时时间轴无效",
                "{}",
                case["name"]
            );
        } else {
            let payload = result.unwrap_or_else(|e| panic!("{}: {e}", case["name"]));
            assert_eq!(
                page_source_for(&query, ms(requested)).unwrap(),
                case["payload"]["source"]
            );
            assert_json(&payload, &case["payload"]);
            compare_formats(&payload, &case["payload"], &formats);
        }
    }
}

fn ms(t: &str) -> i64 {
    t.parse::<Timestamp>().unwrap().as_millisecond()
}

fn hours(start: &str, count: i64, zone: &str) -> Value {
    let time: Vec<_> = (0..count + 2)
        .map(|i| ms(start) / 1000 + (i - 1) * 3600)
        .collect();
    let mut result = json!({"timezone":zone,"latitude":40.5,"longitude":-111.75,"elevation":2667,"hourly_units":{"time":"unixtime"},"hourly":{"time":time}});
    for model in MODELS {
        for (field, unit, value) in [
            ("snowfall", "cm", 2.54),
            ("temperature_2m", "°C", -5.),
            ("wind_gusts_10m", "km/h", 30.),
            ("rain", "mm", 1.),
            ("freezing_level_height", "m", 1800.),
        ] {
            let key = format!("{field}_{model}");
            result["hourly_units"][&key] = unit.into();
            result["hourly"][key] = json!(vec![value; time.len()]);
        }
    }
    result
}

const DENVER: &str = "America/Denver";
fn daily(data: &Value, date: &str) -> Value {
    aggregate_hourly(data, &[date.to_owned()], data["timezone"].as_str().unwrap()).unwrap()["daily"]
        .clone()
}

fn fill(data: &mut Value, key: &str, v: Value) {
    data["hourly"][key].as_array_mut().unwrap().fill(v);
}

#[test]
fn resort_dates_and_expiry() {
    assert_eq!(
        forecast_dates("2026-11-17T01:00:00Z", DENVER, 7).unwrap()[0],
        "2026-11-16"
    );
    assert_eq!(
        forecast_dates("2026-11-17T23:00:00Z", "Asia/Tokyo", 7).unwrap()[0],
        "2026-11-18"
    );
    assert_eq!(
        forecast_dates("2026-12-30T23:00:00Z", "Europe/Paris", 7).unwrap()[6],
        "2027-01-06"
    );
    assert_eq!(
        past_dates("2027-01-03T01:00:00Z", DENVER).unwrap(),
        [
            "2026-12-26",
            "2026-12-27",
            "2026-12-28",
            "2026-12-29",
            "2026-12-30",
            "2026-12-31",
            "2027-01-01"
        ]
    );
    let mut raw = hours("2026-10-31T06:00:00Z", 169, DENVER);
    fill(&mut raw, "snowfall_gfs_seamless", 1.into());
    let dates = past_dates("2026-11-07T17:00:00Z", DENVER).unwrap();
    let past = aggregate_hourly(&raw, &dates, DENVER).unwrap();
    assert_eq!(
        past["daily"]["snowfall_sum_gfs_seamless"]
            .as_array()
            .unwrap()
            .iter()
            .map(|n| n.as_f64().unwrap())
            .sum::<f64>(),
        169.
    );
    let mut data =
        json!({"fetched":"2026-11-17T12:00:00Z","dates":["2026-11-17"],"timezone":"Asia/Tokyo"});
    assert!(!forecast_expired(&data, ms("2026-11-17T14:59:59Z")).unwrap());
    assert!(forecast_expired(&data, ms("2026-11-17T15:00:00Z")).unwrap());
    data["timezone"] = DENVER.into();
    assert!(forecast_expired(&data, ms("2026-11-17T18:00:00Z")).unwrap());
}

#[test]
fn dst_day_lengths_and_closing_midnight() {
    for (start, date, count) in [
        ("2026-03-08T08:00:00Z", "2026-03-08", 23),
        ("2026-11-01T07:00:00Z", "2026-11-01", 25),
    ] {
        let mut raw = hours(start, count, DENVER);
        fill(&mut raw, "snowfall_ecmwf_ifs025", 1.into());
        let day = daily(&raw, date);
        assert_json(&day["snowfall_sum_ecmwf_ifs025"], &json!([count]));
        assert_json(&day["temperature_2m_min_ecmwf_ifs025"], &json!([-5]));
        assert_json(&day["wind_gusts_10m_max_ecmwf_ifs025"], &json!([30]));
        raw["hourly"]["snowfall_ecmwf_ifs025"][1] = 10.into();
        assert_json(
            &daily(&raw, date)["snowfall_sum_ecmwf_ifs025"],
            &json!([count + 9]),
        );
    }
    let japan = hours("2026-11-16T16:00:00Z", 24, "Asia/Tokyo");
    assert_json(
        &daily(&japan, "2026-11-17")["snowfall_sum_gfs_seamless"],
        &json!([24. * 2.54]),
    );
    let mut raw = hours("2026-03-08T08:00:00Z", 23, DENVER);
    fill(&mut raw, "snowfall_gfs_seamless", 2.into());
    fill(&mut raw, "temperature_2m_gfs_seamless", (-1).into());
    let h = &mut raw["hourly"];
    h["rain_gfs_seamless"][0] = 100.into();
    h["rain_gfs_seamless"][23] = 3.into();
    h["temperature_2m_gfs_seamless"][0] = Value::Null;
    h["temperature_2m_gfs_seamless"][4] = (-0.9).into();
    h["temperature_2m_gfs_seamless"][23] = 0.into();
    h["snowfall_gfs_seamless"][23] = 5.into();
    h["freezing_level_height_gfs_seamless"][0] = (-50).into();
    h["freezing_level_height_gfs_seamless"][23] = 3000.into();
    let day = daily(&raw, "2026-03-08");
    for (key, n) in [
        ("rain_sum", 25),
        ("wet_snowfall_sum", 7),
        ("freezing_level_height_min", -50),
        ("freezing_level_height_max", 1800),
    ] {
        assert_json(&day[format!("{key}_gfs_seamless")], &json!([n]));
    }
}

#[test]
fn day_night_fields_and_dst_endpoints() {
    let mut raw = hours("2026-11-28T01:00:00Z", 37, DENVER);
    fill(&mut raw, "snowfall_ecmwf_ifs025", 1.into());
    fill(&mut raw, "snowfall_gfs_seamless", 0.into());
    for (key, index, n) in [
        ("snowfall", 13, 2),
        ("snowfall", 14, 3),
        ("snowfall", 25, 5),
        ("temperature_2m", 13, 8),
        ("temperature_2m", 25, 9),
        ("temperature_2m", 26, -10),
        ("freezing_level_height", 13, 500),
        ("freezing_level_height", 25, 3000),
        ("rain", 25, 4),
        ("wind_gusts_10m", 13, 70),
    ] {
        raw["hourly"][format!("{key}_gfs_seamless")][index] = n.into();
    }
    let result =
        aggregate_periods(&raw, &["2026-11-27".into(), "2026-11-28".into()], DENVER).unwrap();
    assert_eq!(
        result["dates"],
        json!([
            "2026-11-27-day",
            "2026-11-27-night",
            "2026-11-28-day",
            "2026-11-28-night"
        ])
    );
    for (key, tail) in [
        ("snowfall_sum_ecmwf_ifs025", [12, 12, 12]),
        ("snowfall_sum_gfs_seamless", [2, 8, 0]),
        ("wet_snowfall_sum_gfs_seamless", [2, 5, 0]),
        ("rain_sum_gfs_seamless", [12, 15, 12]),
        ("wind_gusts_10m_max_gfs_seamless", [70, 30, 30]),
        ("temperature_2m_min_gfs_seamless", [-5, -5, -10]),
        ("temperature_2m_max_gfs_seamless", [-5, 8, 9]),
        ("freezing_level_height_min_gfs_seamless", [1800, 500, 1800]),
        ("freezing_level_height_max_gfs_seamless", [1800, 1800, 3000]),
    ] {
        assert_json(
            &result["daily"][key],
            &json!([null, tail[0], tail[1], tail[2]]),
        );
    }
    for (date, start, end, count) in [
        (
            "2026-03-07",
            "2026-03-08T01:00:00Z",
            "2026-03-08T12:00:00Z",
            11,
        ),
        (
            "2026-10-31",
            "2026-11-01T00:00:00Z",
            "2026-11-01T13:00:00Z",
            13,
        ),
    ] {
        let mut raw = hours(start, count, DENVER);
        fill(&mut raw, "snowfall_gfs_seamless", 1.into());
        let parts = aggregate_periods(&raw, &[date.into()], DENVER).unwrap();
        assert_json(
            &parts["periods"][1],
            &json!({"date":date,"part":"night","start":ms(start),"end":ms(end),"hours":count}),
        );
        assert_json(
            &parts["daily"]["snowfall_sum_gfs_seamless"][1],
            &json!(count),
        );
    }
}

#[test]
fn wrong_zone_axis_and_grid_are_rejected() {
    let mut data = hours("2026-11-28T13:00:00Z", 24, DENVER);
    assert!(read_hourly(&data, "UTC").is_err());
    data["hourly_units"]["time"] = "iso8601".into();
    assert!(read_hourly(&data, DENVER).is_err());
    data["hourly_units"]["time"] = "unixtime".into();
    for times in [
        json!([]),
        json!([null]),
        json!([3601]),
        json!([3600.5]),
        json!([3600, 10800]),
        json!([3600, 3600]),
    ] {
        data["hourly"]["time"] = times;
        assert!(read_hourly(&data, DENVER).is_err());
    }
    let (resort, point) = catalog().point("alta-atwater-1308").unwrap();
    let requested = "2026-11-28T13:00:00Z";
    let valid = hours(requested, 24, DENVER);
    for (key, v) in [
        ("error", json!(true)),
        ("elevation", json!(10)),
        ("latitude", json!(null)),
        ("longitude", json!("40")),
        ("hourly", json!({})),
    ] {
        let mut data = valid.clone();
        data[key] = v;
        assert!(forecast_batch(&data, resort, point, requested, requested, 7).is_err());
    }
}

#[test]
fn incomplete_periods_and_invalid_columns() {
    let mut raw = hours("2026-11-28T14:00:00Z", 11, DENVER);
    fill(&mut raw, "snowfall_gfs_seamless", 0.into());
    raw["hourly"]["snowfall_ecmwf_ifs025"][3] = Value::Null;
    raw["hourly"]["rain_gfs_seamless"][4] = (-1).into();
    let parts = |data: &Value| {
        aggregate_periods(data, &["2026-11-28".into()], DENVER).unwrap()["daily"].clone()
    };
    let out = parts(&raw);
    assert_json(&out["snowfall_sum_gfs_seamless"], &json!([0, null]));
    assert_eq!(out["snowfall_sum_ecmwf_ifs025"], json!([null, null]));
    assert_eq!(out["rain_sum_gfs_seamless"], json!([null, null]));
    edit(&mut raw, &json!([["shift", "time", -3600]]));
    let earlier = parts(&raw);
    assert_eq!(earlier["snowfall_sum_gfs_seamless"][0], Value::Null);
    assert_json(&earlier["temperature_2m_min_gfs_seamless"][0], &json!(-5));

    let mut raw = hours("2026-11-17T08:00:00Z", 24, DENVER);
    let units = &mut raw["hourly_units"];
    units["freezing_level_height_ecmwf_ifs025"] = "undefined".into();
    units["freezing_level_height_icon_seamless"] = "undefined".into();
    units["temperature_2m_icon_seamless"] = "°F".into();
    units["snowfall_gem_global"] = "mm".into();
    units["rain_gfs_seamless"] = "cm".into();
    let h = &mut raw["hourly"];
    h["rain_ecmwf_ifs025"][1] = (-1).into();
    h["temperature_2m_ecmwf_ifs025"][24] = Value::Null;
    h["snowfall_gfs_seamless"][2] = (-1).into();
    h["snowfall_gem_regional"] = json!([3]);
    h["wind_gusts_10m_ncep_nbm_conus"][5] = "NaN".into();
    h.as_object_mut().unwrap().remove("temperature_2m_icon_d2");
    let out = aggregate_hourly(&raw, &["2026-11-17".into()], DENVER).unwrap();
    assert_eq!(out["modelStatus"]["ecmwf_ifs025"], "数据完整");
    let day = &out["daily"];
    for model in ["ecmwf_ifs025", "icon_seamless"] {
        for op in ["min", "max"] {
            assert_eq!(
                day[format!("freezing_level_height_{op}_{model}")],
                json!([null])
            );
        }
    }
    for model in [
        "ecmwf_ifs025",
        "gfs_seamless",
        "icon_seamless",
        "gem_global",
        "icon_d2",
    ] {
        assert_eq!(day[format!("wet_snowfall_sum_{model}")], json!([null]));
    }
    for key in [
        "rain_sum_ecmwf_ifs025",
        "rain_sum_gfs_seamless",
        "snowfall_sum_gem_regional",
        "wind_gusts_10m_max_ncep_nbm_conus",
    ] {
        assert_eq!(day[key], json!([null]));
    }
    assert_eq!(
        daily(&hours("2026-11-17T10:00:00Z", 20, DENVER), "2026-11-17")["snowfall_sum_gfs_seamless"],
        json!([null])
    );
}

#[test]
fn short_model_horizon_and_display_rounding() {
    let mut raw = hours("2026-11-17T08:00:00Z", 14 * 24, DENVER);
    raw["hourly"]["snowfall_icon_seamless"]
        .as_array_mut()
        .unwrap()[2 + 7 * 24..]
        .fill(Value::Null);
    let dates = forecast_dates("2026-11-17T17:00:00Z", DENVER, 14).unwrap();
    let mut out = aggregate_hourly(&raw, &dates, DENVER).unwrap();
    out["dates"] = json!(dates);
    let week = slice_period(&out, 0, 7);
    assert_eq!(week["modelStatus"]["icon_seamless"], "数据完整");
    assert_eq!(out["modelStatus"]["icon_seamless"], "部分缺失");
    let second = slice_period(&out, 7, 14);
    assert_eq!(second["dates"], json!(&dates[7..]));
    assert!(
        second["daily"]["snowfall_sum_icon_seamless"]
            .as_array()
            .unwrap()
            .iter()
            .all(Value::is_null)
    );
    let daily = week["daily"]["snowfall_sum_icon_seamless"][0].as_f64();
    let sum = week["daily"]["snowfall_sum_icon_seamless"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n.as_f64().unwrap())
        .sum::<f64>();
    assert_eq!(snow(daily, 1.), "61.0");
    assert_eq!(snow(daily, 2.54), "24.0");
    assert_eq!(snow(Some(sum), 1.), "426.7");
    assert_eq!(snow(Some(sum), 2.54), "168.0");
    assert_eq!(snow(None, 2.54), "—");
}

#[test]
fn missing_snow_stays_distinct_from_zero() {
    let mut raw = hours("2026-11-17T08:00:00Z", 168, DENVER);
    let dates = forecast_dates("2026-11-17T17:00:00Z", DENVER, 7).unwrap();
    fill(&mut raw, "snowfall_ecmwf_ifs025", 0.into());
    raw["hourly"]["snowfall_gfs_seamless"][2] = Value::Null;
    raw["hourly"]["snowfall_icon_seamless"][5] = json!(f64::NAN);
    let out = aggregate_hourly(&raw, &dates, DENVER).unwrap();
    let day = &out["daily"];
    assert_json(&day["snowfall_sum_ecmwf_ifs025"][0], &json!(0));
    assert!(day["snowfall_sum_gfs_seamless"][0].is_null());
    assert!(day["snowfall_sum_icon_seamless"][0].is_null());
    raw["hourly_units"]["snowfall_ecmwf_ifs025"] = "inch".into();
    raw["hourly"]
        .as_object_mut()
        .unwrap()
        .remove("snowfall_icon_seamless");
    let out = aggregate_hourly(&raw, &dates, DENVER).unwrap();
    assert!(out["daily"]["snowfall_sum_ecmwf_ifs025"][1].is_null());
    assert!(
        out["daily"]["snowfall_sum_icon_seamless"]
            .as_array()
            .unwrap()
            .iter()
            .all(Value::is_null)
    );
}

use std::collections::HashSet;

use anyhow::{Result, anyhow, ensure};
use jiff::{Timestamp, ToSpan, civil::DateTime};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::catalog::{Point, catalog};
use crate::models::MODELS;
use crate::time::zone;

const HOUR: i64 = 3_600_000;
const DAY: i64 = 24 * HOUR;
const STATION: &str = "VT-WS-19";
const TIMEZONE: &str = "America/New_York";
const QUANTITY: &str = "new_snow_depth";

pub fn reports_url(limit: usize) -> String {
    format!(
        "https://api2.cocorahs.org/api/DailyPrecipObs?stationField=StationNumber&stationFieldValue={STATION}&sortField=ObsDateTime&sortDir=DESC&units=US&limit={limit}"
    )
}

pub fn parse_reports(status: u16, body: &[u8]) -> Result<Vec<Value>> {
    ensure!((200..300).contains(&status), "CoCoRaHS HTTP {status}");
    let mut data: Value = serde_json::from_slice(body)?;
    match data.get_mut("results").map(Value::take) {
        Some(Value::Array(reports)) => Ok(reports),
        _ => Err(anyhow!("CoCoRaHS 返回格式异常")),
    }
}

fn nonnegative(value: &Value) -> Option<f64> {
    value.as_f64().filter(|n| n.is_finite() && *n >= 0.0)
}

pub fn hourly_snow(data: &Value) -> Value {
    let time = data["hourly"]["time"]
        .as_array()
        .expect("validated hourly time");
    let values = MODELS.map(|id| {
        let key = format!("snowfall_{id}");
        let column = data["hourly"][&key].as_array()?;
        (data["hourly_units"][&key] == "cm" && column.len() == time.len())
            .then(|| column.iter().map(nonnegative).collect::<Vec<_>>())
    });
    json!({"quantity": QUANTITY, "unit": "cm", "firstEnd": time.first().and_then(Value::as_f64).map(|t| t * 1000.0), "values": values})
}

pub fn station_hour(value: &str) -> Option<i64> {
    let time = value.strip_suffix("+00:00")?;
    let (wall, fraction) = time
        .split_once('.')
        .map_or((time, None), |(w, f)| (w, Some(f)));
    if wall.len() != 19
        || !wall.is_ascii()
        || wall.as_bytes()[10] != b'T'
        || !wall.ends_with(":00:00")
        || fraction.is_some_and(|f| f.is_empty() || f.bytes().any(|b| b != b'0'))
    {
        return None;
    }
    let dt = wall.parse::<DateTime>().ok()?;
    let zone = zone(TIMEZONE).ok()?;
    let ts = zone.to_ambiguous_timestamp(dt).unambiguous().ok()?;
    let offset = zone.to_offset(ts).seconds();
    (offset == -4 * 3600 || offset == -5 * 3600).then(|| ts.as_millisecond())
}

fn waterbury() -> &'static Point {
    let catalog = catalog();
    catalog.point(&catalog.waterbury).unwrap().1
}

pub fn same_station(row: &Value) -> bool {
    let station = waterbury();
    row["stationNumber"] == STATION
        && row["latitude"].as_f64() == Some(station.lat)
        && row["longitude"].as_f64() == Some(station.lon)
}

pub fn observation_window(row: &Value, previous: Option<&Value>) -> Value {
    if !same_station(row) || previous.is_some_and(|r| !r.is_null() && !same_station(r)) {
        return json!({"excluded": "station"});
    }
    let parse = |r: &Value| r["obsDateTime"].as_str().and_then(station_hour);
    let Some((start, end)) = previous
        .and_then(parse)
        .zip(parse(row))
        .filter(|(s, e)| e - s == DAY)
    else {
        return json!({"excluded": "window"});
    };
    if row["units"] != "english"
        || row["depthOfSnowfallIsTrace"] != false
        || nonnegative(&row["depthOfSnowfall"]).is_none()
    {
        return json!({"excluded": "measurement"});
    }
    let p = waterbury();
    json!({"start": start, "end": end, "quantity": QUANTITY, "unit": "in", "value": row["depthOfSnowfall"], "pointId": p.id, "elevation": p.elevation, "lat": p.lat, "lon": p.lon})
}

#[derive(Debug, Deserialize)]
pub struct Snapshot {
    pub id: i64,
    pub point: String,
    pub fetched_at: i64,
    pub query: Value,
    pub hourly_snow: Option<Value>,
}

pub fn select_snapshots<'a>(
    snapshots: &'a [Snapshot],
    point: &str,
    now_ms: i64,
) -> Vec<&'a Snapshot> {
    let mut selected: Vec<_> = snapshots
        .iter()
        .filter(|s| {
            s.point == point && s.hourly_snow.is_some() && s.fetched_at >= now_ms - 38 * DAY
        })
        .collect();
    selected.sort_unstable_by_key(|s| std::cmp::Reverse((s.fetched_at, s.id)));
    selected.dedup_by_key(|s| s.fetched_at / (6 * HOUR));
    selected
}

pub fn paired_snow(snapshot: &Snapshot, model: usize, window: &Value) -> Option<f64> {
    let hourly = snapshot.hourly_snow.as_ref()?;
    if snapshot.query["pointId"] != window["pointId"]
        || ["lat", "lon", "elevation"]
            .iter()
            .any(|key| snapshot.query[key].as_f64() != window[key].as_f64())
        || hourly["quantity"] != QUANTITY
        || window["quantity"] != QUANTITY
        || hourly["unit"] != "cm"
    {
        return None;
    }
    let factor = match window["unit"].as_str()? {
        "in" => 2.54,
        "cm" => 1.0,
        _ => return None,
    };
    let measured = nonnegative(&window["value"])? * factor;
    let column = hourly["values"].get(model)?.as_array()?;
    let start = window["start"].as_f64()?;
    let first = (start + HOUR as f64 - hourly["firstEnd"].as_f64()?) / HOUR as f64;
    let count = (window["end"].as_f64()? - start) / HOUR as f64;
    if first.fract() != 0.0
        || count.fract() != 0.0
        || first < 0.0
        || count <= 0.0
        || first + count > column.len() as f64
    {
        return None;
    }
    let sum = column[first as usize..(first + count) as usize]
        .iter()
        .try_fold(0.0, |sum, value| Some(sum + nonnegative(value)?))?;
    Some(sum - measured)
}

pub fn summarize_accuracy(
    snapshots: &[&Snapshot],
    reports: &[Value],
    now_ms: i64,
) -> Result<Value> {
    let today = Timestamp::from_millisecond(now_ms)?
        .to_zoned_datetime(zone(TIMEZONE)?)
        .date();
    let start_day = today.checked_sub(29.days())?.to_string();
    let today = today.to_string();
    let mut observed = HashSet::new();
    let mut groups = [[(0u32, 0.0, 0.0); 7]; MODELS.len()];
    let mut excluded = json!({"station": 0, "window": 0, "measurement": 0, "forecast": 0});
    for (index, row) in reports.iter().enumerate() {
        let Some(date) = row["obsDateTime"]
            .as_str()
            .map(|s| s.get(..10).unwrap_or(s))
        else {
            continue;
        };
        if date < start_day.as_str() || date > today.as_str() || !observed.insert(date) {
            continue;
        }
        let window = observation_window(row, reports.get(index + 1));
        if let Some(reason) = window["excluded"].as_str() {
            excluded[reason] = json!(excluded[reason].as_u64().unwrap() + 1);
            continue;
        }
        if window["end"].as_i64().unwrap() > now_ms {
            continue;
        }
        let start = window["start"].as_i64().unwrap();
        let mut paired = [[false; 7]; MODELS.len()];
        for snapshot in snapshots {
            if snapshot.fetched_at >= start {
                continue;
            }
            let lead = ((start - snapshot.fetched_at) / DAY) as usize;
            if lead >= 7 {
                continue;
            }
            for (model, model_groups) in groups.iter_mut().enumerate() {
                if paired[model][lead] {
                    continue;
                }
                if let Some(error) = paired_snow(snapshot, model, &window) {
                    paired[model][lead] = true;
                    let (count, bias, mae) = &mut model_groups[lead];
                    *count += 1;
                    *bias += error;
                    *mae += error.abs();
                }
            }
        }
        if !paired.iter().flatten().any(|p| *p) {
            excluded["forecast"] = json!(excluded["forecast"].as_u64().unwrap() + 1);
        }
    }
    let groups: Vec<_> = MODELS
        .into_iter()
        .zip(groups)
        .flat_map(|(model, leads)| {
            leads
                .into_iter()
                .enumerate()
                .map(move |(lead, (count, bias, mae))| {
                    json!({"model": model, "lead": lead, "count": count,
                "bias": (count > 0).then(|| bias / f64::from(count)),
                "mae": (count > 0).then(|| mae / f64::from(count)),
                "insufficient": count < 10})
                })
        })
        .collect();
    Ok(json!({"groups": groups, "excluded": excluded, "minimumSamples": 10}))
}

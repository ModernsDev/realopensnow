use anyhow::{Result, ensure};
use jiff::Timestamp;
use serde::Serialize;
use serde_json::Value;

use crate::accuracy::hourly_snow;
use crate::aggregate::{forecast_batch, forecast_source};
use crate::catalog::{Point, Resort, catalog};
use crate::models::snapshot_units;
use crate::time::{in_zone, request_zone};

pub struct SnapshotRequest {
    pub source: String,
    pub zone: String,
    pub redirect: &'static str,
}

pub fn snapshot_request(resort: &Resort, point: &Point, now_ms: i64) -> Result<SnapshotRequest> {
    let zone = request_zone(&resort.timezone, now_ms)?;
    let source = forecast_source(point.lat, point.lon, point.elevation, &zone, 7, 1);
    Ok(SnapshotRequest {
        source,
        zone,
        redirect: "manual",
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct SnapshotContent {
    pub fetched_at_ms: i64,
    pub payload: Value,
    pub hourly_snow: Option<Value>,
}

pub fn snapshot(
    data: &Value,
    resort: &Resort,
    point: &Point,
    requested: &str,
    fetched: &str,
) -> Result<SnapshotContent> {
    let mut payload = forecast_batch(data, resort, point, requested, fetched, 7)?;
    payload["issuedAt"] = Value::Null;
    payload["units"] = snapshot_units();
    let hourly_snow = (point.id == catalog().waterbury).then(|| hourly_snow(data));
    Ok(SnapshotContent {
        fetched_at_ms: fetched.parse::<Timestamp>()?.as_millisecond(),
        payload,
        hourly_snow,
    })
}

pub fn manual_snapshot(
    request: &SnapshotRequest,
    status: u16,
    data: Value,
    resort: &Resort,
    point: &Point,
    requested: &str,
    fetched: &str,
) -> Result<SnapshotContent> {
    ensure!((200..300).contains(&status), "Open-Meteo HTTP {status}");
    snapshot(
        &in_zone(data, &request.zone, &resort.timezone),
        resort,
        point,
        requested,
        fetched,
    )
}

use anyhow::Result;
use serde_json::Value;

use crate::{
    catalog::{Point, Resort},
    models::{MODELS, point_config},
    time::{forecast_window, iso_ms, local_date},
};

pub struct ReadyRow<'a> {
    pub config: Option<&'a str>,
    pub state: &'a Value,
    pub built_date: Option<&'a str>,
    pub payload: Option<&'a Value>,
}

pub fn latest_forecast(
    row: Option<ReadyRow<'_>>,
    (resort, point): (&Resort, &Point),
    now_ms: i64,
) -> Result<Option<Value>> {
    let Some(row) = row else {
        return Ok(None);
    };
    let Some(payload) = row.payload else {
        return Ok(None);
    };
    if row.config != Some(&point_config(resort, point))
        || row.built_date != Some(&local_date(now_ms, &resort.timezone)?)
    {
        return Ok(None);
    }
    let window = forecast_window(now_ms, &resort.timezone, 8, 16)?;
    let mut oldest = None;
    for id in MODELS {
        let entry = &row.state[id];
        if entry["outside"] == true {
            continue;
        }
        if entry["fetched_at"].as_i64().unwrap_or(0) == 0
            || entry["covered_to"] != window.end
            || entry["pending"] == true
        {
            return Ok(None);
        }
        let verified = entry["verified_at"]
            .as_i64()
            .ok_or_else(|| anyhow::anyhow!("missing verification time"))?;
        oldest = Some(oldest.map_or(verified, |ms: i64| ms.min(verified)));
    }
    let fetched = iso_ms(oldest.ok_or_else(|| anyhow::anyhow!("no covered models"))?)?;
    let mut result = payload.clone();
    result
        .as_object_mut()
        .ok_or_else(|| anyhow::anyhow!("invalid forecast payload"))?
        .shift_remove("report");
    result["fetched"] = fetched.clone().into();
    result["extended"]["fetched"] = fetched.into();
    Ok(Some(result))
}

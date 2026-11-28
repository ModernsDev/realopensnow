use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;

use crate::{
    aggregate::{number_string, page_forecast},
    catalog::{Point, Resort},
    models::{MODELS, VARIABLES, model_members, point_config},
    snapshot::{SnapshotContent, snapshot},
    time::{Window, ambiguous, forecast_window, iso_ms, local_date, request_zone, wall_clock},
};

const HOUR: i64 = 3600;
const ECMWF: &str = "ecmwf_ifs025";

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PointRow {
    pub version: i64,
    pub config: Option<String>,
    pub state: Value,
    pub series: Value,
    pub built_date: Option<String>,
    pub built: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Meta {
    pub init: i64,
    pub available: i64,
}

pub type Metas = HashMap<String, Meta>;

#[derive(Debug, Serialize)]
pub struct Request {
    pub ids: Vec<&'static str>,
    pub from: i64,
    pub end: i64,
    pub query_params: Value,
}

struct Due {
    id: &'static str,
    updated: Vec<&'static str>,
    from: i64,
}

pub struct Plan<'a> {
    pub request: Option<Request>,
    pub window: Window,
    resort: &'a Resort,
    point: &'a Point,
    now_ms: i64,
    version: i64,
    config: String,
    rebuild: bool,
    fresh: bool,
    state: Value,
    series: Value,
    due: Vec<Due>,
    confirmed: bool,
}

pub enum Outcome {
    Ok(Value),
    Limited,
    Failed,
}

pub enum PayloadWrite {
    Keep,
    Clear,
    Set { built_date: String, payload: Value },
}

pub struct Commit {
    pub expected_version: i64,
    pub config: String,
    pub state: Value,
    pub series: Value,
    pub payload: PayloadWrite,
    pub snapshot: Option<SnapshotContent>,
    pub fetched: usize,
    pub failed: usize,
    pub limited: bool,
}

#[derive(Debug, Serialize)]
pub struct RefreshResult {
    pub committed: bool,
    pub fetched: usize,
    pub failed: usize,
    pub limited: bool,
}

impl Commit {
    pub fn result(&self, committed: bool) -> RefreshResult {
        RefreshResult {
            committed,
            fetched: self.fetched,
            failed: self.failed,
            limited: self.limited,
        }
    }
}

fn shift_series(previous: Option<&Value>, window: &Window) -> Result<Value> {
    let mut series = json!({"start":window.start,"models":{}});
    let Some(previous) = previous.filter(|s| !s.is_null()) else {
        return Ok(series);
    };
    let start = previous["start"]
        .as_i64()
        .ok_or_else(|| anyhow!("missing series start"))?;
    let moved = (window.start - start) / HOUR;
    let count = (window.end - window.start) / HOUR + 1;
    for (id, entry) in previous["models"]
        .as_object()
        .ok_or_else(|| anyhow!("missing series models"))?
    {
        let mut shifted = json!({});
        for variable in VARIABLES {
            if let Some(column) = entry["hourly"].get(variable) {
                shifted[variable] = if let Some(values) = column.as_array() {
                    (0..count)
                        .map(|i| {
                            values
                                .get((i + moved) as usize)
                                .cloned()
                                .unwrap_or(Value::Null)
                        })
                        .collect()
                } else {
                    column.clone()
                };
            }
        }
        let mut entry = entry.clone();
        entry["hourly"] = shifted;
        series["models"][id] = entry;
    }
    Ok(series)
}

pub fn plan<'a>(
    row: Option<&PointRow>,
    resort: &'a Resort,
    point: &'a Point,
    metas: &Metas,
    now_ms: i64,
) -> Result<Plan<'a>> {
    let config = point_config(resort, point);
    let matching = row.filter(|r| r.config.as_deref() == Some(&config));
    let mut state = matching
        .map(|r| &r.state)
        .filter(|s| !s.is_null())
        .cloned()
        .unwrap_or_else(|| json!({}));
    let window = forecast_window(now_ms, &resort.timezone, 8, 16)?;
    let series = shift_series(matching.map(|r| &r.series), &window)?;
    let mut confirmed = true;
    let mut due = vec![];
    for id in MODELS {
        let entry = state
            .as_object_mut()
            .ok_or_else(|| anyhow!("invalid model state"))?
            .entry(id)
            .or_insert_with(|| json!({"seen":{}}));
        if entry["outside"] == true {
            continue;
        }
        let members = model_members(id);
        if members.iter().any(|m| !metas.contains_key(*m)) {
            confirmed = false;
            continue;
        }
        let updated: Vec<_> = members
            .iter()
            .copied()
            .filter(|&m| {
                let meta = &metas[m];
                meta.available <= now_ms.div_euclid(1000)
                    && entry["seen"][m]
                        .as_i64()
                        .is_none_or(|seen| seen < meta.init)
            })
            .collect();
        let covered = entry["covered_to"].as_i64();
        let from = updated
            .iter()
            .map(|m| entry["seen"][*m].as_i64().unwrap_or(window.start))
            .chain(
                covered
                    .is_none_or(|s| s < window.end)
                    .then(|| covered.map_or(window.start, |s| s + HOUR)),
            )
            .min();
        let Some(from) = from else {
            entry["verified_at"] = now_ms.into();
            entry.as_object_mut().unwrap().shift_remove("pending");
            continue;
        };
        entry["pending"] = true.into();
        if entry["retry_at"].as_i64().is_some_and(|s| s > now_ms) {
            confirmed = false;
            continue;
        }
        due.push(Due { id, updated, from });
    }
    let request = if let Some(earliest) = due.iter().map(|d| d.from).min() {
        let zone = request_zone(&resort.timezone, now_ms)?;
        let mut from = window.start.max(earliest.div_euclid(HOUR) * HOUR);
        while from > window.start && ambiguous(from, &zone)? {
            from -= HOUR;
        }
        let mut ids: Vec<_> = due.iter().map(|d| d.id).collect();
        if !ids.contains(&ECMWF) {
            ids.insert(0, ECMWF);
        }
        let query_params = json!({
            "latitude":number_string(point.lat),"longitude":number_string(point.lon),"elevation":number_string(point.elevation),
            "timezone":zone,"models":ids.join(","),"hourly":VARIABLES.join(","),"timeformat":"unixtime",
            "temperature_unit":"celsius","wind_speed_unit":"kmh","precipitation_unit":"mm",
            "start_hour":wall_clock(from, &zone)?,"end_hour":wall_clock(window.end, &zone)?
        });
        Some(Request {
            ids,
            from,
            end: window.end,
            query_params,
        })
    } else {
        None
    };
    let today = local_date(now_ms, &resort.timezone)?;
    Ok(Plan {
        request,
        window,
        resort,
        point,
        now_ms,
        version: row.map_or(0, |r| r.version),
        config,
        fresh: matching.is_none(),
        rebuild: row.is_none_or(|r| !r.built || r.built_date.as_deref() != Some(&today)),
        state,
        series,
        due,
        confirmed,
    })
}

fn valid_response(data: &Value, request: &Request, point: &Point) -> bool {
    data["hourly"]["time"].as_array().is_some_and(|times| {
        times.len() as i64 == (request.end - request.from) / HOUR + 1
            && times
                .iter()
                .enumerate()
                .all(|(i, t)| t.as_f64() == Some((request.from + i as i64 * HOUR) as f64))
    }) && data["latitude"].is_number()
        && data["longitude"].is_number()
        && data["elevation"].as_f64() == Some(point.elevation)
}

pub fn response_shape(series: &Value, end: i64, resort: &Resort, point: &Point) -> Result<Value> {
    let start = series["start"]
        .as_i64()
        .ok_or_else(|| anyhow!("missing series start"))?;
    let grid = &series["models"][ECMWF]["grid"];
    let mut hourly = json!({"time": (start..=end).step_by(HOUR as usize).collect::<Vec<_>>()});
    let mut units = json!({"time":"unixtime"});
    for (model, entry) in series["models"]
        .as_object()
        .ok_or_else(|| anyhow!("missing models"))?
    {
        for variable in VARIABLES {
            let key = format!("{variable}_{model}");
            if entry["hourly"][variable].is_array() {
                hourly[&key] = entry["hourly"][variable].clone();
            }
            if let Some(unit) = entry["units"].get(variable) {
                units[key] = unit.clone();
            }
        }
    }
    Ok(
        json!({"latitude":grid["latitude"],"longitude":grid["longitude"],"elevation":point.elevation,
        "timezone":resort.timezone,"hourly_units":units,"hourly":hourly}),
    )
}

pub fn slice_shape(data: &Value, start: i64, end: i64) -> Result<Value> {
    let times = data["hourly"]["time"]
        .as_array()
        .ok_or_else(|| anyhow!("missing time"))?;
    let from = times.iter().position(|t| t.as_f64() == Some(start as f64));
    let until = times
        .iter()
        .position(|t| t.as_f64() == Some(end as f64))
        .map_or(0, |i| i + 1);
    let mut sliced = data.clone();
    for values in sliced["hourly"].as_object_mut().unwrap().values_mut() {
        let column = values
            .as_array()
            .ok_or_else(|| anyhow!("invalid slice column"))?;
        let first = from.unwrap_or_else(|| column.len().saturating_sub(1));
        *values = Value::Array(
            column
                .get(first..until.min(column.len()))
                .unwrap_or_default()
                .to_vec(),
        );
    }
    Ok(sliced)
}

fn merge(plan: &mut Plan, data: &Value, metas: &Metas, now_ms: i64) -> Result<usize> {
    let from = plan.request.as_ref().unwrap().from;
    let count = ((plan.window.end - plan.window.start) / HOUR + 1) as usize;
    let index = ((from - plan.window.start) / HOUR) as usize;
    let hourly = &data["hourly"];
    let single = VARIABLES.iter().any(|v| hourly.get(*v).is_some());
    let mut fetched = 0;
    for due in &plan.due {
        let id = due.id;
        let key = |variable: &str| {
            if single {
                variable.to_owned()
            } else {
                format!("{variable}_{id}")
            }
        };
        if (single && id != ECMWF) || !VARIABLES.iter().any(|v| hourly.get(key(v)).is_some()) {
            plan.state[id] = json!({"outside":true});
            plan.series["models"]
                .as_object_mut()
                .unwrap()
                .shift_remove(id);
            continue;
        }
        let target = &mut plan.series["models"][id];
        let mut units = json!({});
        for variable in VARIABLES {
            let key = key(variable);
            let field = &mut target["hourly"][variable];
            let Some(column) = hourly[&key].as_array().filter(|c| c.len() == count - index) else {
                *field = Value::Null;
                continue;
            };
            if field.is_null() {
                *field = Value::Array(vec![Value::Null; count]);
            }
            field
                .as_array_mut()
                .ok_or_else(|| anyhow!("invalid stored column"))?[index..]
                .clone_from_slice(column);
            let source_units = data["hourly_units"]
                .as_object()
                .ok_or_else(|| anyhow!("missing hourly_units"))?;
            if let Some(unit) = source_units.get(&key) {
                units[variable] = unit.clone();
            }
        }
        target["units"] = units;
        target["grid"] = json!({"latitude":data["latitude"],"longitude":data["longitude"],"elevation":data["elevation"]});
        let entry = &mut plan.state[id];
        for &member in &due.updated {
            entry["seen"][member] = metas[member].init.into();
        }
        entry["covered_to"] = plan.window.end.into();
        entry["fetched_at"] = now_ms.into();
        entry["verified_at"] = now_ms.into();
        let object = entry.as_object_mut().unwrap();
        object.shift_remove("pending");
        object.shift_remove("retry_at");
        fetched += 1;
    }
    Ok(fetched)
}

pub fn apply(
    mut plan: Plan,
    outcome: Outcome,
    metas: &Metas,
    slot: Option<i64>,
    now_ms: i64,
) -> Result<Commit> {
    let mut fetched = 0;
    let mut failed = 0;
    let mut limited = false;
    let mut merged = false;
    if let Some(request) = &plan.request {
        match outcome {
            Outcome::Ok(data) if valid_response(&data, request, plan.point) => {
                fetched = merge(&mut plan, &data, metas, now_ms)?;
                merged = true;
            }
            response => {
                limited = matches!(response, Outcome::Limited);
                failed = plan.due.len();
                plan.confirmed = false;
                if !limited {
                    for d in &plan.due {
                        plan.state[d.id]["retry_at"] = (plan.now_ms + 7_200_000).into();
                    }
                }
            }
        }
    }
    let complete = MODELS.iter().all(|&id| {
        plan.state[id]["outside"] == true || plan.state[id]["covered_to"] == plan.window.end
    });
    let mut payload = if plan.fresh {
        PayloadWrite::Clear
    } else {
        PayloadWrite::Keep
    };
    let mut saved = None;
    if !plan.series["models"][ECMWF].is_null() {
        let data = response_shape(&plan.series, plan.window.end, plan.resort, plan.point)?;
        let requested = iso_ms(plan.now_ms)?;
        if merged || plan.rebuild {
            payload = PayloadWrite::Set {
                built_date: local_date(plan.now_ms, &plan.resort.timezone)?,
                payload: page_forecast(&data, plan.resort, plan.point, &requested, &requested)?,
            };
        }
        if slot.is_some() && plan.confirmed && complete {
            let recent = forecast_window(plan.now_ms, &plan.resort.timezone, 1, 8)?;
            let sliced = slice_shape(&data, recent.start, recent.end)?;
            saved = Some(snapshot(
                &sliced,
                plan.resort,
                plan.point,
                &requested,
                &iso_ms(now_ms)?,
            )?);
        }
    }
    Ok(Commit {
        expected_version: plan.version,
        config: plan.config,
        state: plan.state,
        series: plan.series,
        payload,
        snapshot: saved,
        fetched,
        failed,
        limited,
    })
}

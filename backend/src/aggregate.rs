use std::{collections::HashMap, fmt::Write};

use anyhow::{Result, bail, ensure};
use jiff::Timestamp;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::{
    catalog::{Point, Resort},
    models::{MODELS, VARIABLES},
    time::{forecast_dates, in_zone, local_date, past_dates, period_endpoints, request_zone},
};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageQuery {
    pub resort_id: String,
    pub point_id: String,
    pub lat: f64,
    pub lon: f64,
    pub elevation: f64,
    pub timezone: String,
}

impl PageQuery {
    pub fn new(resort: &Resort, point: &Point) -> Self {
        Self {
            resort_id: resort.id.clone(),
            point_id: point.id.clone(),
            lat: point.lat,
            lon: point.lon,
            elevation: point.elevation,
            timezone: resort.timezone.clone(),
        }
    }
}

pub struct Hourly<'a> {
    pub times: Vec<i64>,
    pub hourly: &'a Value,
    pub units: &'a Value,
}

pub fn read_hourly<'a>(data: &'a Value, timezone: &str) -> Result<Hourly<'a>> {
    let invalid = "天气服务的时区或小时时间轴无效";
    ensure!(
        data["timezone"] == timezone && data["hourly_units"]["time"] == "unixtime",
        invalid
    );
    let times = data["hourly"]["time"]
        .as_array()
        .filter(|times| !times.is_empty())
        .ok_or_else(|| anyhow::anyhow!(invalid))?;
    let mut seconds = Vec::with_capacity(times.len());
    for t in times {
        let Some(t) = t
            .as_f64()
            .filter(|t| t.abs() <= 9_007_199_254_740_991.0 && t % 3600.0 == 0.0)
        else {
            bail!(invalid)
        };
        let t = t as i64;
        ensure!(seconds.last().is_none_or(|last| t - last == 3600), invalid);
        seconds.push(t);
    }
    Ok(Hourly {
        times: seconds,
        hourly: &data["hourly"],
        units: &data["hourly_units"],
    })
}

#[derive(Clone, Copy)]
enum Operation {
    Sum,
    Min,
    Max,
}

fn reduce_column(column: Option<&[Option<f64>]>, groups: &[Vec<usize>], op: Operation) -> Value {
    json!(
        groups
            .iter()
            .map(|group| {
                let column = column?;
                let initial = match op {
                    Operation::Sum => 0.0,
                    Operation::Min => f64::INFINITY,
                    Operation::Max => f64::NEG_INFINITY,
                };
                if group.is_empty() {
                    return None;
                }
                group.iter().try_fold(initial, |acc, &i| {
                    let n = column[i]?;
                    Some(match op {
                        Operation::Sum => acc + n,
                        Operation::Min => acc.min(n),
                        Operation::Max => acc.max(n),
                    })
                })
            })
            .collect::<Vec<_>>()
    )
}

fn aggregate_fields(raw: &Hourly<'_>, groups: &[Vec<Vec<usize>>; 2]) -> Value {
    use Operation::{Max, Min, Sum};
    let mut daily = Map::new();
    for model in MODELS {
        let read = |field, unit: &str, allow_negative| -> Option<Vec<Option<f64>>> {
            let key = format!("{field}_{model}");
            let column = raw.hourly[&key].as_array()?;
            (raw.units[key] == unit && column.len() == raw.times.len()).then(|| {
                column
                    .iter()
                    .map(|v| {
                        v.as_f64()
                            .filter(|n| n.is_finite() && (allow_negative || *n >= 0.0))
                    })
                    .collect()
            })
        };
        let snow = read("snowfall", "cm", false);
        let temp = read("temperature_2m", "°C", true);
        let freezing = read("freezing_level_height", "m", true);
        let rain = read("rain", "mm", false);
        let gusts = read("wind_gusts_10m", "km/h", false);
        let wet = snow.as_ref().zip(temp.as_ref()).map(|(snows, temps)| {
            snows
                .iter()
                .zip(temps)
                .map(|(snow, temp)| snow.zip(*temp).map(|(s, t)| if t > -1.0 { s } else { 0.0 }))
                .collect::<Vec<_>>()
        });
        for (field, column, shift, op) in [
            ("snowfall_sum", &snow, 1, Sum),
            ("temperature_2m_min", &temp, 0, Min),
            ("temperature_2m_max", &temp, 0, Max),
            ("wind_gusts_10m_max", &gusts, 1, Max),
            ("rain_sum", &rain, 1, Sum),
            ("wet_snowfall_sum", &wet, 1, Sum),
            ("freezing_level_height_min", &freezing, 0, Min),
            ("freezing_level_height_max", &freezing, 0, Max),
        ] {
            daily.insert(
                format!("{field}_{model}"),
                reduce_column(column.as_deref(), &groups[shift], op),
            );
        }
    }
    daily.into()
}

pub fn statuses(daily: &Value) -> Value {
    let mut result = Map::new();
    for model in MODELS {
        let mut present = 0;
        let mut count = 0;
        for field in [
            "snowfall_sum",
            "temperature_2m_min",
            "temperature_2m_max",
            "wind_gusts_10m_max",
        ] {
            if let Some(values) = daily[format!("{field}_{model}")].as_array() {
                count += values.len();
                present += values.iter().filter(|v| !v.is_null()).count();
            }
        }
        let status = if present == count {
            "数据完整"
        } else if present > 0 {
            "部分缺失"
        } else {
            "不可用"
        };
        result.insert(model.into(), status.into());
    }
    result.into()
}

fn daily_fields(raw: &Hourly<'_>, dates: &[String], timezone: &str) -> Result<Value> {
    let mut groups = [Vec::new(), Vec::new()];
    for (shift, groups) in groups.iter_mut().enumerate() {
        let date_at = |t: i64| -> Result<String> {
            let ms = t
                .checked_mul(1000)
                .and_then(|ms| ms.checked_sub(shift as i64))
                .ok_or_else(|| anyhow::anyhow!("时间戳超出范围"))?;
            local_date(ms, timezone)
        };
        let mut by_date: HashMap<String, Vec<usize>> = HashMap::new();
        for (i, t) in raw.times.iter().enumerate() {
            by_date.entry(date_at(*t)?).or_default().push(i);
        }
        by_date.remove(&date_at(raw.times[0] - 3600)?);
        by_date.remove(&date_at(raw.times[raw.times.len() - 1] + 3600)?);
        groups.extend(
            dates
                .iter()
                .map(|date| by_date.get(date).cloned().unwrap_or_default()),
        );
    }
    Ok(aggregate_fields(raw, &groups))
}

pub fn aggregate_hourly(data: &Value, dates: &[String], timezone: &str) -> Result<Value> {
    let daily = daily_fields(&read_hourly(data, timezone)?, dates, timezone)?;
    Ok(json!({"modelStatus":statuses(&daily),"daily":daily}))
}

fn period_fields(raw: &Hourly<'_>, dates: &[String], timezone: &str) -> Result<Value> {
    const HOUR: i64 = 3_600_000;
    let first = raw.times[0]
        .checked_mul(1000)
        .ok_or_else(|| anyhow::anyhow!("时间戳超出范围"))?;
    let mut groups = [Vec::new(), Vec::new()];
    let mut labels = Vec::new();
    let mut periods = Vec::new();
    for date in dates {
        let [morning, evening, next] = period_endpoints(date, timezone)?;
        for (part, start, end) in [("day", morning, evening), ("night", evening, next)] {
            periods.push(json!({"date":date,"part":part,"start":start,"end":end,"hours":(end-start) as f64 / HOUR as f64}));
            labels.push(format!("{date}-{part}"));
            for (shift, groups) in groups.iter_mut().enumerate() {
                let index = |t: i64| {
                    -((i128::from(first) - i128::from(t) - shift as i128)
                        .div_euclid(i128::from(HOUR)))
                };
                let (from, until) = (index(start), index(end));
                let range = if from < 0 || until > raw.times.len() as i128 {
                    0..0
                } else {
                    from as usize..until as usize
                };
                groups.push(range.collect());
            }
        }
    }
    Ok(json!({"dates":labels,"periods":periods,"daily":aggregate_fields(raw,&groups)}))
}

pub fn aggregate_periods(data: &Value, dates: &[String], timezone: &str) -> Result<Value> {
    period_fields(&read_hourly(data, timezone)?, dates, timezone)
}

pub fn slice_period(data: &Value, start: isize, end: isize) -> Value {
    let slice = |values: &Value| {
        let list = values.as_array().expect("series array");
        let clamp = |i: isize| {
            if i < 0 {
                list.len().saturating_sub(i.unsigned_abs())
            } else {
                list.len().min(i as usize)
            }
        };
        let from = clamp(start);
        Value::from(list[from..clamp(end).max(from)].to_vec())
    };
    let mut result = data.clone();
    result["dates"] = slice(&data["dates"]);
    for v in result["daily"]
        .as_object_mut()
        .expect("daily fields")
        .values_mut()
    {
        *v = slice(v)
    }
    result["modelStatus"] = statuses(&result["daily"]);
    result
}

pub fn number_string(value: f64) -> String {
    if value == 0.0 {
        return "0".into();
    }
    if !(1e-6..1e21).contains(&value.abs()) {
        let s = format!("{value:e}");
        if let Some((mantissa, exponent)) = s.split_once('e')
            && !exponent.starts_with('-')
        {
            return format!("{mantissa}e+{exponent}");
        }
        return s;
    }
    value.to_string()
}

fn encode(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        match byte {
            b' ' => out.push('+'),
            b'*' | b'-' | b'.' | b'_' | b'0'..=b'9' | b'A'..=b'Z' | b'a'..=b'z' => {
                out.push(byte as char)
            }
            _ => write!(out, "%{byte:02X}").unwrap(),
        }
    }
    out
}

pub fn forecast_source(
    lat: f64,
    lon: f64,
    elevation: f64,
    timezone: &str,
    days: usize,
    past_days: usize,
) -> String {
    format!(
        "https://api.open-meteo.com/v1/forecast?latitude={}&longitude={}&elevation={}&timezone={}&forecast_days={}&past_days={}&models={}&hourly={}&timeformat=unixtime&temperature_unit=celsius&wind_speed_unit=kmh&precipitation_unit=mm",
        encode(&number_string(lat)),
        encode(&number_string(lon)),
        encode(&number_string(elevation)),
        encode(timezone),
        days + 1,
        past_days,
        MODELS.join("%2C"),
        VARIABLES.join("%2C")
    )
}

pub fn page_source_for(query: &PageQuery, now_ms: i64) -> Result<String> {
    Ok(forecast_source(
        query.lat,
        query.lon,
        query.elevation,
        &request_zone(&query.timezone, now_ms)?,
        15,
        8,
    ))
}

pub fn page_source(resort: &Resort, point: &Point, now_ms: i64) -> Result<String> {
    page_source_for(&PageQuery::new(resort, point), now_ms)
}

fn batch(
    query: &PageQuery,
    data: &Value,
    requested: &str,
    fetched: &str,
    days: usize,
) -> Result<Value> {
    let error = match &data["error"] {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64() != Some(0.0),
        Value::String(s) => !s.is_empty(),
        _ => true,
    };
    ensure!(!error, "天气服务返回错误，无法生成预报");
    ensure!(
        data["elevation"].as_f64() == Some(query.elevation)
            && data["latitude"].is_number()
            && data["longitude"].is_number(),
        "天气服务返回的查询高度或网格坐标无效"
    );
    let dates = forecast_dates(requested, &query.timezone, days)?;
    let daily = daily_fields(
        &read_hourly(data, &query.timezone)?,
        &dates,
        &query.timezone,
    )?;
    Ok(json!({
        "dates":dates,"modelStatus":statuses(&daily),"daily":daily,"requested":requested,"fetched":fetched,
        "source":forecast_source(query.lat,query.lon,query.elevation,&query.timezone,days,1),
        "elevation":query.elevation,"timezone":query.timezone,"grid":{"lat":data["latitude"],"lon":data["longitude"]},"query":query,
    }))
}

pub fn forecast_batch(
    data: &Value,
    resort: &Resort,
    point: &Point,
    requested: &str,
    fetched: &str,
    days: usize,
) -> Result<Value> {
    batch(
        &PageQuery::new(resort, point),
        data,
        requested,
        fetched,
        days,
    )
}

pub fn page_forecast_for(
    query: &PageQuery,
    data: &Value,
    requested: &str,
    fetched: &str,
) -> Result<Value> {
    let ms = requested.parse::<Timestamp>()?.as_millisecond();
    let zone = request_zone(&query.timezone, ms)?;
    let relabeled;
    let data = if zone != query.timezone && data["timezone"] == zone {
        relabeled = in_zone(data.clone(), &zone, &query.timezone);
        &relabeled
    } else {
        data
    };
    let mut extended = batch(query, data, requested, fetched, 15)?;
    extended["source"] =
        forecast_source(query.lat, query.lon, query.elevation, &zone, 15, 8).into();
    let mut result = slice_period(&extended, 0, 7);
    let mut dates = past_dates(requested, &query.timezone)?;
    let raw = read_hourly(data, &query.timezone)?;
    let past = daily_fields(&raw, &dates, &query.timezone)?;
    result["past"] = json!({"dates":dates,"daily":past});
    dates.extend(
        extended["dates"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_owned()),
    );
    result["periods"] = period_fields(&raw, &dates, &query.timezone)?;
    result["extended"] = extended;
    Ok(result)
}

pub fn page_forecast(
    data: &Value,
    resort: &Resort,
    point: &Point,
    requested: &str,
    fetched: &str,
) -> Result<Value> {
    page_forecast_for(&PageQuery::new(resort, point), data, requested, fetched)
}

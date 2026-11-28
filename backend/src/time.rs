use anyhow::{Context, Result};
use jiff::{
    Timestamp,
    civil::Date,
    tz::{Offset, TimeZone, TimeZoneDatabase},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::LazyLock;

const HOUR: i64 = 3_600_000;
const DAY: i64 = 24 * HOUR;

pub fn zone(name: &str) -> Result<TimeZone> {
    static DB: LazyLock<TimeZoneDatabase> = LazyLock::new(TimeZoneDatabase::bundled);
    Ok(DB.get(name)?)
}

pub fn iso_ms(ms: i64) -> Result<String> {
    Ok(format!("{:.3}", Timestamp::from_millisecond(ms)?))
}

pub fn local_date(ms: i64, timezone: &str) -> Result<String> {
    Ok(zone(timezone)?
        .to_datetime(Timestamp::from_millisecond(ms)?)
        .date()
        .to_string())
}

fn date_sequence(requested: &str, timezone: &str, first: i64, count: usize) -> Result<Vec<String>> {
    let today = zone(timezone)?.to_datetime(requested.parse()?).date();
    (0..count)
        .map(|i| {
            Ok(today
                .checked_add(jiff::Span::new().days(first + i as i64))?
                .to_string())
        })
        .collect()
}

pub fn forecast_dates(requested: &str, timezone: &str, days: usize) -> Result<Vec<String>> {
    date_sequence(requested, timezone, 0, days)
}

pub fn past_dates(requested: &str, timezone: &str) -> Result<Vec<String>> {
    date_sequence(requested, timezone, -7, 7)
}

pub fn forecast_expired(data: &Value, now_ms: i64) -> Result<bool> {
    let fetched = data["fetched"]
        .as_str()
        .and_then(|s| s.parse::<Timestamp>().ok());
    Ok(
        fetched.is_some_and(|t| now_ms - t.as_millisecond() >= 6 * HOUR)
            || data["dates"][0]
                != local_date(
                    now_ms,
                    data["timezone"].as_str().context("missing timezone")?,
                )?,
    )
}

fn offset(ms: i64, tz: &TimeZone) -> Result<i64> {
    Ok(i64::from(tz.to_offset(Timestamp::from_millisecond(ms)?).seconds()) * 1000)
}

fn to_utc(wall_ms: i64, tz: &TimeZone) -> Result<i64> {
    Ok(wall_ms - offset(wall_ms - offset(wall_ms, tz)?, tz)?)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Window {
    pub start: i64,
    pub end: i64,
}

pub fn forecast_window(now_ms: i64, timezone: &str, past: i64, days: i64) -> Result<Window> {
    let tz = zone(timezone)?;
    let today = tz.to_datetime(Timestamp::from_millisecond(now_ms)?).date();
    let base = Offset::UTC
        .to_timestamp(today.at(0, 0, 0, 0))?
        .as_millisecond();
    let midnight =
        |shift| -> Result<i64> { Ok(to_utc(base + shift * DAY, &tz)?.div_euclid(HOUR) * 3600) };
    Ok(Window {
        start: midnight(-past)?,
        end: midnight(days)? - 3600,
    })
}

pub fn period_endpoints(date: &str, timezone: &str) -> Result<[i64; 3]> {
    let morning = Offset::UTC
        .to_timestamp(date.parse::<Date>()?.at(6, 0, 0, 0))?
        .as_millisecond();
    let tz = zone(timezone)?;
    Ok([
        to_utc(morning, &tz)?,
        to_utc(morning + 12 * HOUR, &tz)?,
        to_utc(morning + DAY, &tz)?,
    ])
}

pub fn wall_clock(seconds: i64, timezone: &str) -> Result<String> {
    let dt = zone(timezone)?.to_datetime(Timestamp::from_second(seconds)?);
    Ok(format!("{}T{:02}:{:02}", dt.date(), dt.hour(), dt.minute()))
}

pub fn ambiguous(seconds: i64, timezone: &str) -> Result<bool> {
    let here = wall_clock(seconds, timezone)?;
    Ok(wall_clock(seconds - 3600, timezone)? == here
        || wall_clock(seconds + 3600, timezone)? == here)
}

pub fn request_zone(timezone: &str, now_ms: i64) -> Result<String> {
    let minutes = offset(now_ms, &zone(timezone)?)? / 60_000;
    if minutes % 60 == 0 {
        return Ok(timezone.to_owned());
    }
    let hours = -(-minutes).div_euclid(60);
    Ok(if hours == 0 {
        "Etc/GMT".to_owned()
    } else {
        format!("Etc/GMT{:+}", -hours)
    })
}

pub fn in_zone(mut data: Value, zone: &str, timezone: &str) -> Value {
    if data["timezone"] == zone {
        data["timezone"] = timezone.into();
    }
    data
}

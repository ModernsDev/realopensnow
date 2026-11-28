use std::{collections::HashMap, sync::Arc};

use anyhow::{Context, ensure};
use axum::{
    Json, Router,
    extract::{Path, Query, Request, State},
    http::{StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
};
use serde_json::{Value, json};

use crate::{
    accuracy::{parse_reports, reports_url, summarize_accuracy},
    aggregate::{PageQuery, number_string, page_forecast_for, page_source_for},
    catalog::catalog,
    demand::{Demand, FetchError, REQUEST_TIMEOUT},
    io::{Get, Store, Upstream, now_ms},
    models::MODELS,
    ready::{ReadyRow, latest_forecast},
    snapshot::{manual_snapshot, snapshot_request},
    time::{forecast_window, iso_ms, local_date, zone},
};

struct Api<S, U> {
    store: Arc<S>,
    demand: Demand<U>,
    sha: String,
    now: fn() -> i64,
}
type Shared<S, U> = Arc<Api<S, U>>;

#[derive(Clone, Copy)]
enum Fault {
    Custom,
    Cursor,
    Missing,
    UnknownRoute,
    Station,
    Method,
    Limited,
    Upstream,
    Database,
    Deadline,
}

impl From<FetchError> for Fault {
    fn from(error: FetchError) -> Self {
        match error {
            FetchError::Limited => Self::Limited,
            FetchError::Unavailable => Self::Upstream,
            FetchError::Deadline => Self::Deadline,
        }
    }
}

impl Fault {
    fn response(self, en: bool) -> Response {
        use StatusCode as S;
        let (status, zh, english) = match self {
            Self::Custom => (
                S::BAD_REQUEST,
                "自定义地点参数无效。",
                "Invalid custom location parameters.",
            ),
            Self::Cursor => (
                S::BAD_REQUEST,
                "无效的历史游标。",
                "Invalid history cursor.",
            ),
            Self::Missing => (
                S::NOT_FOUND,
                "查询点不存在，请重新选择。",
                "This query point does not exist. Please choose another.",
            ),
            Self::UnknownRoute => (S::NOT_FOUND, "未找到。", "Not found"),
            Self::Station => (
                S::NOT_FOUND,
                "此查询点没有同址直接新雪观测。",
                "This point has no co-located new snow observations.",
            ),
            Self::Method => (
                S::METHOD_NOT_ALLOWED,
                "不支持此请求方法。",
                "Method not allowed.",
            ),
            Self::Limited => (
                S::TOO_MANY_REQUESTS,
                "天气服务已限流（429），请稍后重试。",
                "The weather service is rate limiting requests (429). Please try again later.",
            ),
            Self::Upstream => (
                S::BAD_GATEWAY,
                "上游预报暂不可用，请稍后重试。",
                "The upstream forecast is unavailable. Please try again later.",
            ),
            Self::Database => (
                S::SERVICE_UNAVAILABLE,
                "天气数据库暂不可用，请稍后重试。",
                "The weather database is unavailable. Please try again later.",
            ),
            Self::Deadline => (
                S::GATEWAY_TIMEOUT,
                "天气服务请求超时，请重试。",
                "The weather service timed out. Please try again.",
            ),
        };
        (status, Json(json!({"error":if en {english} else {zh}}))).into_response()
    }
}

impl IntoResponse for Fault {
    fn into_response(self) -> Response {
        let mut response = StatusCode::INTERNAL_SERVER_ERROR.into_response();
        response.extensions_mut().insert(self);
        response
    }
}

async fn envelope(request: Request, next: Next) -> Response {
    let mut languages = request.headers().get_all(header::ACCEPT_LANGUAGE).iter();
    let en = languages
        .next()
        .is_some_and(|value| value.as_bytes() == b"en")
        && languages.next().is_none();
    let mut response = match tokio::time::timeout(REQUEST_TIMEOUT, next.run(request)).await {
        Ok(mut response) => match response.extensions_mut().remove::<Fault>() {
            Some(reason) => reason.response(en),
            None if response.status() == StatusCode::BAD_REQUEST => Fault::Custom.response(en),
            None => response,
        },
        Err(_) => Fault::Deadline.response(en),
    };
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-store"),
    );
    response
}

async fn missing() -> Fault {
    Fault::UnknownRoute
}
async fn method() -> Fault {
    Fault::Method
}

pub fn router<S: Store, U: Upstream>(store: Arc<S>, upstream: Arc<U>, sha: String) -> Router {
    app(store, upstream, sha, now_ms)
}

fn app<S: Store, U: Upstream>(
    store: Arc<S>,
    upstream: Arc<U>,
    sha: String,
    now: fn() -> i64,
) -> Router {
    Router::new()
        .route("/healthz", get(health::<S, U>).head(method))
        .route("/api/forecast/{point}", get(forecast::<S, U>).head(method))
        .route("/api/forecast", get(custom::<S, U>).head(method))
        .route("/api/location", get(location::<S, U>).head(method))
        .route(
            "/api/regions/north-america",
            get(regions::<S, U>).head(method),
        )
        .route(
            "/api/forecast-snapshots/{point}",
            get(history::<S, U>).post(capture::<S, U>).head(method),
        )
        .route(
            "/api/forecast-accuracy/{point}",
            get(accuracy::<S, U>).head(method),
        )
        .method_not_allowed_fallback(method)
        .fallback(missing)
        .layer(middleware::from_fn(envelope))
        .with_state(Arc::new(Api {
            store,
            demand: Demand::new(upstream),
            sha,
            now,
        }))
}

async fn health<S: Store, U: Upstream>(State(api): State<Shared<S, U>>) -> Json<Value> {
    Json(json!({"sha":api.sha}))
}

fn sample_hours(now: i64, timezone: &str, past: i64, days: i64) -> Result<usize, Fault> {
    let w = forecast_window(now, timezone, past, days).map_err(|_| Fault::Upstream)?;
    Ok(((w.end - w.start) / 3600 + 1) as usize)
}

fn canonical_coord(n: f64) -> f64 {
    let units = n * 64.0;
    if units.fract() == 0.0 && units as i64 % 2 != 0 {
        return (n * 100_000.0).round() / 100_000.0;
    }
    format!("{n:.5}").parse().unwrap()
}

fn number(params: &HashMap<String, String>, key: &str, min: f64, max: f64) -> Result<f64, Fault> {
    params
        .get(key)
        .and_then(|s| s.parse::<f64>().ok())
        .filter(|n| (min..=max).contains(n))
        .ok_or(Fault::Custom)
}

fn coords(params: &HashMap<String, String>) -> Result<(f64, f64), Fault> {
    Ok((
        canonical_coord(number(params, "lat", -90.0, 90.0)?),
        canonical_coord(number(params, "lon", -180.0, 180.0)?),
    ))
}

fn page_query(params: &HashMap<String, String>) -> Result<PageQuery, Fault> {
    let (lat, lon) = coords(params)?;
    let elevation = number(params, "elevation", -500.0, 9000.0)?;
    let timezone = params
        .get("timezone")
        .filter(|s| zone(s).is_ok())
        .ok_or(Fault::Custom)?;
    let resort_id = params
        .get("resortId")
        .filter(|s| {
            s.strip_prefix("custom-")
                .and_then(|id| id.chars().next())
                .is_some_and(|c| !matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}'))
        })
        .ok_or(Fault::Custom)?;
    let point_id = params
        .get("pointId")
        .filter(|s| **s == format!("{resort_id}-point"))
        .ok_or(Fault::Custom)?;
    Ok(PageQuery {
        resort_id: resort_id.clone(),
        point_id: point_id.clone(),
        lat,
        lon,
        elevation,
        timezone: timezone.clone(),
    })
}

async fn cached_page<S: Store, U: Upstream>(
    api: &Api<S, U>,
    key: String,
    kind: &'static str,
    query: PageQuery,
    now: i64,
) -> Result<Value, Fault> {
    let source = page_source_for(&query, now).map_err(|_| Fault::Upstream)?;
    let hours = sample_hours(now, &query.timezone, 8, 16)?;
    let requested = iso_ms(now).map_err(|_| Fault::Upstream)?;
    let clock = api.now;
    Ok(api
        .demand
        .cached(
            key,
            Get::new(kind, source, MODELS.len(), hours, 12),
            move |reply| {
                let data = serde_json::from_slice(&reply.body)?;
                page_forecast_for(&query, &data, &requested, &iso_ms(clock())?)
            },
        )
        .await?)
}

async fn forecast<S: Store, U: Upstream>(
    State(api): State<Shared<S, U>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, Fault> {
    let (resort, point) = catalog().point(&id).ok_or(Fault::Missing)?;
    let row = api
        .store
        .tracked_forecast(&id)
        .await
        .map_err(|_| Fault::Database)?;
    let now = (api.now)();
    if let Some((row, payload)) = row {
        let ready = ReadyRow {
            config: row.config.as_deref(),
            state: &row.state,
            built_date: row.built_date.as_deref(),
            payload: Some(&payload),
        };
        if let Some(payload) =
            latest_forecast(Some(ready), (resort, point), now).map_err(|_| Fault::Database)?
        {
            return Ok(Json(payload));
        }
    }
    let date = local_date(now, &resort.timezone).map_err(|_| Fault::Upstream)?;
    Ok(Json(
        cached_page(
            &api,
            format!("page:{id}:{date}"),
            "page",
            PageQuery::new(resort, point),
            now,
        )
        .await?,
    ))
}

async fn custom<S: Store, U: Upstream>(
    State(api): State<Shared<S, U>>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<Value>, Fault> {
    let mut query = page_query(&params)?;
    let now = (api.now)();
    let date = local_date(now, &query.timezone).map_err(|_| Fault::Custom)?;
    let key = format!(
        "custom:{}:{}:{}:{}:{date}",
        number_string(query.lat),
        number_string(query.lon),
        number_string(query.elevation),
        query.timezone
    );
    let resort_id = std::mem::take(&mut query.resort_id);
    let point_id = std::mem::take(&mut query.point_id);
    let mut payload = cached_page(&api, key, "custom", query, now).await?;
    set_identity(&mut payload, &resort_id, &point_id);
    Ok(Json(payload))
}

fn set_identity(payload: &mut Value, resort_id: &str, point_id: &str) {
    let Some(object) = payload.as_object_mut() else {
        return;
    };
    for (key, child) in object {
        if key == "query" {
            child["resortId"] = resort_id.into();
            child["pointId"] = point_id.into();
        } else if child.is_object() {
            set_identity(child, resort_id, point_id);
        } else if let Some(list) = child.as_array_mut()
            && list.first().is_some_and(Value::is_object)
        {
            for item in list {
                set_identity(item, resort_id, point_id)
            }
        }
    }
}

const FORECAST: &str = "https://api.open-meteo.com/v1/forecast";
async fn location<S: Store, U: Upstream>(
    State(api): State<Shared<S, U>>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<Value>, Fault> {
    let (lat, lon) = coords(&params)?;
    let (lat, lon) = (number_string(lat), number_string(lon));
    let source = reqwest::Url::parse_with_params(
        FORECAST,
        [
            ("latitude", lat.as_str()),
            ("longitude", lon.as_str()),
            ("timezone", "auto"),
            ("forecast_days", "1"),
            ("daily", "snowfall_sum"),
        ],
    )
    .unwrap();
    let value = api
        .demand
        .cached(
            format!("location:{lat}:{lon}"),
            Get::new("location", source, 0, 24, 12),
            |reply| {
                let data: Value = serde_json::from_slice(&reply.body)?;
                let n = data["elevation"]
                    .as_f64()
                    .filter(|n| (-500.0..=9000.0).contains(n))
                    .context("invalid location elevation")?;
                let tz = data["timezone"]
                    .as_str()
                    .context("missing location timezone")?;
                zone(tz)?;
                let floor = n.floor();
                let elevation = floor as i64 + i64::from(n - floor >= 0.5);
                Ok(json!({"elevation":elevation,"timezone":tz}))
            },
        )
        .await?;
    Ok(Json(value))
}

async fn regions<S: Store, U: Upstream>(
    State(api): State<Shared<S, U>>,
) -> Result<Json<Value>, Fault> {
    let points = &catalog().regions;
    let coords = |i: usize| {
        points
            .iter()
            .map(|p| number_string(p[i]))
            .collect::<Vec<_>>()
            .join(",")
    };
    let (lat, lon) = (coords(0), coords(1));
    let source = reqwest::Url::parse_with_params(
        FORECAST,
        [
            ("latitude", lat.as_str()),
            ("longitude", lon.as_str()),
            ("forecast_days", "14"),
            (
                "daily",
                "snowfall_sum,rain_sum,temperature_2m_min,temperature_2m_max",
            ),
            ("models", "gfs_seamless"),
            ("timezone", "GMT"),
        ],
    )
    .unwrap();
    let today = local_date((api.now)(), "UTC").map_err(|_| Fault::Upstream)?;
    let value = api
        .demand
        .cached(
            format!("regions:{today}"),
            Get::new("regions", source, 1, 14 * 24, 12),
            |reply| {
                let data: Value = serde_json::from_slice(&reply.body)?;
                ensure!(data.is_array(), "expected regional sample array");
                Ok(data)
            },
        )
        .await?;
    Ok(Json(value))
}

async fn history<S: Store, U: Upstream>(
    State(api): State<Shared<S, U>>,
    Path(point): Path<String>,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<Json<Value>, Fault> {
    catalog().point(&point).ok_or(Fault::Missing)?;
    let before = params
        .iter()
        .find(|(k, _)| k == "before")
        .map(|(_, v)| {
            v.bytes()
                .all(|b| b.is_ascii_digit())
                .then(|| v.parse::<i64>().ok())
                .flatten()
                .filter(|n| (1..=9_007_199_254_740_991).contains(n))
                .ok_or(Fault::Cursor)
        })
        .transpose()?;
    let mut rows = api
        .store
        .history(&point, before)
        .await
        .map_err(|_| Fault::Database)?;
    let next = (rows.len() > 10).then(|| rows[9].0);
    rows.truncate(10);
    let snapshots = rows
        .into_iter()
        .map(|(id, data)| json!({"id":id,"data":data}))
        .collect::<Vec<_>>();
    Ok(Json(json!({"snapshots":snapshots,"next":next})))
}

async fn capture<S: Store, U: Upstream>(
    State(api): State<Shared<S, U>>,
    Path(id): Path<String>,
) -> Result<(StatusCode, Json<Value>), Fault> {
    let (resort, point) = catalog().point(&id).ok_or(Fault::Missing)?;
    let now = (api.now)();
    let spec = snapshot_request(resort, point, now).map_err(|_| Fault::Upstream)?;
    let hours = sample_hours(now, &resort.timezone, 1, 8)?;
    let reply = api
        .demand
        .uncached(Get::new("snapshot", &spec.source, MODELS.len(), hours, 12))
        .await?;
    let requested = iso_ms(now).map_err(|_| Fault::Upstream)?;
    let fetched = iso_ms((api.now)()).map_err(|_| Fault::Upstream)?;
    let content = manual_snapshot(
        &spec,
        reply.status,
        serde_json::from_slice(&reply.body).map_err(|_| Fault::Upstream)?,
        resort,
        point,
        &requested,
        &fetched,
    )
    .map_err(|_| Fault::Upstream)?;
    let id = api
        .store
        .save_snapshot(&id, &content)
        .await
        .map_err(|_| Fault::Database)?;
    Ok((
        StatusCode::CREATED,
        Json(json!({"id":id,"data":content.payload})),
    ))
}

async fn accuracy<S: Store, U: Upstream>(
    State(api): State<Shared<S, U>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, Fault> {
    if id != catalog().waterbury {
        return Err(Fault::Station);
    }
    let now = (api.now)();
    let rows = api
        .store
        .accuracy(&id, now)
        .await
        .map_err(|_| Fault::Database)?;
    let reply = api
        .demand
        .uncached(Get::new("cocorahs", reports_url(35), 0, 0, 8))
        .await?;
    let reports = parse_reports(reply.status, &reply.body).map_err(|_| Fault::Upstream)?;
    Ok(Json(
        summarize_accuracy(&rows.iter().collect::<Vec<_>>(), &reports, now)
            .map_err(|_| Fault::Database)?,
    ))
}

#[cfg(test)]
mod tests;

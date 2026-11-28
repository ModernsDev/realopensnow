use super::*;
#[path = "../../tests/common/mod.rs"]
mod parity;
use crate::{
    accuracy::Snapshot,
    io::{Reply, WriteState},
    models::point_config,
    refresh::{Commit, PointRow},
    snapshot::SnapshotContent,
};
use anyhow::{Result, bail};
use axum::{
    ServiceExt,
    body::{Body, to_bytes},
    http::{Method, Request as HttpRequest},
};
use std::fs;
use std::{
    convert::Infallible,
    sync::{
        Mutex,
        atomic::{AtomicBool, AtomicU16, AtomicUsize, Ordering},
    },
    time::Duration,
};

fn recorded(file: &str) -> Vec<u8> {
    fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/recorded")
            .join(file),
    )
    .unwrap()
}
const NOW: i64 = 1_795_842_953_147;
fn clock() -> i64 {
    NOW
}

#[derive(Default)]
struct Memory {
    row: Mutex<Option<(PointRow, Value)>>,
    history: Mutex<Vec<(String, SnapshotContent)>>,
    fail: AtomicBool,
    hang: AtomicBool,
    cursors: Mutex<Vec<Option<i64>>>,
}

impl Store for Memory {
    async fn replace_tracked(&self, _: &[String], _: i64) -> Result<()> {
        unreachable!()
    }
    async fn queue(&self) -> Result<(bool, Vec<String>)> {
        unreachable!()
    }
    async fn load_point(&self, _: &str) -> Result<PointRow> {
        unreachable!()
    }
    async fn version(&self, _: &str) -> Result<i64> {
        unreachable!()
    }
    async fn commit(&self, _: &str, _: &Commit, _: Option<i64>, _: i64) -> Result<WriteState> {
        unreachable!()
    }
    async fn tracked_forecast(&self, _: &str) -> Result<Option<(PointRow, Value)>> {
        if self.fail.load(Ordering::Relaxed) {
            bail!("DB unavailable")
        }
        if self.hang.load(Ordering::Relaxed) {
            return std::future::pending().await;
        }
        Ok(self.row.lock().unwrap().clone())
    }
    async fn history(&self, point: &str, before: Option<i64>) -> Result<Vec<(i64, Value)>> {
        self.cursors.lock().unwrap().push(before);
        Ok(self
            .history
            .lock()
            .unwrap()
            .iter()
            .enumerate()
            .rev()
            .filter_map(|(index, (id, data))| {
                let key = index as i64 + 1;
                (id == point && before.is_none_or(|cursor| key < cursor))
                    .then(|| (key, data.payload.clone()))
            })
            .take(11)
            .collect())
    }
    async fn save_snapshot(&self, point: &str, content: &SnapshotContent) -> Result<i64> {
        if self.fail.load(Ordering::Relaxed) {
            bail!("write unavailable")
        }
        let mut rows = self.history.lock().unwrap();
        rows.push((point.to_owned(), content.clone()));
        Ok(rows.len() as i64)
    }
    async fn accuracy(&self, point: &str, now: i64) -> Result<Vec<Snapshot>> {
        let rows: Vec<Snapshot> = serde_json::from_slice(&recorded("waterbury-snapshots.json"))?;
        let ids: Vec<_> = crate::accuracy::select_snapshots(&rows, point, now)
            .iter()
            .map(|s| s.id)
            .collect();
        let mut by_id: HashMap<_, _> = rows.into_iter().map(|s| (s.id, s)).collect();
        Ok(ids.iter().map(|id| by_id.remove(id).unwrap()).collect())
    }
}

#[derive(Default)]
struct Source {
    calls: Mutex<Vec<Get>>,
    status: AtomicU16,
    invalid: AtomicBool,
    slow: AtomicBool,
    active: AtomicUsize,
    peak: AtomicUsize,
}

impl Upstream for Source {
    async fn get(&self, request: Get) -> Result<Reply> {
        let body = match request.kind {
            "page" => recorded("page-alta-top.json"),
            "custom" => recorded("page-custom-nl.json"),
            "snapshot" => recorded("page-stowe-waterbury-vt-ws-19.json"),
            "regions" => recorded("regions.json"),
            "location" => recorded("location-nl.json"),
            "cocorahs" => recorded("cocorahs.json"),
            other => panic!("unexpected upstream {other}"),
        };
        self.calls.lock().unwrap().push(request);
        let active = self.active.fetch_add(1, Ordering::SeqCst) + 1;
        self.peak.fetch_max(active, Ordering::SeqCst);
        if self.slow.load(Ordering::Relaxed) {
            tokio::time::sleep(Duration::from_millis(40)).await
        }
        self.active.fetch_sub(1, Ordering::SeqCst);
        let status = self.status.load(Ordering::Relaxed);
        Ok(Reply {
            status: if status == 0 { 200 } else { status },
            body: if self.invalid.load(Ordering::Relaxed) {
                b"{}".to_vec()
            } else {
                body
            },
        })
    }
}

fn setup() -> (Router, Arc<Memory>, Arc<Source>) {
    let db = Arc::new(Memory::default());
    let source = Arc::new(Source::default());
    (
        app(db.clone(), source.clone(), "build-sha".into(), clock),
        db,
        source,
    )
}

async fn call<S: ServiceExt<HttpRequest<Body>, Response = Response, Error = Infallible>>(
    mut service: S,
    request: HttpRequest<Body>,
) -> Response {
    service.call(request).await.unwrap()
}

async fn send(app: &Router, method: Method, uri: &str, lang: &str) -> (StatusCode, Value) {
    let request = HttpRequest::builder()
        .method(method)
        .uri(uri)
        .header(header::ACCEPT_LANGUAGE, lang)
        .body(Body::empty())
        .unwrap();
    let response = call(app.clone(), request).await;
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    let status = response.status();
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&body)
            .unwrap_or_else(|e| panic!("{uri} {e}: {}", String::from_utf8_lossy(&body))),
    )
}
async fn read(app: &Router, uri: &str) -> Value {
    let (status, data) = send(app, Method::GET, uri, "en").await;
    assert_eq!(status, StatusCode::OK, "{uri}: {data}");
    data
}

#[tokio::test]
async fn catalog_prefers_ready_tracked_payload_and_reuses_demand_for_unready_points() {
    let (app, db, source) = setup();
    assert_eq!(read(&app, "/healthz").await, json!({"sha":"build-sha"}));
    let (resort, p) = catalog().point("alta-top").unwrap();
    let end = forecast_window(NOW, &resort.timezone, 8, 16).unwrap().end;
    let mut state = json!({});
    for (i, model) in MODELS.iter().enumerate() {
        state[model] =
            json!({"fetched_at":NOW-300,"covered_to":end,"verified_at":NOW-300+i as i64});
    }
    let row = PointRow {
        version: 4,
        config: Some(point_config(resort, p)),
        state,
        series: Value::Null,
        built_date: Some(local_date(NOW, &resort.timezone).unwrap()),
        built: true,
    };
    *db.row.lock().unwrap() = Some((row, json!({"extended":{},"report":{},"stored":true})));
    let ready = read(&app, "/api/forecast/alta-top").await;
    assert_eq!(
        ready,
        json!({"extended":{"fetched":iso_ms(NOW-300).unwrap()},"stored":true,"fetched":iso_ms(NOW-300).unwrap()})
    );
    assert!(source.calls.lock().unwrap().is_empty());
    db.row.lock().unwrap().as_mut().unwrap().0.state[MODELS[0]]["pending"] = true.into();
    let payload = read(&app, "/api/forecast/alta-top").await;
    assert_eq!(payload["query"]["pointId"], "alta-top");
    assert_eq!(payload["extended"]["dates"].as_array().unwrap().len(), 15);
    assert!(payload.get("report").is_none());
    *db.row.lock().unwrap() = None;
    assert_eq!(read(&app, "/api/forecast/alta-top").await, payload);
    let (code, _) = send(&app, Method::GET, "/api/forecast/unknown", "en").await;
    assert_eq!(code, StatusCode::NOT_FOUND);
    let calls = source.calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].url, payload["source"]);
    assert_eq!(
        (
            calls[0].kind,
            calls[0].models,
            calls[0].hours,
            calls[0].timeout
        ),
        ("page", 12, 576, Duration::from_secs(12))
    );
}

const CUSTOM: &str = "/api/forecast?lat=48.9583001&lon=-57.8236001&elevation=300&timezone=America%2FSt_Johns&resortId=custom-A&pointId=custom-A-point";

#[tokio::test]
async fn custom_coordinates_share_inflight_but_return_distinct_ids() {
    let (app, _, source) = setup();
    source.slow.store(true, Ordering::Relaxed);
    let other = CUSTOM
        .replace("custom-A", "custom-B")
        .replace("48.9583001", "48.9583002");
    let (a, b) = tokio::join!(read(&app, CUSTOM), read(&app, &other));
    assert_eq!(source.calls.lock().unwrap().len(), 1);
    for (p, id) in [(&a, "custom-A"), (&b, "custom-B")] {
        for q in [&p["query"], &p["extended"]["query"]] {
            assert_eq!(q["resortId"], id);
            assert_eq!(q["pointId"], format!("{id}-point"));
            assert_eq!(q["lat"], 48.9583);
            assert_eq!(q["lon"], -57.8236);
            assert_eq!(q["timezone"], "America/St_Johns");
        }
        assert!(
            p["source"]
                .as_str()
                .unwrap()
                .contains("timezone=Etc%2FGMT%2B3")
        );
    }
    assert_eq!(a["daily"], b["daily"]);
    assert_eq!(canonical_coord(1.015625), 1.01563);
    assert_eq!(canonical_coord(-1.015625), -1.01563);
}

#[tokio::test]
async fn routes_validate_parameters_before_io_and_choose_language_exactly() {
    let (app, _, source) = setup();
    for uri in [
        CUSTOM.replace("48.9583001", "91"),
        CUSTOM.replace("-57.8236001", "-181"),
        CUSTOM.replace("300&timezone", "9001&timezone"),
        CUSTOM.replace("300&timezone", "-501&timezone"),
        CUSTOM.replace("48.9583001", "NaN"),
        CUSTOM.replace("-57.8236001", "inf"),
        CUSTOM.replace("America%2FSt_Johns", "Etc%2FMissing"),
        CUSTOM.replace("custom-A", "A"),
        CUSTOM.replace("custom-A-point", "custom-B-point"),
        "/api/location?lon=3".into(),
    ] {
        let (status, body) = send(&app, Method::GET, &uri, "en").await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{uri}");
        assert_eq!(body, json!({"error":"Invalid custom location parameters."}));
    }
    for lang in ["zh", "en-US", "en,zh"] {
        let (status, body) = send(&app, Method::GET, "/api/forecast?lat=1", lang).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body, json!({"error":"自定义地点参数无效。"}));
    }
    assert_eq!(
        send(&app, Method::POST, "/healthz", "en").await.0,
        StatusCode::METHOD_NOT_ALLOWED
    );
    assert_eq!(
        send(&app, Method::DELETE, "/api/forecast/alta-top", "en")
            .await
            .0,
        StatusCode::METHOD_NOT_ALLOWED
    );
    assert_eq!(
        send(&app, Method::GET, "/no-such-route", "en").await.0,
        StatusCode::NOT_FOUND
    );
    assert!(source.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn regional_and_location_responses_match_recordings_and_sources() {
    let (app, _, source) = setup();
    let location = read(&app, "/api/location?lat=48.9583&lon=-57.8236").await;
    assert_eq!(
        location,
        json!({"elevation":0,"timezone":"America/St_Johns"})
    );
    assert_eq!(
        location,
        read(&app, "/api/location?lat=48.95829999&lon=-57.82360001").await
    );
    let regions: Value = serde_json::from_slice(&recorded("regions.json")).unwrap();
    assert_eq!(read(&app, "/api/regions/north-america").await, regions);
    assert_eq!(read(&app, "/api/regions/north-america").await, regions);
    let calls = source.calls.lock().unwrap();
    assert_eq!(calls.len(), 2);
    assert_eq!(
        calls[0].url,
        "https://api.open-meteo.com/v1/forecast?latitude=48.9583&longitude=-57.8236&timezone=auto&forecast_days=1&daily=snowfall_sum"
    );
    let url = reqwest::Url::parse(&calls[1].url).unwrap();
    let p: HashMap<_, _> = url.query_pairs().collect();
    for (key, i) in [("latitude", 0), ("longitude", 1)] {
        assert_eq!(
            p[key],
            catalog()
                .regions
                .iter()
                .map(|r| number_string(r[i]))
                .collect::<Vec<_>>()
                .join(",")
        );
    }
    assert_eq!(p["forecast_days"], "14");
    assert_eq!(p["models"], "gfs_seamless");
    assert_eq!(p["timezone"], "GMT");
    assert_eq!(
        p["daily"],
        "snowfall_sum,rain_sum,temperature_2m_min,temperature_2m_max"
    );
}

#[tokio::test]
async fn manual_snapshots_do_not_coalesce_and_history_uses_the_tenth_row() {
    let (app, db, source) = setup();
    let path = "/api/forecast-snapshots/stowe-waterbury-vt-ws-19";
    let (one, two) = tokio::join!(
        send(&app, Method::POST, path, "en"),
        send(&app, Method::POST, path, "en")
    );
    for (status, body) in [&one, &two] {
        assert_eq!(*status, StatusCode::CREATED);
        assert!(body["id"].as_i64().is_some());
        assert_eq!(body["data"]["dates"].as_array().unwrap().len(), 7);
        assert_eq!(body["data"]["units"]["snowfall_sum"], "cm");
        assert_eq!(body["data"]["issuedAt"], Value::Null);
    }
    assert_ne!(one.1["id"], two.1["id"]);
    {
        let mut rows = db.history.lock().unwrap();
        assert!(
            rows.iter()
                .all(|(_, content)| content.hourly_snow.is_some())
        );
        for id in 3..=12 {
            let mut content = rows[0].1.clone();
            content.payload = json!({"ordinal":id});
            rows.push(("stowe-waterbury-vt-ws-19".into(), content));
        }
    }
    let first = read(&app, path).await;
    assert_eq!(first["next"], 3);
    assert_eq!(first["snapshots"].as_array().unwrap().len(), 10);
    assert_eq!(
        first["snapshots"][0],
        json!({"id":12,"data":{"ordinal":12}})
    );
    let second = read(&app, &format!("{path}?before=3")).await;
    assert_eq!(second["next"], Value::Null);
    assert_eq!(second["snapshots"].as_array().unwrap().len(), 2);
    for cursor in ["", "0", "-1", "3.5", "1e1", "9007199254740992"] {
        assert_eq!(
            send(&app, Method::GET, &format!("{path}?before={cursor}"), "en").await,
            (
                StatusCode::BAD_REQUEST,
                json!({"error":"Invalid history cursor."})
            )
        );
    }
    assert_eq!(*db.cursors.lock().unwrap(), vec![None, Some(3)]);
    let calls = source.calls.lock().unwrap();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].hours, 9 * 24);
    assert!(calls[0].url.contains("forecast_days=8&past_days=1"));
}

#[tokio::test]
async fn accuracy_only_uses_waterbury_and_the_35_report_source() {
    let (app, _, source) = setup();
    assert_eq!(
        send(&app, Method::GET, "/api/forecast-accuracy/alta-top", "en").await,
        (
            StatusCode::NOT_FOUND,
            json!({"error":"This point has no co-located new snow observations."})
        )
    );
    let actual = read(&app, "/api/forecast-accuracy/stowe-waterbury-vt-ws-19").await;
    let expected = parity::fixture("expected/accuracy.json");
    parity::assert_json(&actual, &expected["recorded"]["summary"]);
    let calls = source.calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].url, reports_url(35));
    assert_eq!(calls[0].timeout, Duration::from_secs(8));
}

#[tokio::test]
async fn bad_upstream_responses_are_localized_and_suppressed() {
    let (app, db, source) = setup();
    let path = "/api/forecast/alta-top";
    source.status.store(429, Ordering::Relaxed);
    assert_eq!(
        send(&app, Method::GET, path, "en").await,
        (
            StatusCode::TOO_MANY_REQUESTS,
            json!({"error":"The weather service is rate limiting requests (429). Please try again later."})
        )
    );
    source.status.store(200, Ordering::Relaxed);
    assert_eq!(
        send(&app, Method::GET, path, "zh").await,
        (
            StatusCode::TOO_MANY_REQUESTS,
            json!({"error":"天气服务已限流（429），请稍后重试。"})
        )
    );
    assert_eq!(source.calls.lock().unwrap().len(), 1);
    source.invalid.store(true, Ordering::Relaxed);
    for path in [
        CUSTOM,
        "/api/location?lat=0&lon=0",
        "/api/regions/north-america",
        "/api/forecast-accuracy/stowe-waterbury-vt-ws-19",
    ] {
        assert_eq!(
            send(&app, Method::GET, path, "en").await,
            (
                StatusCode::BAD_GATEWAY,
                json!({"error":"The upstream forecast is unavailable. Please try again later."})
            )
        );
    }
    db.fail.store(true, Ordering::Relaxed);
    assert_eq!(
        send(&app, Method::GET, path, "en").await,
        (
            StatusCode::SERVICE_UNAVAILABLE,
            json!({"error":"The weather database is unavailable. Please try again later."})
        )
    );
    source.invalid.store(false, Ordering::Relaxed);
    assert_eq!(
        send(
            &app,
            Method::POST,
            "/api/forecast-snapshots/stowe-waterbury-vt-ws-19",
            "zh"
        )
        .await,
        (
            StatusCode::SERVICE_UNAVAILABLE,
            json!({"error":"天气数据库暂不可用，请稍后重试。"})
        )
    );
}

#[tokio::test]
async fn concurrent_locations_share_the_four_request_limit() {
    let (app, _, source) = setup();
    source.slow.store(true, Ordering::Relaxed);
    let paths = (0..8)
        .map(|n| format!("/api/location?lat={n}&lon=0"))
        .collect::<Vec<_>>();
    let locations = futures::future::join_all(paths.iter().map(|p| read(&app, p))).await;
    assert_eq!(locations.len(), 8);
    assert_eq!(source.peak.load(Ordering::SeqCst), 4);
}

#[tokio::test]
async fn whole_request_deadline_covers_database_waits() {
    let (app, db, source) = setup();
    db.hang.store(true, Ordering::Relaxed);
    assert_eq!(
        send(&app, Method::GET, "/api/forecast/alta-top", "en").await,
        (
            StatusCode::GATEWAY_TIMEOUT,
            json!({"error":"The weather service timed out. Please try again."})
        )
    );
    assert!(source.calls.lock().unwrap().is_empty());
}

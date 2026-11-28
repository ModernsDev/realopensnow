use super::*;
use crate::{accuracy::Snapshot, refresh::PointRow, snapshot::SnapshotContent};
use serde_json::json;
use std::{
    collections::VecDeque,
    sync::{
        Arc, Mutex,
        atomic::{AtomicI64, AtomicUsize},
    },
};

const AT: i64 = 1_795_836_000_000;
const URL: &str = "https://worker.example/api/internal/tracked";

#[derive(Default)]
struct Rows {
    tracked: Option<Vec<String>>,
    reads: Vec<String>,
    writes: Vec<Value>,
    outcomes: VecDeque<WriteState>,
    version_reads: usize,
}

#[derive(Default)]
struct Memory {
    rows: Mutex<Rows>,
    observed_version: i64,
    fail_point: Option<String>,
    fail_queue: bool,
}

impl Store for Memory {
    async fn replace_tracked(&self, points: &[String], _at: i64) -> Result<()> {
        self.rows.lock().unwrap().tracked = Some(points.to_vec());
        Ok(())
    }
    async fn queue(&self) -> Result<(bool, Vec<String>)> {
        ensure!(!self.fail_queue, "queue read failed");
        let rows = self.rows.lock().unwrap();
        Ok((
            rows.tracked.is_some(),
            rows.tracked.clone().unwrap_or_default(),
        ))
    }
    async fn load_point(&self, point: &str) -> Result<PointRow> {
        self.rows.lock().unwrap().reads.push(point.into());
        ensure!(
            self.fail_point.as_deref() != Some(point),
            "point read failed"
        );
        Ok(PointRow {
            version: 0,
            config: None,
            state: Value::Null,
            series: Value::Null,
            built_date: None,
            built: false,
        })
    }
    async fn version(&self, _: &str) -> Result<i64> {
        self.rows.lock().unwrap().version_reads += 1;
        Ok(self.observed_version)
    }
    async fn commit(
        &self,
        point: &str,
        c: &Commit,
        slot: Option<i64>,
        at: i64,
    ) -> Result<WriteState> {
        let mut rows = self.rows.lock().unwrap();
        rows.writes.push(json!({"point":point,"version":c.expected_version,"slot":slot,
            "snapshot":c.snapshot,"at":at,"state":c.state,"fetched":c.fetched,"failed":c.failed,"limited":c.limited}));
        Ok(rows.outcomes.pop_front().unwrap_or(WriteState::Committed))
    }
    async fn tracked_forecast(&self, _: &str) -> Result<Option<(PointRow, Value)>> {
        unreachable!()
    }
    async fn history(&self, _: &str, _: Option<i64>) -> Result<Vec<(i64, Value)>> {
        unreachable!()
    }
    async fn save_snapshot(&self, _: &str, _: &SnapshotContent) -> Result<i64> {
        unreachable!()
    }
    async fn accuracy(&self, _: &str, _: i64) -> Result<Vec<Snapshot>> {
        unreachable!()
    }
}

struct Remote {
    manifest: Value,
    status: u16,
    bad_meta: bool,
    requests: Mutex<Vec<Get>>,
    concurrent_metas: AtomicUsize,
    peak_metas: AtomicUsize,
    advance_clock: Option<Arc<AtomicI64>>,
}

impl Remote {
    fn with_points(points: &[&str]) -> Self {
        Self {
            manifest: json!({"catalog":catalog().digest,"points":points}),
            status: 200,
            bad_meta: false,
            requests: Mutex::default(),
            concurrent_metas: 0.into(),
            peak_metas: 0.into(),
            advance_clock: None,
        }
    }
}

impl Upstream for Remote {
    async fn get(&self, r: Get) -> Result<Reply> {
        let response = match r.kind {
            "tracked" => {
                assert_eq!(r.url, URL);
                assert_eq!(r.bearer.as_deref(), Some("worker-secret"));
                assert_eq!(r.timeout.as_secs(), 10);
                Reply {
                    status: 200,
                    body: serde_json::to_vec(&self.manifest)?,
                }
            }
            "meta" => {
                let active = self.concurrent_metas.fetch_add(1, Ordering::SeqCst) + 1;
                self.peak_metas.fetch_max(active, Ordering::SeqCst);
                tokio::task::yield_now().await;
                self.concurrent_metas.fetch_sub(1, Ordering::SeqCst);
                assert_eq!(r.timeout.as_secs(), 10);
                assert!(r.bearer.is_none());
                let init = if self.bad_meta && r.url.contains("/dwd_icon_eu/") {
                    json!("not an integer")
                } else {
                    json!(AT / 1000 - 21600)
                };
                Reply {
                    status: 200,
                    body: serde_json::to_vec(
                        &json!({"last_run_initialisation_time":init,"last_run_availability_time":AT/1000-1}),
                    )?,
                }
            }
            "refresh" => {
                assert_eq!(r.timeout.as_secs(), 20);
                assert!(r.bearer.is_none());
                tokio::task::yield_now().await;
                if let Some(clock) = &self.advance_clock {
                    clock.store(AT + 600_000, Ordering::SeqCst);
                }
                let body = if self.status == 200 {
                    let mut data: Value = serde_json::from_slice(include_bytes!(
                        "../../tests/fixtures/recorded/slice-alta-top.json"
                    ))?;
                    let url = Url::parse(&r.url)?;
                    let params: std::collections::HashMap<_, _> = url.query_pairs().collect();
                    assert_eq!(r.models, params["models"].split(',').count());
                    assert_eq!(r.hours, data["hourly"]["time"].as_array().unwrap().len());
                    data["elevation"] = json!(params["elevation"].parse::<f64>()?);
                    serde_json::to_vec(&data)?
                } else {
                    vec![]
                };
                Reply {
                    status: self.status,
                    body,
                }
            }
            _ => unreachable!(),
        };
        self.requests.lock().unwrap().push(r);
        Ok(response)
    }
}

async fn execute(store: &Memory, remote: &Remote) -> Summary {
    run(store, remote, URL, "worker-secret", true, AT, || AT).await
}

#[tokio::test]
async fn fresh_manifest_filters_points_and_reads_each_meta_once_in_parallel() {
    let store = Memory::default();
    let remote = Remote::with_points(&["alta-top", "no-such-point", "alta-top", "alta-base"]);
    let s = execute(&store, &remote).await;
    assert_eq!(s.tracked_source, "fresh");
    assert_eq!(
        (s.resorts, s.points, s.committed, s.errors, s.skipped),
        (1, 2, 2, 0, 0)
    );
    assert_eq!((s.metas, s.fetched), (12, 18));
    let requests = remote.requests.lock().unwrap();
    assert_eq!(
        requests
            .iter()
            .filter(|r| r.kind == "meta")
            .map(|r| &r.url)
            .collect::<HashSet<_>>()
            .len(),
        12
    );
    assert_eq!(remote.peak_metas.load(Ordering::SeqCst), 12);
    let rows = store.rows.lock().unwrap();
    assert_eq!(rows.tracked.as_ref().unwrap(), &["alta-top", "alta-base"]);
    assert_eq!(rows.reads, ["alta-top", "alta-base"]);
    for write in &rows.writes {
        assert_eq!(write["slot"], AT - 20 * 60_000);
        assert!(write["snapshot"].is_object());
    }
}

#[tokio::test]
async fn tracked_cache_failure_and_successful_empty_replacement() {
    let store = Memory::default();
    let mut invalid = Remote::with_points(&["alta-top"]);
    invalid.manifest["catalog"] = "stale".into();
    let s = execute(&store, &invalid).await;
    assert_eq!((s.tracked_source, s.errors, s.points), ("none", 1, 0));
    assert_eq!(invalid.requests.lock().unwrap().len(), 1);
    store.rows.lock().unwrap().tracked = Some(vec!["removed-point".into(), "alta-base".into()]);
    let s = execute(&store, &invalid).await;
    assert_eq!((s.tracked_source, s.errors, s.points), ("cached", 0, 1));
    assert_eq!(store.rows.lock().unwrap().reads, ["alta-base"]);
    let empty = Remote::with_points(&[]);
    let s = execute(&store, &empty).await;
    assert_eq!(
        (s.tracked_source, s.errors, s.points, s.metas),
        ("fresh", 0, 0, 0)
    );
    assert_eq!(empty.requests.lock().unwrap().len(), 1);
    let mut broken = Remote::with_points(&[]);
    broken.manifest = Value::Null;
    let s = execute(&store, &broken).await;
    assert_eq!((s.tracked_source, s.errors, s.points), ("cached", 0, 0));
}

#[tokio::test]
async fn successful_list_source_survives_queue_read_failure() {
    let store = Memory {
        fail_queue: true,
        ..Memory::default()
    };
    let remote = Remote::with_points(&["alta-base"]);
    let s = execute(&store, &remote).await;
    assert_eq!((s.tracked_source, s.errors, s.points), ("fresh", 1, 0));
}

#[tokio::test]
async fn rate_limit_and_budget_stop_dispatch_but_drain_started_work() {
    let points = [
        "alta-base",
        "alta-top",
        "alta-mid",
        "alta-atwater-1308",
        "snowbird-base",
        "snowbird-top",
    ];
    for status in [429, 500] {
        let store = Memory::default();
        let mut remote = Remote::with_points(&points);
        let clock = Arc::new(AtomicI64::new(AT));
        remote.status = status;
        if status == 500 {
            remote.advance_clock = Some(clock.clone());
        }
        let s = run(&store, &remote, URL, "worker-secret", false, AT, || {
            clock.load(Ordering::SeqCst)
        })
        .await;
        assert_eq!(
            (s.points, s.committed, s.skipped, s.failed, s.errors),
            (6, 4, 2, 48, 0)
        );
        assert_eq!(s.limited, status == 429);
        let rows = store.rows.lock().unwrap();
        assert_eq!(rows.reads, &points[..4]);
        assert!(
            rows.writes
                .iter()
                .all(|w| w["snapshot"].is_null() && w["slot"].is_null())
        );
    }
}

#[tokio::test]
async fn meta_failures_are_local_but_store_errors_count() {
    let mut remote = Remote::with_points(&["alta-base", "alta-top"]);
    remote.bad_meta = true;
    let store = Memory {
        fail_point: Some("alta-base".into()),
        ..Memory::default()
    };
    let s = execute(&store, &remote).await;
    assert_eq!((s.metas, s.errors, s.committed, s.points), (11, 1, 1, 2));
    assert!(store.rows.lock().unwrap().writes[0]["snapshot"].is_null());
}

#[tokio::test]
async fn serialization_and_unknown_commit_reread_without_refetch() {
    use WriteState::*;
    for (outcomes, version, commits, conflicts, errors, reads) in [
        (vec![Stale], 0, 0, 1, 0, 0),
        (vec![Serialization], 1, 0, 1, 0, 1),
        (
            vec![Serialization, Serialization, Serialization, Committed],
            0,
            1,
            0,
            0,
            3,
        ),
        (vec![Serialization; 4], 0, 0, 0, 1, 4),
        (vec![Unknown], 1, 1, 0, 0, 1),
        (vec![Unknown], 0, 0, 1, 0, 1),
        (vec![Unknown], 2, 0, 1, 0, 1),
    ] {
        let store = Memory {
            observed_version: version,
            ..Memory::default()
        };
        store.rows.lock().unwrap().outcomes = outcomes.clone().into();
        let remote = Remote::with_points(&["alta-top"]);
        let s = execute(&store, &remote).await;
        assert_eq!(
            (s.committed, s.conflicts, s.errors),
            (commits, conflicts, errors),
            "{outcomes:?}"
        );
        assert_eq!(
            remote
                .requests
                .lock()
                .unwrap()
                .iter()
                .filter(|r| r.kind == "refresh")
                .count(),
            1
        );
        let rows = store.rows.lock().unwrap();
        assert_eq!(rows.version_reads, reads);
        assert_eq!(rows.reads.len(), 1);
        assert_eq!(rows.writes.len(), outcomes.len());
        assert!(rows.writes.windows(2).all(|w| w[0] == w[1]));
    }
}

#[test]
fn slots_use_start_hour_in_utc() {
    assert_eq!(snapshot_slot(AT, true), Some(AT - 20 * 60_000));
    assert_eq!(snapshot_slot(AT, false), None);
    assert_eq!(snapshot_slot(AT + 3_600_000, true), None);
    assert_eq!(snapshot_slot(AT + 2 * 3_600_000, true), None);
}

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};

use anyhow::{Result, anyhow, bail, ensure};
use futures::{
    StreamExt,
    stream::{self, FuturesUnordered},
};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tracing::{error, info, warn};

use crate::{
    catalog::catalog,
    io::{Get, Reply, Store, Upstream, WriteState, now_ms},
    models::{MODELS, model_members},
    refresh::{self, Commit, Meta, Metas, Outcome, RefreshResult, Request},
};

#[derive(Default, Debug, Serialize)]
pub struct Summary {
    pub event: &'static str,
    pub tracked_source: &'static str,
    pub resorts: usize,
    pub points: usize,
    pub metas: usize,
    pub committed: usize,
    pub conflicts: usize,
    pub fetched: usize,
    pub failed: usize,
    pub errors: usize,
    pub limited: bool,
    pub skipped: usize,
}

impl Summary {
    pub fn log(&self) {
        info!(
            event = self.event,
            tracked_source = self.tracked_source,
            resorts = self.resorts,
            points = self.points,
            metas = self.metas,
            committed = self.committed,
            conflicts = self.conflicts,
            fetched = self.fetched,
            failed = self.failed,
            errors = self.errors,
            limited = self.limited,
            skipped = self.skipped
        );
    }
}

#[derive(Deserialize)]
struct Tracked {
    catalog: String,
    points: Vec<String>,
}

fn success(reply: Reply) -> Result<Vec<u8>> {
    ensure!((200..300).contains(&reply.status), "HTTP {}", reply.status);
    Ok(reply.body)
}

async fn tracked(upstream: &impl Upstream, url: &str, secret: &str) -> Result<Vec<String>> {
    let mut request = Get::new("tracked", url, 0, 0, 10);
    request.bearer = Some(secret.to_owned());
    let manifest: Tracked = serde_json::from_slice(&success(upstream.get(request).await?)?)?;
    ensure!(
        manifest.catalog == catalog().digest,
        "tracked catalog digest mismatch"
    );
    Ok(known_points(manifest.points))
}

fn known_points(ids: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut points = Vec::new();
    for id in ids {
        if !seen.insert(id.clone()) {
            continue;
        }
        if catalog().point(&id).is_some() {
            points.push(id);
        } else {
            warn!(event="unknown_tracked_point",point=%id);
        }
    }
    points
}

fn safe_integer(value: &Value) -> Result<i64> {
    let n = value
        .as_f64()
        .filter(|n| n.fract() == 0.0 && n.abs() <= 9_007_199_254_740_991.0)
        .ok_or_else(|| anyhow!("invalid model metadata"))?;
    Ok(n as i64)
}

async fn meta(upstream: &impl Upstream, member: &str) -> Result<Meta> {
    let url = format!("https://api.open-meteo.com/data/{member}/static/meta.json");
    let data: Value = serde_json::from_slice(&success(
        upstream.get(Get::new("meta", url, 1, 0, 10)).await?,
    )?)?;
    Ok(Meta {
        init: safe_integer(&data["last_run_initialisation_time"])?,
        available: safe_integer(&data["last_run_availability_time"])?,
    })
}

async fn read_metas(upstream: &impl Upstream) -> Metas {
    let mut seen = HashSet::new();
    let members = MODELS
        .into_iter()
        .flat_map(model_members)
        .copied()
        .filter(|m| seen.insert(*m));
    stream::iter(members)
        .map(|m| async move {
            match meta(upstream, m).await {
                Ok(value) => Some((m.to_owned(), value)),
                Err(error) => {
                    warn!(event="forecast_store_meta", member=m,%error);
                    None
                }
            }
        })
        .buffer_unordered(12)
        .filter_map(std::future::ready)
        .collect()
        .await
}

async fn fetch_models(upstream: &impl Upstream, request: &Request) -> Result<Outcome> {
    let url = Url::parse_with_params(
        "https://api.open-meteo.com/v1/forecast",
        request
            .query_params
            .as_object()
            .unwrap()
            .iter()
            .map(|(k, v)| (k, v.as_str().unwrap())),
    )?;
    let hours = ((request.end - request.from) / 3600 + 1) as usize;
    let reply = upstream
        .get(Get::new(
            "refresh",
            url.to_string(),
            request.ids.len(),
            hours,
            20,
        ))
        .await?;
    if reply.status == 429 {
        return Ok(Outcome::Limited);
    }
    Ok(Outcome::Ok(serde_json::from_slice(&success(reply)?)?))
}

async fn persist(
    store: &impl Store,
    point: &str,
    commit: &Commit,
    slot: Option<i64>,
    at: i64,
) -> Result<bool> {
    for retries in 0..=3 {
        match store.commit(point, commit, slot, at).await? {
            WriteState::Committed => return Ok(true),
            WriteState::Stale => return Ok(false),
            WriteState::Unknown => {
                return Ok(store.version(point).await? == commit.expected_version + 1);
            }
            WriteState::Serialization => {
                if store.version(point).await? != commit.expected_version {
                    return Ok(false);
                }
                if retries == 3 {
                    bail!("serialization retries exhausted");
                }
            }
        }
    }
    unreachable!()
}

async fn update_point(
    store: &impl Store,
    upstream: &impl Upstream,
    point_id: &str,
    metas: &Metas,
    slot: Option<i64>,
    clock: &(impl Fn() -> i64 + Sync),
    limited: &AtomicBool,
) -> Result<RefreshResult> {
    let (resort, point) = catalog()
        .point(point_id)
        .ok_or_else(|| anyhow!("unknown tracked point"))?;
    let start = clock();
    let row = store.load_point(point_id).await?;
    let plan = refresh::plan(Some(&row), resort, point, metas, start)?;
    let outcome = if let Some(request) = &plan.request {
        match fetch_models(upstream, request).await {
            Ok(Outcome::Limited) => {
                limited.store(true, Ordering::Relaxed);
                Outcome::Limited
            }
            Ok(outcome) => outcome,
            Err(error) => {
                warn!(event="forecast_store_upstream",point=point_id,%error);
                Outcome::Failed
            }
        }
    } else {
        Outcome::Failed
    };
    let now = clock();
    let commit = refresh::apply(plan, outcome, metas, slot, now)?;
    Ok(commit.result(persist(store, point_id, &commit, slot, now).await?))
}

fn snapshot_slot(start: i64, enabled: bool) -> Option<i64> {
    let hour = 3_600_000;
    (enabled && start.div_euclid(hour).rem_euclid(3) == 0)
        .then(|| start.div_euclid(3 * hour) * 3 * hour)
}

async fn run(
    store: &impl Store,
    upstream: &impl Upstream,
    url: &str,
    secret: &str,
    slots: bool,
    started: i64,
    clock: impl Fn() -> i64 + Sync,
) -> Summary {
    let mut summary = Summary {
        event: "favorite_refresh",
        tracked_source: "none",
        ..Summary::default()
    };
    match tracked(upstream, url, secret).await {
        Ok(points) => match store.replace_tracked(&points, clock()).await {
            Ok(()) => summary.tracked_source = "fresh",
            Err(error) => {
                error!(event="tracked_replace_failed",%error);
                summary.errors += 1;
            }
        },
        Err(error) => warn!(event="tracked_refresh_failed",%error),
    }
    let (previous, mut points) = match store.queue().await {
        Ok(queue) => queue,
        Err(error) => {
            error!(event="tracked_queue_failed",%error);
            summary.errors += 1;
            return summary;
        }
    };
    if summary.tracked_source != "fresh" {
        if !previous && points.is_empty() {
            error!(event = "tracked_cache_unavailable");
            summary.errors = 1;
            return summary;
        }
        points = known_points(points);
        summary.tracked_source = "cached";
    }
    summary.resorts = points
        .iter()
        .filter_map(|id| catalog().point(id))
        .map(|(r, _)| &r.id)
        .collect::<HashSet<_>>()
        .len();
    summary.points = points.len();
    if points.is_empty() {
        return summary;
    }
    let metas = read_metas(upstream).await;
    summary.metas = metas.len();
    let slot = snapshot_slot(started, slots);
    let limited = AtomicBool::new(false);
    let mut tasks = FuturesUnordered::new();
    let mut queue = points.iter();
    loop {
        while tasks.len() < 4 && !limited.load(Ordering::Relaxed) && clock() - started < 600_000 {
            let Some(id) = queue.next() else {
                break;
            };
            let work = update_point(store, upstream, id, &metas, slot, &clock, &limited);
            tasks.push(async move { (id, work.await) });
        }
        let Some((id, result)) = tasks.next().await else {
            break;
        };
        match result {
            Ok(result) => {
                if result.committed {
                    summary.committed += 1;
                } else {
                    summary.conflicts += 1;
                }
                summary.fetched += result.fetched;
                summary.failed += result.failed;
            }
            Err(error) => {
                summary.errors += 1;
                warn!(event="forecast_store_point",point=%id,%error);
            }
        }
    }
    summary.skipped = queue.len();
    summary.limited = limited.load(Ordering::Relaxed);
    summary
}

pub async fn refresh(
    store: &impl Store,
    upstream: &impl Upstream,
    tracked_url: &str,
    secret: &str,
    snapshot_slots: bool,
    started_ms: i64,
) -> Summary {
    run(
        store,
        upstream,
        tracked_url,
        secret,
        snapshot_slots,
        started_ms,
        now_ms,
    )
    .await
}

#[cfg(test)]
mod tests;

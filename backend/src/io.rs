use crate::{
    accuracy::Snapshot,
    refresh::{Commit, PointRow},
    snapshot::SnapshotContent,
};
use anyhow::Result;
use serde_json::Value;
use std::{
    future::Future,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteState {
    Committed,
    Stale,
    Serialization,
    Unknown,
}

pub trait Store: Send + Sync + 'static {
    fn replace_tracked(
        &self,
        points: &[String],
        now_ms: i64,
    ) -> impl Future<Output = Result<()>> + Send;
    fn queue(&self) -> impl Future<Output = Result<(bool, Vec<String>)>> + Send;
    fn load_point(&self, point: &str) -> impl Future<Output = Result<PointRow>> + Send;
    fn version(&self, point: &str) -> impl Future<Output = Result<i64>> + Send;
    fn commit(
        &self,
        point: &str,
        commit: &Commit,
        slot: Option<i64>,
        now_ms: i64,
    ) -> impl Future<Output = Result<WriteState>> + Send;
    fn tracked_forecast(
        &self,
        point: &str,
    ) -> impl Future<Output = Result<Option<(PointRow, Value)>>> + Send;
    fn history(
        &self,
        point: &str,
        before: Option<i64>,
    ) -> impl Future<Output = Result<Vec<(i64, Value)>>> + Send;
    fn save_snapshot(
        &self,
        point: &str,
        content: &SnapshotContent,
    ) -> impl Future<Output = Result<i64>> + Send;
    fn accuracy(
        &self,
        point: &str,
        now_ms: i64,
    ) -> impl Future<Output = Result<Vec<Snapshot>>> + Send;
}

pub struct Get {
    pub kind: &'static str,
    pub url: String,
    pub models: usize,
    pub hours: usize,
    pub timeout: Duration,
    pub bearer: Option<String>,
}

impl Get {
    pub fn new(
        kind: &'static str,
        url: impl Into<String>,
        models: usize,
        hours: usize,
        timeout_secs: u64,
    ) -> Self {
        Self {
            kind,
            url: url.into(),
            models,
            hours,
            timeout: Duration::from_secs(timeout_secs),
            bearer: None,
        }
    }
}

pub struct Reply {
    pub status: u16,
    pub body: Vec<u8>,
}

pub trait Upstream: Send + Sync + 'static {
    fn get(&self, request: Get) -> impl Future<Output = Result<Reply>> + Send;
}

pub struct Network(reqwest::Client);

impl Network {
    pub fn new() -> Result<Self> {
        Ok(Self(
            reqwest::Client::builder()
                .timeout(Duration::from_secs(12))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
        ))
    }
}

struct RequestLog<'a> {
    request: &'a Get,
    started: Instant,
    status: u16,
}

impl Drop for RequestLog<'_> {
    fn drop(&mut self) {
        if self.request.kind != "tracked" {
            tracing::info!(
                event = "upstream",
                kind = self.request.kind,
                models = self.request.models,
                hours = self.request.hours,
                status = self.status,
                ms = self.started.elapsed().as_millis() as u64
            );
        }
    }
}

impl Upstream for Network {
    async fn get(&self, request: Get) -> Result<Reply> {
        let mut builder = self
            .0
            .get(&request.url)
            .timeout(request.timeout)
            .header(reqwest::header::ACCEPT, "application/json");
        if let Some(secret) = request.bearer.as_deref() {
            builder = builder.bearer_auth(secret);
        }
        let mut log = RequestLog {
            request: &request,
            started: Instant::now(),
            status: 0,
        };
        let response = builder.send().await?;
        log.status = response.status().as_u16();
        let body = if response.status().is_success() {
            response.bytes().await?.to_vec()
        } else {
            Vec::new()
        };
        Ok(Reply {
            status: log.status,
            body,
        })
    }
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock before Unix epoch")
        .as_millis() as i64
}

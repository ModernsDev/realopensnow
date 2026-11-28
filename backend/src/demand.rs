use crate::io::{Get, Reply, Upstream};
use serde_json::Value;
use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    sync::{Semaphore, watch},
    time::{Instant, timeout_at},
};

pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(14);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FetchError {
    Limited,
    Unavailable,
    Deadline,
}

type Cached = Result<Arc<Value>, FetchError>;

#[derive(Default)]
struct Cache {
    entries: VecDeque<(String, Instant, Cached)>,
    loading: HashMap<String, watch::Receiver<Option<Cached>>>,
}

impl Cache {
    fn get(&mut self, key: &str, now: Instant) -> Option<Cached> {
        self.entries.retain(|(_, expires, _)| *expires > now);
        self.entries
            .iter()
            .find(|(k, _, _)| k == key)
            .map(|(_, _, v)| v.clone())
    }

    fn save(&mut self, key: String, value: Cached, now: Instant) {
        self.entries.retain(|(_, expires, _)| *expires > now);
        if self.entries.len() == 500 {
            self.entries.pop_front();
        }
        let ttl = Duration::from_secs(if value.is_ok() { 3600 } else { 60 });
        self.entries.push_back((key, now + ttl, value));
    }
}

pub struct Demand<U> {
    upstream: Arc<U>,
    permits: Arc<Semaphore>,
    cache: Arc<Mutex<Cache>>,
}

impl<U: Upstream> Demand<U> {
    pub fn new(upstream: Arc<U>) -> Self {
        Self {
            upstream,
            permits: Arc::new(Semaphore::new(4)),
            cache: Arc::default(),
        }
    }

    async fn fetch(upstream: &U, permits: &Semaphore, request: Get) -> Result<Reply, FetchError> {
        let _permit = permits.acquire().await.expect("open upstream semaphore");
        let reply = tokio::time::timeout(request.timeout, upstream.get(request))
            .await
            .map_err(|_| FetchError::Unavailable)?
            .map_err(|_| FetchError::Unavailable)?;
        match reply.status {
            200..=299 => Ok(reply),
            429 => Err(FetchError::Limited),
            _ => Err(FetchError::Unavailable),
        }
    }

    pub async fn uncached(&self, request: Get) -> Result<Reply, FetchError> {
        timeout_at(
            Instant::now() + REQUEST_TIMEOUT,
            Self::fetch(&self.upstream, &self.permits, request),
        )
        .await
        .unwrap_or(Err(FetchError::Deadline))
    }

    pub async fn cached(
        &self,
        key: String,
        request: Get,
        transform: impl FnOnce(Reply) -> anyhow::Result<Value> + Send + 'static,
    ) -> Result<Value, FetchError> {
        let now = Instant::now();
        let deadline = now + REQUEST_TIMEOUT;
        let mut receiver = {
            let mut cache = self.cache.lock().unwrap();
            if let Some(value) = cache.get(&key, now) {
                drop(cache);
                return value.map(|v| (*v).clone());
            }
            if let Some(receiver) = cache.loading.get(&key) {
                receiver.clone()
            } else {
                let (sender, receiver) = watch::channel(None);
                cache.loading.insert(key.clone(), receiver.clone());
                let shared = Arc::clone(&self.cache);
                let permits = Arc::clone(&self.permits);
                let upstream = Arc::clone(&self.upstream);
                tokio::spawn(async move {
                    let result = timeout_at(deadline, async {
                        let reply = Self::fetch(&upstream, &permits, request).await?;
                        tokio::task::spawn_blocking(move || transform(reply))
                            .await
                            .map_err(|_| FetchError::Unavailable)?
                            .map(Arc::new)
                            .map_err(|_| FetchError::Unavailable)
                    })
                    .await
                    .unwrap_or(Err(FetchError::Deadline));
                    let mut cache = shared.lock().unwrap();
                    cache.loading.remove(&key);
                    cache.save(key, result.clone(), Instant::now());
                    sender.send_replace(Some(result));
                });
                receiver
            }
        };
        let value = timeout_at(deadline, receiver.wait_for(Option::is_some))
            .await
            .map_err(|_| FetchError::Deadline)?
            .map_err(|_| FetchError::Unavailable)?;
        value.as_ref().unwrap().clone().map(|v| (*v).clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::sync::mpsc;

    struct Waiting {
        started: mpsc::UnboundedSender<()>,
        release: Semaphore,
    }

    impl Upstream for Waiting {
        async fn get(&self, _: Get) -> anyhow::Result<Reply> {
            self.started.send(()).unwrap();
            self.release.acquire().await.unwrap().forget();
            Ok(Reply {
                status: 200,
                body: b"17".to_vec(),
            })
        }
    }

    fn get() -> Get {
        Get::new("page", "test", 12, 576, 12)
    }
    fn parse(reply: Reply) -> anyhow::Result<Value> {
        Ok(serde_json::from_slice(&reply.body)?)
    }

    #[tokio::test]
    async fn dropping_first_waiter_keeps_the_shared_task_alive() {
        let (started, mut rx) = mpsc::unbounded_channel();
        let upstream = Arc::new(Waiting {
            started,
            release: Semaphore::new(0),
        });
        let demand = Arc::new(Demand::new(upstream.clone()));
        let spawn = || {
            let d = demand.clone();
            tokio::spawn(async move { d.cached("point".into(), get(), parse).await })
        };
        let first = spawn();
        rx.recv().await.unwrap();
        first.abort();
        assert!(first.await.unwrap_err().is_cancelled());
        let followers: Vec<_> = (0..8).map(|_| spawn()).collect();
        upstream.release.add_permits(1);
        for task in followers {
            assert_eq!(task.await.unwrap(), Ok(json!(17)));
        }
        assert!(rx.try_recv().is_err());
    }

    #[tokio::test]
    async fn cached_and_uncached_calls_share_four_permits() {
        let (started, mut rx) = mpsc::unbounded_channel();
        let upstream = Arc::new(Waiting {
            started,
            release: Semaphore::new(0),
        });
        let demand = Arc::new(Demand::new(upstream.clone()));
        let mut tasks = Vec::new();
        for i in 0..8 {
            let d = demand.clone();
            tasks.push(tokio::spawn(async move {
                if i % 2 == 0 {
                    d.cached(i.to_string(), get(), parse).await.unwrap();
                } else {
                    d.uncached(get()).await.unwrap();
                }
            }));
        }
        for _ in 0..4 {
            rx.recv().await.unwrap();
        }
        tokio::task::yield_now().await;
        assert!(rx.try_recv().is_err());
        upstream.release.add_permits(8);
        for task in tasks {
            task.await.unwrap();
        }
        assert_eq!(rx.len(), 4);
    }

    #[test]
    fn successful_and_failed_entries_expire_and_oldest_is_evicted() {
        let now = Instant::now();
        let mut cache = Cache::default();
        for i in 0..501 {
            cache.save(i.to_string(), Ok(Arc::new(json!(i))), now);
        }
        assert!(cache.get("0", now).is_none());
        assert!(cache.get("1", now).is_some());
        cache.save("failed".into(), Err(FetchError::Limited), now);
        assert_eq!(
            cache.get("failed", now + Duration::from_millis(59_999)),
            Some(Err(FetchError::Limited))
        );
        assert!(cache.get("failed", now + Duration::from_secs(60)).is_none());
        assert!(
            cache
                .get("2", now + Duration::from_millis(3_599_999))
                .is_some()
        );
        assert!(cache.get("2", now + Duration::from_secs(3600)).is_none());
    }
}

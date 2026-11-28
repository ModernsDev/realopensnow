use std::{
    env,
    time::{Duration, Instant},
};

use anyhow::{Context, Result, anyhow, bail};
use aws_sdk_dsql::auth_token::{AuthTokenGenerator, Config as TokenConfig};
use deadpool_postgres::{Manager, ManagerConfig, Object, Pool, RecyclingMethod, Runtime};
use rustls::{ClientConfig, RootCertStore};
use serde_json::Value;
use tokio::sync::Mutex;
use tokio_postgres::{Config, Error, Row, config::SslMode, error::SqlState, types::ToSql};
use tokio_postgres_rustls::MakeRustlsConnect;

use crate::{
    accuracy::Snapshot,
    io::{Store, WriteState},
    refresh::{Commit, PayloadWrite, PointRow},
    snapshot::SnapshotContent,
};

const TIMEOUT: Duration = Duration::from_secs(3);
const ROTATE: Duration = Duration::from_secs(600);
const INSERT_SNAPSHOT: &str = "INSERT INTO snow.snapshots (id,point,fetched_at,slot,payload,hourly_snow) VALUES (nextval('snow.snapshot_id'),$1,$2,$3,$4,$5)";

enum Source {
    Postgres(Config),
    Dsql {
        sdk: Box<aws_config::SdkConfig>,
        signer: AuthTokenGenerator,
        host: String,
        user: String,
    },
}

pub struct Db {
    source: Source,
    tls: MakeRustlsConnect,
    cached: Mutex<Option<(Instant, Pool)>>,
}

impl Db {
    pub async fn from_env() -> Result<Self> {
        let source = match (env::var_os("DATABASE_URL"), env::var_os("DSQL_ENDPOINT")) {
            (Some(url), None) => {
                let url = url.to_str().context("invalid DATABASE_URL")?;
                anyhow::ensure!(!url.trim().is_empty(), "DATABASE_URL is empty");
                Source::Postgres(url.parse()?)
            }
            (None, Some(host)) => {
                let host = host
                    .into_string()
                    .map_err(|_| anyhow!("invalid DSQL_ENDPOINT"))?;
                let user = env::var("DSQL_USER").context("DSQL_USER required")?;
                anyhow::ensure!(
                    !host.is_empty() && !user.is_empty(),
                    "DSQL_ENDPOINT and DSQL_USER required"
                );
                let region = env::var("AWS_REGION").context("AWS_REGION required")?;
                anyhow::ensure!(!region.is_empty(), "AWS_REGION is empty");
                let sdk = aws_config::defaults(aws_config::BehaviorVersion::latest())
                    .region(aws_config::Region::new(region))
                    .load()
                    .await;
                let signer = AuthTokenGenerator::new(
                    TokenConfig::builder()
                        .hostname(&host)
                        .build()
                        .map_err(anyhow::Error::from_boxed)?,
                );
                Source::Dsql {
                    sdk: Box::new(sdk),
                    signer,
                    host,
                    user,
                }
            }
            _ => bail!("configure exactly one of DATABASE_URL and DSQL_ENDPOINT"),
        };
        let roots = RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        let tls =
            ClientConfig::builder_with_provider(rustls::crypto::ring::default_provider().into())
                .with_safe_default_protocol_versions()?
                .with_root_certificates(roots)
                .with_no_client_auth();
        Ok(Self {
            source,
            cached: Mutex::new(None),
            tls: MakeRustlsConnect::new(tls),
        })
    }

    pub async fn connection(&self) -> Result<Object> {
        let pool = {
            let mut cached = self.cached.lock().await;
            if let Some((_, pool)) = cached
                .as_ref()
                .filter(|(t, _)| matches!(self.source, Source::Postgres(_)) || t.elapsed() < ROTATE)
            {
                pool.clone()
            } else {
                let created = Instant::now();
                let mut config = match &self.source {
                    Source::Postgres(config) => config.clone(),
                    Source::Dsql {
                        sdk,
                        signer,
                        host,
                        user,
                    } => {
                        let token = signer
                            .db_connect_auth_token(sdk)
                            .await
                            .map_err(anyhow::Error::from_boxed)?;
                        let mut config = Config::new();
                        config
                            .host(host)
                            .dbname("postgres")
                            .user(user)
                            .password(token.as_str())
                            .ssl_mode(SslMode::Require);
                        config
                    }
                };
                let options = match config.get_options() {
                    Some(options) => format!("{options} -c search_path=snow"),
                    None => "-c search_path=snow".to_owned(),
                };
                config.options(&options).connect_timeout(TIMEOUT);
                let manager = Manager::from_config(
                    config,
                    self.tls.clone(),
                    ManagerConfig {
                        recycling_method: RecyclingMethod::Verified,
                    },
                );
                let pool = Pool::builder(manager)
                    .runtime(Runtime::Tokio1)
                    .max_size(4)
                    .wait_timeout(Some(TIMEOUT))
                    .create_timeout(Some(TIMEOUT))
                    .recycle_timeout(Some(TIMEOUT))
                    .build()?;
                *cached = Some((created, pool.clone()));
                pool
            }
        };
        Ok(pool.get().await?)
    }
}

fn point_row(row: &Row) -> Result<PointRow> {
    let decode = |name| -> Result<Value> {
        Ok(row
            .try_get::<_, Option<&str>>(name)?
            .map(serde_json::from_str)
            .transpose()?
            .unwrap_or(Value::Null))
    };
    Ok(PointRow {
        version: row.try_get("version")?,
        config: row.try_get("config")?,
        state: decode("state")?,
        series: decode("series")?,
        built_date: row.try_get("built_date")?,
        built: row.try_get("built")?,
    })
}

fn serialization(error: &Error) -> bool {
    error.code() == Some(&SqlState::T_R_SERIALIZATION_FAILURE)
}

async fn commit_point(
    client: &mut Object,
    point: &str,
    commit: &Commit,
    slot: Option<i64>,
    now_ms: i64,
) -> Result<WriteState, Error> {
    let state = commit.state.to_string();
    let series = commit.series.to_string();
    let mut params: Vec<&(dyn ToSql + Sync)> = vec![
        &point,
        &commit.expected_version,
        &commit.config,
        &state,
        &series,
        &now_ms,
    ];
    let saved;
    let fields = match &commit.payload {
        PayloadWrite::Keep => "",
        PayloadWrite::Clear => ",built_date=NULL,payload=NULL",
        PayloadWrite::Set {
            built_date,
            payload,
        } => {
            saved = payload.to_string();
            params.push(built_date);
            params.push(&saved);
            ",built_date=$7,payload=$8"
        }
    };
    let sql = format!(
        "UPDATE snow.points SET version=version+1,config=$3,state=$4,series=$5,updated_at=$6{fields} WHERE point=$1 AND version=$2"
    );
    let tx = client.transaction().await?;
    let updated = tx.execute(&*sql, &params).await?;
    if updated == 0 {
        tx.rollback().await?;
        return Ok(WriteState::Stale);
    }
    if let Some(s) = &commit.snapshot {
        tx.execute(
            &format!("{INSERT_SNAPSHOT} ON CONFLICT (point,slot) DO NOTHING"),
            &[
                &point,
                &s.fetched_at_ms,
                &slot,
                &s.payload.to_string(),
                &s.hourly_snow.as_ref().map(Value::to_string),
            ],
        )
        .await?;
    }
    match tx.commit().await {
        Ok(()) => Ok(WriteState::Committed),
        Err(e) if e.code().is_none_or(|s| s.code().starts_with("08")) => Ok(WriteState::Unknown),
        Err(e) => Err(e),
    }
}

impl Store for Db {
    async fn replace_tracked(&self, points: &[String], now_ms: i64) -> Result<()> {
        let mut client = self.connection().await?;
        let tx = client.transaction().await?;
        tx.execute("INSERT INTO snow.meta (key,value) VALUES ('tracked_at',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", &[&now_ms.to_string()]).await?;
        tx.execute("DELETE FROM snow.tracked", &[]).await?;
        if !points.is_empty() {
            let params = (1..=points.len())
                .map(|i| format!("(${i})"))
                .collect::<Vec<_>>()
                .join(",");
            let values: Vec<&(dyn ToSql + Sync)> = points.iter().map(|p| p as _).collect();
            tx.execute(
                &format!("INSERT INTO snow.tracked (point) VALUES {params}"),
                &values,
            )
            .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    async fn queue(&self) -> Result<(bool, Vec<String>)> {
        let rows = self.connection().await?.query(
            "SELECT metadata.initialized,tracked.point FROM (SELECT EXISTS (SELECT 1 FROM snow.meta WHERE key='tracked_at') AS initialized) AS metadata LEFT JOIN snow.tracked ON true LEFT JOIN snow.points ON points.point=tracked.point ORDER BY points.updated_at ASC NULLS FIRST,tracked.point",
            &[],
        ).await?;
        Ok((
            rows[0].get(0),
            rows.into_iter()
                .filter_map(|r| r.get::<_, Option<String>>(1))
                .collect(),
        ))
    }

    async fn load_point(&self, point: &str) -> Result<PointRow> {
        let db = self.connection().await?;
        for attempt in 0..3 {
            match db.execute("INSERT INTO snow.points (point,version) VALUES ($1,0) ON CONFLICT (point) DO NOTHING", &[&point]).await {
                Ok(_) => break,
                Err(e) if serialization(&e) && attempt < 2 => continue,
                Err(e) => return Err(e.into()),
            }
        }
        let row = db.query_one("SELECT version,config,state,series,built_date,payload IS NOT NULL AS built FROM snow.points WHERE point=$1", &[&point]).await?;
        point_row(&row)
    }

    async fn version(&self, point: &str) -> Result<i64> {
        Ok(self
            .connection()
            .await?
            .query_one("SELECT version FROM snow.points WHERE point=$1", &[&point])
            .await?
            .try_get(0)?)
    }

    async fn commit(
        &self,
        point: &str,
        c: &Commit,
        slot: Option<i64>,
        now_ms: i64,
    ) -> Result<WriteState> {
        let mut client = self.connection().await?;
        match commit_point(&mut client, point, c, slot, now_ms).await {
            Err(e) if serialization(&e) => Ok(WriteState::Serialization),
            result => Ok(result?),
        }
    }

    async fn tracked_forecast(&self, point: &str) -> Result<Option<(PointRow, Value)>> {
        self.connection().await?.query_opt(
            "SELECT version,config,state,NULL::text AS series,built_date,true AS built,payload FROM snow.points JOIN snow.tracked USING(point) WHERE point=$1 AND payload IS NOT NULL",
            &[&point],
        ).await?.map(|r| Ok((point_row(&r)?, serde_json::from_str(r.try_get("payload")?)?))).transpose()
    }

    async fn history(&self, point: &str, before: Option<i64>) -> Result<Vec<(i64, Value)>> {
        self.connection().await?.query(
            "SELECT id,payload FROM snow.snapshots WHERE point=$1 AND ($2::bigint IS NULL OR (fetched_at,id) < (SELECT fetched_at,id FROM snow.snapshots WHERE point=$1 AND id=$2)) ORDER BY fetched_at DESC,id DESC LIMIT 11",
            &[&point, &before],
        ).await?.into_iter().map(|r| Ok((r.try_get(0)?, serde_json::from_str(r.try_get(1)?)?))).collect()
    }

    async fn save_snapshot(&self, point: &str, content: &SnapshotContent) -> Result<i64> {
        Ok(self
            .connection()
            .await?
            .query_one(
                &format!("{INSERT_SNAPSHOT} RETURNING id"),
                &[
                    &point,
                    &content.fetched_at_ms,
                    &None::<i64>,
                    &content.payload.to_string(),
                    &content.hourly_snow.as_ref().map(Value::to_string),
                ],
            )
            .await?
            .try_get(0)?)
    }

    async fn accuracy(&self, point: &str, now_ms: i64) -> Result<Vec<Snapshot>> {
        self.connection().await?.query(
            "WITH ranked AS (SELECT id,ROW_NUMBER() OVER (PARTITION BY fetched_at / 21600000 ORDER BY fetched_at DESC,id DESC) AS rank FROM snow.snapshots WHERE point=$1 AND fetched_at >= $2 AND hourly_snow IS NOT NULL) SELECT id,point,fetched_at,payload,hourly_snow FROM ranked JOIN snow.snapshots USING(id) WHERE rank=1 ORDER BY fetched_at DESC,id DESC",
            &[&point, &(now_ms - 38 * 86_400_000)],
        ).await?.into_iter().map(|r| {
            let mut payload: Value = serde_json::from_str(r.try_get("payload")?)?;
            let query = payload.get_mut("query").context("snapshot missing query")?.take();
            Ok(Snapshot { id: r.try_get("id")?, point: r.try_get("point")?, fetched_at: r.try_get("fetched_at")?, query, hourly_snow: Some(serde_json::from_str(r.try_get("hourly_snow")?)?) })
        }).collect()
    }
}

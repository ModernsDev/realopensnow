use anyhow::{Context, Result, bail, ensure};
use realopensnow::{
    db::Db,
    http,
    io::{Network, now_ms},
    jobs,
};
use std::{env, process::ExitCode, sync::Arc};
use tracing_subscriber::EnvFilter;

fn required(name: &str) -> Result<String> {
    let value = env::var(name).with_context(|| format!("{name} is required"))?;
    ensure!(!value.is_empty(), "{name} is empty");
    Ok(value)
}

async fn run(started: i64) -> Result<ExitCode> {
    let args: Vec<_> = env::args().skip(1).collect();
    let command = match args.as_slice() {
        [cmd] if cmd == "serve" || cmd == "refresh" => cmd.as_str(),
        _ => bail!("usage: realopensnow serve|refresh"),
    };
    rustls::crypto::ring::default_provider()
        .install_default()
        .map_err(|_| anyhow::anyhow!("TLS provider already configured"))?;
    let db = Db::from_env().await?;
    let network = Network::new()?;
    if command == "serve" {
        let sha = required("GIT_SHA")?;
        let listen = env::var("LISTEN").unwrap_or_else(|_| "127.0.0.1:8010".into());
        let listener = tokio::net::TcpListener::bind(&listen)
            .await
            .with_context(|| format!("listen {listen}"))?;
        let app = http::router(Arc::new(db), Arc::new(network), sha);
        axum::serve(listener, app).await?;
    } else {
        let url = required("TRACKED_POINTS_URL")?;
        let secret = required("WORKER_SECRET")?;
        let slots = match required("SNAPSHOT_SLOTS")?.as_str() {
            "on" => true,
            "off" => false,
            _ => bail!("SNAPSHOT_SLOTS must be on or off"),
        };
        let summary = jobs::refresh(&db, &network, &url, &secret, slots, started).await;
        summary.log();
        if summary.errors != 0 {
            return Ok(ExitCode::FAILURE);
        }
    }
    Ok(ExitCode::SUCCESS)
}

#[tokio::main]
async fn main() -> ExitCode {
    let started = now_ms();
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .json()
        .flatten_event(true)
        .with_writer(std::io::stdout)
        .init();
    match run(started).await {
        Ok(code) => code,
        Err(error) => {
            tracing::error!(event = "command_error", error = %format!("{error:#}"));
            ExitCode::FAILURE
        }
    }
}

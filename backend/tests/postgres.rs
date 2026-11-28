use std::{env, fs, path::Path};

use anyhow::{Context, Result, ensure};
use realopensnow::{
    db::Db,
    io::{Store, WriteState},
    refresh::{Commit, PayloadWrite},
    snapshot::SnapshotContent,
};
use serde_json::json;

const DAY: i64 = 86_400_000;
const NOW: i64 = 20_000 * DAY;

fn snapshot(point: &str, label: &str, fetched: i64) -> SnapshotContent {
    SnapshotContent {
        fetched_at_ms: fetched,
        payload: json!({"query": {"pointId": point}, "label": label}),
        hourly_snow: Some(json!({"label": label})),
    }
}

fn commit(point: &str, version: i64, label: &str, fetched: i64) -> Commit {
    let snapshot = snapshot(point, label, fetched);
    Commit {
        expected_version: version,
        config: "config".into(),
        state: json!({"label":label}),
        series: json!({"start":0,"models":{}}),
        payload: PayloadWrite::Set {
            built_date: "2026-11-28".into(),
            payload: snapshot.payload.clone(),
        },
        snapshot: Some(snapshot),
        fetched: 1,
        failed: 0,
        limited: false,
    }
}

async fn migrate(db: &Db) -> Result<()> {
    let folder = Path::new(env!("CARGO_MANIFEST_DIR")).join("migrations");
    let mut files = fs::read_dir(folder)?
        .map(|f| f.map(|e| e.path()))
        .collect::<std::io::Result<Vec<_>>>()?;
    files.sort();
    let conn = db.connection().await?;
    for file in files {
        let source = fs::read_to_string(&file)?;
        let source = if source.starts_with("CREATE INDEX ASYNC ")
            || source.starts_with("CREATE UNIQUE INDEX ASYNC ")
        {
            source.replacen("INDEX ASYNC ", "INDEX ", 1)
        } else {
            source
        };
        conn.execute(&*source, &[])
            .await
            .with_context(|| format!("migration {}", file.display()))?;
    }
    Ok(())
}

async fn run(db: &Db) -> Result<()> {
    migrate(db).await?;
    ensure!(db.queue().await? == (false, vec![]), "uninitialized queue");
    db.connection()
        .await?
        .execute("INSERT INTO snow.tracked VALUES ('imported')", &[])
        .await?;
    ensure!(
        db.queue().await? == (false, vec!["imported".into()]),
        "tracked rows before first sync"
    );
    let (a, b) = ("point-a", "point-b");
    db.replace_tracked(&[a.into(), b.into()], NOW).await?;
    ensure!(
        db.queue().await? == (true, vec![a.into(), b.into()]),
        "tracked replacement"
    );
    let (row_a, row_b) = tokio::try_join!(db.load_point(a), db.load_point(a))?;
    ensure!(
        row_a.version == 0 && row_b.version == 0 && !row_a.built && row_a.state.is_null(),
        "concurrent first write"
    );
    let left = commit(a, row_a.version, "left", NOW - 2);
    let right = commit(a, row_b.version, "right", NOW - 1);
    let (l, r) = tokio::try_join!(
        db.commit(a, &left, Some(10), NOW),
        db.commit(a, &right, Some(11), NOW)
    )?;
    let (winner, slot) = match (l, r) {
        (WriteState::Committed, WriteState::Stale) => ("left", 10),
        (WriteState::Stale, WriteState::Committed) => ("right", 11),
        states => anyhow::bail!("expected one concurrent CAS winner: {states:?}"),
    };
    let history = db.history(a, None).await?;
    ensure!(
        history.len() == 1 && history[0].1["label"] == winner,
        "stale transaction wrote a snapshot"
    );
    let first_id = history[0].0;
    let (latest, payload) = db
        .tracked_forecast(a)
        .await?
        .context("missing committed forecast")?;
    ensure!(
        latest.version == 1 && latest.state["label"] == winner && payload["label"] == winner,
        "partial CAS write"
    );
    ensure!(
        db.queue().await? == (true, vec![b.into(), a.into()]),
        "new point must come first"
    );
    let mut next = commit(a, 1, "next", NOW);
    next.payload = PayloadWrite::Keep;
    let other = commit(b, db.load_point(b).await?.version, "other", NOW);
    let (l, r) = tokio::try_join!(
        db.commit(a, &next, Some(slot + 100), NOW),
        db.commit(b, &other, Some(slot + 100), NOW)
    )?;
    ensure!(
        l == WriteState::Committed && r == WriteState::Committed,
        "cross-point slot contention"
    );
    let updated_history = db.history(a, None).await?;
    ensure!(
        updated_history.len() == 2
            && updated_history[0].1["label"] == "next"
            && updated_history[0].0 > first_id,
        "first concurrent slot missing"
    );
    let other_history = db.history(b, None).await?;
    ensure!(
        other_history.len() == 1
            && other_history[0].0 > first_id
            && other_history[0].0 != updated_history[0].0
            && other_history[0].1["label"] == "other",
        "cross-point snapshot missing"
    );
    let (state, payload) = db
        .tracked_forecast(a)
        .await?
        .context("expected kept forecast")?;
    ensure!(
        state.version == 2 && state.state["label"] == "next" && payload["label"] == winner,
        "keep payload"
    );
    let mut clear = commit(a, 2, "clear", NOW);
    clear.payload = PayloadWrite::Clear;
    ensure!(
        db.commit(a, &clear, Some(slot), NOW).await? == WriteState::Committed
            && db.tracked_forecast(a).await?.is_none(),
        "clear payload"
    );
    ensure!(
        db.history(a, None).await? == updated_history,
        "duplicate slot replaced an existing snapshot"
    );
    ensure!(
        db.version(a).await? == 3 && db.load_point(a).await?.built_date.is_none(),
        "clear date and increment version"
    );
    db.replace_tracked(&[], NOW + 1).await?;
    ensure!(
        db.queue().await? == (true, vec![]) && db.tracked_forecast(b).await?.is_none(),
        "empty sync and untracked visibility"
    );

    let p = "history";
    let mut ids = vec![];
    for i in 0..12 {
        ids.push(
            db.save_snapshot(p, &snapshot(p, &i.to_string(), NOW))
                .await?,
        );
    }
    let boundary = db
        .save_snapshot(p, &snapshot(p, "boundary", NOW - 38 * DAY))
        .await?;
    let older = db
        .save_snapshot(p, &snapshot(p, "older", NOW - 38 * DAY - 1))
        .await?;
    let no_hourly = SnapshotContent {
        hourly_snow: None,
        ..snapshot(p, "no-hourly", NOW + 1)
    };
    let latest = db.save_snapshot(p, &no_hourly).await?;
    ensure!(
        ids[0] > other_history[0].0.max(updated_history[0].0)
            && ids.windows(2).all(|v| v[1] > v[0])
            && latest > older
            && older > boundary,
        "sequence id order"
    );
    let first_page: Vec<_> = db
        .history(p, None)
        .await?
        .iter()
        .map(|(id, _)| *id)
        .collect();
    let expected: Vec<_> = std::iter::once(latest)
        .chain(ids.iter().rev().take(10).copied())
        .collect();
    ensure!(first_page == expected, "first page plus lookahead");
    let second_page: Vec<_> = db
        .history(p, Some(first_page[9]))
        .await?
        .iter()
        .map(|(id, _)| *id)
        .collect();
    ensure!(
        second_page == [ids[2], ids[1], ids[0], boundary, older],
        "pagination lost a tied or older row"
    );
    ensure!(
        db.history(p, Some(first_id)).await?.is_empty(),
        "cross-point cursor"
    );
    let accuracy = db.accuracy(p, NOW).await?;
    ensure!(
        accuracy.iter().map(|s| s.id).collect::<Vec<_>>() == [ids[11], boundary],
        "accuracy ranking, cutoff, or null filtering"
    );
    ensure!(
        accuracy[0].query["pointId"] == p
            && accuracy[0].hourly_snow.as_ref().unwrap()["label"] == "11",
        "accuracy row"
    );
    Ok(())
}

#[tokio::test]
#[ignore = "requires a disposable PostgreSQL database in DATABASE_URL"]
async fn postgres() -> Result<()> {
    env::var("DATABASE_URL")
        .context("DATABASE_URL must point to a disposable PostgreSQL database")?;
    let db = Db::from_env().await?;
    db.connection()
        .await?
        .batch_execute("CREATE SCHEMA snow")
        .await
        .context("test requires a database without a snow schema")?;
    let result = run(&db).await;
    db.connection()
        .await?
        .batch_execute("DROP SCHEMA snow CASCADE")
        .await?;
    result
}

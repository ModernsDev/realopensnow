CREATE TABLE forecast_snapshots (
  id INTEGER PRIMARY KEY,
  point TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  payload TEXT NOT NULL,
  hourly_snow TEXT
);
--> statement-breakpoint
CREATE INDEX forecast_snapshots_point_time ON forecast_snapshots (point, fetched_at DESC, id DESC);

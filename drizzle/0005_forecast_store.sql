CREATE TABLE forecast_records (
  point TEXT NOT NULL,
  model TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  first_hour INTEGER NOT NULL,
  last_hour INTEGER NOT NULL,
  members TEXT NOT NULL,
  hourly TEXT NOT NULL,
  units TEXT NOT NULL,
  grid TEXT NOT NULL,
  PRIMARY KEY (point, model, fetched_at)
);
--> statement-breakpoint
CREATE INDEX forecast_records_fetched ON forecast_records (fetched_at);
--> statement-breakpoint
CREATE TABLE forecast_latest (
  point TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  config TEXT,
  state TEXT,
  series TEXT,
  built_date TEXT,
  payload TEXT,
  updated_at INTEGER
);
--> statement-breakpoint
ALTER TABLE forecast_snapshots ADD COLUMN cron_slot INTEGER;
--> statement-breakpoint
CREATE UNIQUE INDEX forecast_snapshots_slot ON forecast_snapshots (point, cron_slot);

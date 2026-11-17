CREATE TABLE forecast_cache (
  point TEXT PRIMARY KEY,
  slot INTEGER NOT NULL,
  status INTEGER NOT NULL,
  fetched TEXT,
  body TEXT
);

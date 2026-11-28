CREATE TABLE snow.snapshots (
    id BIGINT PRIMARY KEY,
    point TEXT NOT NULL,
    fetched_at BIGINT NOT NULL,
    slot BIGINT,
    payload TEXT NOT NULL,
    hourly_snow TEXT
);

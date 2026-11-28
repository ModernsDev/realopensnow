CREATE TABLE snow.points (
    point TEXT PRIMARY KEY,
    version BIGINT NOT NULL,
    config TEXT,
    state TEXT,
    series TEXT,
    built_date TEXT,
    payload TEXT,
    updated_at BIGINT
);

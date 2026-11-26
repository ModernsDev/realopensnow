CREATE TABLE user_settings (
  user_id TEXT PRIMARY KEY REFERENCES "user" ("id") ON DELETE CASCADE,
  units TEXT NOT NULL,
  weights TEXT NOT NULL,
  hidden_models TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE user_favorites (
  user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  resort_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (user_id, resort_id)
);
--> statement-breakpoint
CREATE TABLE user_locations (
  user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  id TEXT NOT NULL,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  elevation INTEGER NOT NULL,
  timezone TEXT NOT NULL,
  created_on TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);
--> statement-breakpoint
INSERT INTO user_settings SELECT user_id, json_extract(payload, '$.units'), json_extract(payload, '$.weights'), json_extract(payload, '$.hidden'), updated_at FROM user_data
WHERE json_type(payload, '$.units') = 'object' AND json_type(payload, '$.weights') = 'object' AND json_type(payload, '$.hidden') = 'array';
--> statement-breakpoint
INSERT INTO user_favorites SELECT d.user_id, f.value, f.key FROM user_data d, json_each(d.payload, '$.favorites') f;
--> statement-breakpoint
INSERT INTO user_locations SELECT d.user_id, json_extract(l.value, '$.id'), l.key, json_extract(l.value, '$.name'), json_extract(l.value, '$.lat'), json_extract(l.value, '$.lon'),
  json_extract(l.value, '$.elevation'), json_extract(l.value, '$.timezone'), json_extract(l.value, '$.createdOn') FROM user_data d, json_each(d.payload, '$.customLocations') l;
--> statement-breakpoint
DROP TABLE user_data;

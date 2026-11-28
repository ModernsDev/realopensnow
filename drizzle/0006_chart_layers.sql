ALTER TABLE user_settings ADD COLUMN chart_layers TEXT NOT NULL DEFAULT '{"quality":true,"agreement":true,"range":true}';

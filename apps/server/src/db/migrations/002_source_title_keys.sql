ALTER TABLE source_records
  ADD COLUMN IF NOT EXISTS title_keys text[] NOT NULL DEFAULT '{}';

ALTER TABLE source_records
  ADD COLUMN IF NOT EXISTS title_keys_version integer NOT NULL DEFAULT 0;

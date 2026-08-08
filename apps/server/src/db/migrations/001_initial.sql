CREATE TABLE IF NOT EXISTS schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source_records (
  source text NOT NULL CHECK (source IN ('vndb', 'bangumi')),
  source_id text NOT NULL,
  title text NOT NULL,
  normalized_title text NOT NULL,
  release_date text,
  normalized jsonb NOT NULL,
  raw jsonb NOT NULL,
  content_hash text NOT NULL,
  fetched_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, source_id)
);

CREATE INDEX IF NOT EXISTS source_records_normalized_title_idx
  ON source_records (normalized_title);

CREATE TABLE IF NOT EXISTS canonical_visual_novels (
  id uuid PRIMARY KEY,
  display_title text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  review_status text NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'verified', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source_links (
  canonical_id uuid NOT NULL REFERENCES canonical_visual_novels(id) ON DELETE CASCADE,
  source text NOT NULL,
  source_id text NOT NULL,
  confidence integer NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  link_status text NOT NULL CHECK (link_status IN ('suggested', 'verified', 'rejected')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  PRIMARY KEY (source, source_id),
  FOREIGN KEY (source, source_id) REFERENCES source_records(source, source_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS source_links_canonical_id_idx ON source_links (canonical_id);

CREATE TABLE IF NOT EXISTS sync_runs (
  id uuid PRIMARY KEY,
  source text NOT NULL CHECK (source IN ('vndb', 'bangumi')),
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  cursor text,
  records_seen integer NOT NULL DEFAULT 0,
  records_written integer NOT NULL DEFAULT 0,
  error_code text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS match_records (
  id uuid PRIMARY KEY,
  room_code text,
  mode text NOT NULL CHECK (mode IN ('solo', 'duel', 'race')),
  rules_snapshot jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'finished', 'abandoned')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS match_rounds (
  id uuid PRIMARY KEY,
  match_id uuid NOT NULL REFERENCES match_records(id) ON DELETE CASCADE,
  round_number integer NOT NULL CHECK (round_number > 0),
  answer_canonical_id uuid NOT NULL REFERENCES canonical_visual_novels(id),
  answer_snapshot jsonb NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (match_id, round_number)
);

CREATE TABLE IF NOT EXISTS guesses (
  id uuid PRIMARY KEY,
  round_id uuid NOT NULL REFERENCES match_rounds(id) ON DELETE CASCADE,
  player_id uuid NOT NULL,
  guessed_canonical_id uuid NOT NULL REFERENCES canonical_visual_novels(id),
  guess_number integer NOT NULL CHECK (guess_number > 0),
  comparison_result jsonb NOT NULL,
  is_correct boolean NOT NULL,
  guessed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (round_id, player_id, guess_number)
);

ALTER TABLE match_records
  ADD COLUMN IF NOT EXISTS ranked_match boolean NOT NULL DEFAULT false;

ALTER TABLE match_records
  ADD COLUMN IF NOT EXISTS ranked_fame_tier text;

ALTER TABLE match_records
  ADD COLUMN IF NOT EXISTS ranked_best_of integer;

ALTER TABLE match_players
  ADD COLUMN IF NOT EXISTS pt_delta integer NOT NULL DEFAULT 0;

ALTER TABLE match_players
  ADD COLUMN IF NOT EXISTS pt_after integer;

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS ranked_pt integer NOT NULL DEFAULT 0;

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS ranked_matches integer NOT NULL DEFAULT 0;

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS ranked_wins integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS players_ranked_leaderboard_idx
  ON players (ranked_pt DESC, ranked_wins DESC, ranked_matches ASC);

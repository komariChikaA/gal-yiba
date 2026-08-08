CREATE TABLE IF NOT EXISTS match_players (
  match_id uuid NOT NULL REFERENCES match_records(id) ON DELETE CASCADE,
  player_id uuid NOT NULL,
  nickname text NOT NULL,
  wins integer NOT NULL DEFAULT 0,
  is_winner boolean NOT NULL DEFAULT false,
  PRIMARY KEY (match_id, player_id)
);

CREATE INDEX IF NOT EXISTS match_players_player_id_idx
  ON match_players (player_id);

CREATE TABLE IF NOT EXISTS players (
  player_id uuid PRIMARY KEY,
  nickname text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE match_rounds
  ADD COLUMN IF NOT EXISTS winner_player_id uuid;

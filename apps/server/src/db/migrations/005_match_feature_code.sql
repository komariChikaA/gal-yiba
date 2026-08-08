-- 记录玩家特征码：用于区分匿名玩家与带特征码玩家，支持按身份清理排行榜。
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS feature_code text;

CREATE INDEX IF NOT EXISTS players_feature_code_idx
  ON players (feature_code);

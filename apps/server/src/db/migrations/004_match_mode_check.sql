-- 线上库的 match_records 由早期迁移创建，mode 检查约束缺失 'duel'/'solo'，
-- 导致 1v1 与单人比赛无法写入。重建约束使其与当前模式枚举一致。
ALTER TABLE match_records
  DROP CONSTRAINT IF EXISTS match_records_mode_check;

ALTER TABLE match_records
  ADD CONSTRAINT match_records_mode_check
  CHECK (mode IN ('solo', 'duel', 'race'));

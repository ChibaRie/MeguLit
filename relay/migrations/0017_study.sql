-- SPDX-License-Identifier: GPL-3.0-or-later
-- 2026-11-15 学习练习 board: every study practice in one ranking. The parts are kept per row (kana is already there
-- from 0008): grammar answers, Anki cards answered, other practice (MeguLit word reviews, grammar-map finds) and the
-- time spent. `study` = kana + grammar + anki + practice, written by the relay on each post. Rows from clients that
-- only know kana keep study = kana. Applies after 0016.
ALTER TABLE leaderboard_stats ADD COLUMN grammar INTEGER NOT NULL DEFAULT 0;
ALTER TABLE leaderboard_stats ADD COLUMN anki INTEGER NOT NULL DEFAULT 0;
ALTER TABLE leaderboard_stats ADD COLUMN practice INTEGER NOT NULL DEFAULT 0;
ALTER TABLE leaderboard_stats ADD COLUMN study_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE leaderboard_stats ADD COLUMN study INTEGER NOT NULL DEFAULT 0;
UPDATE leaderboard_stats SET study=kana;
CREATE INDEX IF NOT EXISTS stats_by_study ON leaderboard_stats(period, period_key, study DESC);

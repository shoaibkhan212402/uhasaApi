ALTER TABLE trainers
  ADD COLUMN sort_order INT NOT NULL DEFAULT 0 AFTER is_published;

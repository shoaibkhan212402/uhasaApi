ALTER TABLE participants
  ADD COLUMN archived_at DATETIME NULL AFTER status;

UPDATE participants
  SET archived_at = created_at
  WHERE status = 'cancelled' AND archived_at IS NULL;

ALTER TABLE participants
  ADD COLUMN attendance_status ENUM('pending', 'present', 'absent') NOT NULL DEFAULT 'pending' AFTER attended;

ALTER TABLE participants
  ADD COLUMN post_exam_status ENUM('pending', 'passed', 'failed') NOT NULL DEFAULT 'pending' AFTER attendance_status;

ALTER TABLE participants
  ADD COLUMN cpd_status ENUM('pending', 'credited', 'not_credited') NOT NULL DEFAULT 'pending' AFTER post_exam_status;

UPDATE participants SET attendance_status = 'present' WHERE attended = 1;

-- UASA member flag for e-learner pricing (members get free course access)

ALTER TABLE users ADD COLUMN is_uasa_member TINYINT(1) NOT NULL DEFAULT 0;

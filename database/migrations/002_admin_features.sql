ALTER TABLE participants ADD COLUMN attended TINYINT(1) NOT NULL DEFAULT 0 AFTER zoom_sent;

ALTER TABLE email_log MODIFY template_type ENUM('confirmation', 'invoice', 'reminder', 'zoom', 'survey') NOT NULL;

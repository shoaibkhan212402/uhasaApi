ALTER TABLE workshops
  ADD COLUMN certificate_note VARCHAR(500) NULL AFTER invitation_banner_url;

ALTER TABLE participants
  ADD COLUMN certificate_sent TINYINT(1) NOT NULL DEFAULT 0 AFTER invitation_sent;

ALTER TABLE email_log
  MODIFY template_type ENUM('confirmation', 'invoice', 'reminder', 'zoom', 'survey', 'invitation', 'certificate') NOT NULL;

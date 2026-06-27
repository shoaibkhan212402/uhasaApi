ALTER TABLE workshops
  ADD COLUMN invitation_program_label VARCHAR(255) NOT NULL DEFAULT 'Online CPD Program' AFTER zoom_link,
  ADD COLUMN invitation_subtitle VARCHAR(500) NULL AFTER invitation_program_label,
  ADD COLUMN meeting_id VARCHAR(50) NULL AFTER invitation_subtitle,
  ADD COLUMN meeting_passcode VARCHAR(100) NULL AFTER meeting_id,
  ADD COLUMN training_materials_url VARCHAR(1000) NULL AFTER meeting_passcode,
  ADD COLUMN pre_assessment_url VARCHAR(1000) NULL AFTER training_materials_url,
  ADD COLUMN post_assessment_url VARCHAR(1000) NULL AFTER pre_assessment_url,
  ADD COLUMN invitation_banner_url VARCHAR(1000) NULL AFTER post_assessment_url;

ALTER TABLE participants
  ADD COLUMN invitation_sent TINYINT(1) NOT NULL DEFAULT 0 AFTER zoom_sent;

ALTER TABLE email_log
  MODIFY template_type ENUM('confirmation', 'invoice', 'reminder', 'zoom', 'survey', 'invitation') NOT NULL;

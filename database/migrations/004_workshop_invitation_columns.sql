ALTER TABLE workshops ADD COLUMN invitation_program_label VARCHAR(255) NOT NULL DEFAULT 'Online CPD Program' AFTER zoom_link;
ALTER TABLE workshops ADD COLUMN invitation_subtitle VARCHAR(500) NULL AFTER invitation_program_label;
ALTER TABLE workshops ADD COLUMN meeting_id VARCHAR(50) NULL AFTER invitation_subtitle;
ALTER TABLE workshops ADD COLUMN meeting_passcode VARCHAR(100) NULL AFTER meeting_id;
ALTER TABLE workshops ADD COLUMN training_materials_url VARCHAR(1000) NULL AFTER meeting_passcode;
ALTER TABLE workshops ADD COLUMN pre_assessment_url VARCHAR(1000) NULL AFTER training_materials_url;
ALTER TABLE workshops ADD COLUMN post_assessment_url VARCHAR(1000) NULL AFTER pre_assessment_url;
ALTER TABLE workshops ADD COLUMN invitation_banner_url VARCHAR(1000) NULL AFTER post_assessment_url;

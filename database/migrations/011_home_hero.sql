ALTER TABLE slider_banners
  ADD COLUMN title VARCHAR(255) NOT NULL DEFAULT '' AFTER image_url,
  ADD COLUMN subtitle VARCHAR(500) NOT NULL DEFAULT '' AFTER title;

INSERT INTO site_settings (setting_key, setting_value) VALUES
  ('hero_badge', '2026 CPD Programs Now Open'),
  ('hero_title_1', 'Structured CPD'),
  ('hero_title_2', 'Training Programs'),
  ('hero_description', 'Our CPD offerings align with international financial standards, regulatory frameworks, and best practices applicable to banking, accounting, investment, fintech, and financial services.'),
  ('hero_bg_image', ''),
  ('hero_cta_primary_label', 'Explore Our Courses'),
  ('hero_cta_primary_url', '/workshops'),
  ('hero_cta_secondary_label', 'Learn More'),
  ('hero_cta_secondary_url', '/about')
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);

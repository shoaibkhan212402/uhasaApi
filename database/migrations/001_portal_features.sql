-- Portal features migration (idempotent via migrate.ts)

ALTER TABLE users
  MODIFY role ENUM('admin', 'corporate', 'bank', 'cto', 'cma') NOT NULL DEFAULT 'corporate';

ALTER TABLE users ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active;
ALTER TABLE users ADD COLUMN company VARCHAR(255) NULL AFTER name;
ALTER TABLE users ADD COLUMN bank_id INT NULL AFTER company;

ALTER TABLE workshops ADD COLUMN cto_cma_limit INT NOT NULL DEFAULT 3 AFTER total_seats;
ALTER TABLE workshops ADD COLUMN zoom_link VARCHAR(1000) NULL AFTER cto_cma_limit;
ALTER TABLE workshops ADD COLUMN reminder_days_before INT NOT NULL DEFAULT 1 AFTER zoom_link;

CREATE TABLE IF NOT EXISTS banks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  auto_invoice TINYINT(1) NOT NULL DEFAULT 1,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS participants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  workshop_id INT NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NULL,
  person_id VARCHAR(100) NULL,
  job_position VARCHAR(255) NULL,
  status ENUM('pending', 'confirmed', 'cancelled') NOT NULL DEFAULT 'confirmed',
  invoice_id INT NULL,
  confirmation_sent TINYINT(1) NOT NULL DEFAULT 0,
  reminder_sent TINYINT(1) NOT NULL DEFAULT 0,
  zoom_sent TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE,
  INDEX idx_participants_user (user_id),
  INDEX idx_participants_workshop (workshop_id),
  UNIQUE KEY uk_participant_user_workshop_email (user_id, workshop_id, email)
);

CREATE TABLE IF NOT EXISTS invoices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  invoice_number VARCHAR(50) NOT NULL UNIQUE,
  user_id INT NOT NULL,
  workshop_id INT NOT NULL,
  participant_id INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  vat_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  status ENUM('draft', 'sent', 'paid', 'cancelled') NOT NULL DEFAULT 'sent',
  sent_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
  INDEX idx_invoices_user (user_id)
);

CREATE TABLE IF NOT EXISTS email_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  recipient VARCHAR(255) NOT NULL,
  subject VARCHAR(500) NOT NULL,
  template_type ENUM('confirmation', 'invoice', 'reminder', 'zoom') NOT NULL,
  participant_id INT NULL,
  status ENUM('sent', 'failed') NOT NULL DEFAULT 'sent',
  error_message TEXT NULL,
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE SET NULL
);

INSERT INTO banks (name, auto_invoice) VALUES
('Emirates NBD Capital Limited', 1),
('First Abu Dhabi Bank', 1),
('Mashreq Bank', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO site_settings (setting_key, setting_value) VALUES
('default_cto_cma_limit', '3'),
('smtp_from_name', 'UASA Training'),
('smtp_from_email', 'info@uasatraining.com')
ON DUPLICATE KEY UPDATE setting_key = setting_key;

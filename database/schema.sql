CREATE DATABASE IF NOT EXISTS uasa_training CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE uasa_training;

-- Admin & portal users
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL DEFAULT '',
  company VARCHAR(255) NULL,
  bank_id INT NULL,
  role ENUM('admin', 'corporate', 'bank', 'cto', 'cma', 'individual') NOT NULL DEFAULT 'corporate',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  must_change_password TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Banks (invoice exemption configurable per bank)
CREATE TABLE IF NOT EXISTS banks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  auto_invoice TINYINT(1) NOT NULL DEFAULT 1,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Workshops
CREATE TABLE IF NOT EXISTS workshops (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  title_2 VARCHAR(500) NULL,
  category ENUM('AML / Cybersecurity / Securities Innovation', 'Other Topics') NOT NULL DEFAULT 'Other Topics',
  cpd_hours INT NOT NULL DEFAULT 0,
  start_date DATETIME NOT NULL,
  end_date DATETIME NOT NULL,
  time_slot VARCHAR(100) NOT NULL DEFAULT '',
  language ENUM('English', 'Arabic', 'Both') NULL,
  format ENUM('Online', 'In-Person', 'Hybrid') NOT NULL DEFAULT 'Online',
  image_url VARCHAR(1000) NULL,
  description TEXT NULL,
  price DECIMAL(10,2) NOT NULL DEFAULT 1950.00,
  total_seats INT NOT NULL DEFAULT 30,
  cto_cma_limit INT NOT NULL DEFAULT 3,
  zoom_link VARCHAR(1000) NULL,
  invitation_program_label VARCHAR(255) NOT NULL DEFAULT 'Online CPD Program',
  invitation_subtitle VARCHAR(500) NULL,
  meeting_id VARCHAR(50) NULL,
  meeting_passcode VARCHAR(100) NULL,
  training_materials_url VARCHAR(1000) NULL,
  pre_assessment_url VARCHAR(1000) NULL,
  post_assessment_url VARCHAR(1000) NULL,
  invitation_banner_url VARCHAR(1000) NULL,
  certificate_note VARCHAR(500) NULL,
  reminder_days_before INT NOT NULL DEFAULT 1,
  is_published TINYINT(1) NOT NULL DEFAULT 1,
  display_order INT NOT NULL DEFAULT 0,
  registration_open TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_workshops_dates (start_date, end_date),
  INDEX idx_workshops_published (is_published)
);

-- Workshop accordion/content sections
CREATE TABLE IF NOT EXISTS workshop_sections (
  id INT AUTO_INCREMENT PRIMARY KEY,
  workshop_id INT NOT NULL,
  section_key VARCHAR(100) NOT NULL,
  title VARCHAR(255) NOT NULL,
  content LONGTEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE,
  UNIQUE KEY uk_workshop_section (workshop_id, section_key)
);

-- Trainers
CREATE TABLE IF NOT EXISTS trainers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  title VARCHAR(255) NOT NULL DEFAULT '',
  image_url VARCHAR(1000) NULL,
  bio TEXT NULL,
  expertise JSON NULL,
  email VARCHAR(255) NULL,
  linkedin_url VARCHAR(500) NULL,
  is_published TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Registrations
CREATE TABLE IF NOT EXISTS registrations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  workshop_id INT NULL,
  registration_type ENUM('Individual', 'Corporate', 'Bank') NOT NULL,
  person_id VARCHAR(100) NULL,
  full_name VARCHAR(255) NOT NULL,
  coordinator_name VARCHAR(255) NULL,
  username VARCHAR(255) NULL,
  job_position VARCHAR(255) NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NULL,
  company VARCHAR(255) NULL,
  company_address TEXT NULL,
  company_phone VARCHAR(50) NULL,
  company_trn VARCHAR(100) NULL,
  total_seats INT NULL DEFAULT 1,
  terms_accepted TINYINT(1) NOT NULL DEFAULT 0,
  total_amount DECIMAL(10,2) NULL,
  invoice_number VARCHAR(50) NULL,
  invoice_type VARCHAR(20) NULL,
  status ENUM('pending', 'confirmed', 'cancelled') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE,
  INDEX idx_registrations_workshop (workshop_id),
  INDEX idx_registrations_email (email)
);

-- Portal participants (Corporate, Bank, CTO, CMA)
CREATE TABLE IF NOT EXISTS participants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  workshop_id INT NULL,
  full_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NULL,
  person_id VARCHAR(100) NULL,
  job_position VARCHAR(255) NULL,
  status ENUM('pending', 'confirmed', 'cancelled') NOT NULL DEFAULT 'confirmed',
  archived_at DATETIME NULL,
  invoice_id INT NULL,
  confirmation_sent TINYINT(1) NOT NULL DEFAULT 0,
  reminder_sent TINYINT(1) NOT NULL DEFAULT 0,
  zoom_sent TINYINT(1) NOT NULL DEFAULT 0,
  invitation_sent TINYINT(1) NOT NULL DEFAULT 0,
  certificate_sent TINYINT(1) NOT NULL DEFAULT 0,
  attended TINYINT(1) NOT NULL DEFAULT 0,
  attendance_status ENUM('pending', 'present', 'absent') NOT NULL DEFAULT 'pending',
  post_exam_status ENUM('pending', 'passed', 'failed') NOT NULL DEFAULT 'pending',
  cpd_status ENUM('pending', 'credited', 'not_credited') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE,
  INDEX idx_participants_user (user_id),
  INDEX idx_participants_workshop (workshop_id),
  UNIQUE KEY uk_participant_user_workshop_email (user_id, workshop_id, email)
);

-- Invoices (Corporate & Bank participants)
CREATE TABLE IF NOT EXISTS invoices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  invoice_number VARCHAR(50) NOT NULL UNIQUE,
  user_id INT NOT NULL,
  workshop_id INT NULL,
  participant_id INT NULL,
  registration_id INT NULL,
  amount DECIMAL(10,2) NOT NULL,
  vat_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(10,2) NOT NULL,
  status ENUM('draft', 'sent', 'paid', 'cancelled') NOT NULL DEFAULT 'sent',
  sent_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
  INDEX idx_invoices_user (user_id),
  INDEX idx_invoices_registration (registration_id)
);

CREATE TABLE IF NOT EXISTS email_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  recipient VARCHAR(255) NOT NULL,
  subject VARCHAR(500) NOT NULL,
  template_type ENUM('confirmation', 'invoice', 'reminder', 'zoom', 'survey', 'invitation', 'certificate') NOT NULL,
  participant_id INT NULL,
  status ENUM('sent', 'failed') NOT NULL DEFAULT 'sent',
  error_message TEXT NULL,
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE SET NULL
);

-- E-learning courses
CREATE TABLE IF NOT EXISTS elearning_courses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  category VARCHAR(100) NOT NULL DEFAULT '',
  hours INT NOT NULL DEFAULT 0,
  lessons INT NOT NULL DEFAULT 0,
  level ENUM('Beginner', 'Intermediate', 'Advanced') NOT NULL DEFAULT 'Beginner',
  image_url VARCHAR(1000) NULL,
  video_url VARCHAR(1000) NULL,
  pdf_url VARCHAR(1000) NULL,
  description TEXT NULL,
  is_published TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- CMS page sections (home, about, contact, etc.)
CREATE TABLE IF NOT EXISTS page_sections (
  id INT AUTO_INCREMENT PRIMARY KEY,
  page_slug VARCHAR(100) NOT NULL,
  section_key VARCHAR(100) NOT NULL,
  title VARCHAR(255) NOT NULL DEFAULT '',
  content LONGTEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_published TINYINT(1) NOT NULL DEFAULT 1,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_page_section (page_slug, section_key),
  INDEX idx_page_slug (page_slug)
);

-- Contact form submissions
CREATE TABLE IF NOT EXISTS contact_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NULL,
  subject VARCHAR(500) NOT NULL,
  message TEXT NOT NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Media files (uploaded via FTP)
CREATE TABLE IF NOT EXISTS media_files (
  id INT AUTO_INCREMENT PRIMARY KEY,
  filename VARCHAR(500) NOT NULL,
  original_name VARCHAR(500) NOT NULL,
  file_type ENUM('image', 'video', 'pdf', 'document', 'other') NOT NULL DEFAULT 'other',
  mime_type VARCHAR(100) NULL,
  file_size INT NOT NULL DEFAULT 0,
  url VARCHAR(1000) NOT NULL,
  folder VARCHAR(255) NOT NULL DEFAULT 'uploads',
  uploaded_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Homepage slider banners
CREATE TABLE IF NOT EXISTS slider_banners (
  id INT AUTO_INCREMENT PRIMARY KEY,
  image_url VARCHAR(1000) NOT NULL,
  title VARCHAR(255) NOT NULL DEFAULT '',
  subtitle VARCHAR(500) NOT NULL DEFAULT '',
  alt_text VARCHAR(255) NOT NULL DEFAULT '',
  link_url VARCHAR(1000) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_published TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_slider_banners_published (is_published, sort_order)
);

-- Site settings (key-value store)
CREATE TABLE IF NOT EXISTS site_settings (
  setting_key VARCHAR(100) PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Default admin is created by: npm run db:init

-- Default site settings
INSERT INTO site_settings (setting_key, setting_value) VALUES
('site_name', 'UASA Training'),
('contact_phone_1', '+971 4 2900 056'),
('contact_phone_2', '+971 4 2900 057'),
('contact_email', 'info@uasatraining.com'),
('contact_address', 'SCA Building, Securities & Commodities Authority, Dubai Branch - 1st Floor - 5th St - Al Garhoud - Dubai'),
('working_hours', 'Sunday - Thursday: 9:00 AM - 5:00 PM'),
('vat_rate', '0.05'),
('default_cto_cma_limit', '3'),
('smtp_from_name', 'UASA Training'),
('smtp_from_email', 'info@uasatraining.com')
ON DUPLICATE KEY UPDATE setting_key = setting_key;

INSERT INTO banks (name, auto_invoice) VALUES
('Emirates NBD Capital Limited', 1),
('First Abu Dhabi Bank', 1),
('Mashreq Bank', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name);

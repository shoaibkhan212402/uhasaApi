-- E-Learning LMS: elearner role, course extensions, lessons, quizzes, progress, certificates

ALTER TABLE users
  MODIFY role ENUM('admin', 'corporate', 'bank', 'cto', 'cma', 'individual', 'elearner') NOT NULL DEFAULT 'corporate';

ALTER TABLE elearning_courses
  ADD COLUMN workshop_id INT NULL AFTER id,
  ADD COLUMN price DECIMAL(10, 2) NOT NULL DEFAULT 0 AFTER sort_order,
  ADD COLUMN enrollment_type ENUM('open', 'paid', 'both') NOT NULL DEFAULT 'open' AFTER price,
  ADD COLUMN pass_score INT NOT NULL DEFAULT 60 AFTER enrollment_type,
  ADD COLUMN min_watch_pct INT NOT NULL DEFAULT 90 AFTER pass_score,
  ADD COLUMN quiz_unlock_mode ENUM('on_completion', 'at_timestamp', 'both') NOT NULL DEFAULT 'on_completion' AFTER min_watch_pct,
  ADD COLUMN certificate_note TEXT NULL AFTER quiz_unlock_mode,
  ADD INDEX idx_elearning_workshop (workshop_id),
  ADD CONSTRAINT fk_elearning_workshop FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS elearning_lessons (
  id INT AUTO_INCREMENT PRIMARY KEY,
  course_id INT NOT NULL,
  title VARCHAR(500) NOT NULL,
  video_url VARCHAR(1000) NULL,
  pdf_url VARCHAR(1000) NULL,
  duration_seconds INT NOT NULL DEFAULT 0,
  quiz_unlock_at_seconds INT NULL COMMENT 'Unlock quiz at timestamp in seconds, null uses course quiz_unlock_mode',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (course_id) REFERENCES elearning_courses(id) ON DELETE CASCADE,
  INDEX idx_lessons_course (course_id)
);

CREATE TABLE IF NOT EXISTS elearning_quizzes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  course_id INT NULL,
  lesson_id INT NULL,
  title VARCHAR(500) NOT NULL DEFAULT 'Assessment',
  pass_score INT NOT NULL DEFAULT 60,
  max_attempts INT NOT NULL DEFAULT 3,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (course_id) REFERENCES elearning_courses(id) ON DELETE CASCADE,
  FOREIGN KEY (lesson_id) REFERENCES elearning_lessons(id) ON DELETE CASCADE,
  INDEX idx_quizzes_course (course_id),
  INDEX idx_quizzes_lesson (lesson_id)
);

CREATE TABLE IF NOT EXISTS elearning_quiz_questions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  quiz_id INT NOT NULL,
  question_text TEXT NOT NULL,
  options JSON NOT NULL COMMENT '[{"id":"a","text":"..."}]',
  correct_option_id VARCHAR(50) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (quiz_id) REFERENCES elearning_quizzes(id) ON DELETE CASCADE,
  INDEX idx_questions_quiz (quiz_id)
);

CREATE TABLE IF NOT EXISTS elearning_enrollments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  course_id INT NOT NULL,
  status ENUM('active', 'completed', 'expired') NOT NULL DEFAULT 'active',
  payment_reference VARCHAR(255) NULL,
  enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  UNIQUE KEY uk_elearning_enrollment (user_id, course_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (course_id) REFERENCES elearning_courses(id) ON DELETE CASCADE,
  INDEX idx_enrollments_user (user_id),
  INDEX idx_enrollments_course (course_id)
);

CREATE TABLE IF NOT EXISTS elearning_video_progress (
  id INT AUTO_INCREMENT PRIMARY KEY,
  enrollment_id INT NOT NULL,
  lesson_id INT NOT NULL,
  watched_seconds INT NOT NULL DEFAULT 0,
  max_watched_seconds INT NOT NULL DEFAULT 0,
  completed_at TIMESTAMP NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_progress_enrollment_lesson (enrollment_id, lesson_id),
  FOREIGN KEY (enrollment_id) REFERENCES elearning_enrollments(id) ON DELETE CASCADE,
  FOREIGN KEY (lesson_id) REFERENCES elearning_lessons(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS elearning_quiz_attempts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  enrollment_id INT NOT NULL,
  quiz_id INT NOT NULL,
  score INT NOT NULL,
  total_questions INT NOT NULL,
  passed TINYINT(1) NOT NULL DEFAULT 0,
  answers JSON NULL,
  attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (enrollment_id) REFERENCES elearning_enrollments(id) ON DELETE CASCADE,
  FOREIGN KEY (quiz_id) REFERENCES elearning_quizzes(id) ON DELETE CASCADE,
  INDEX idx_attempts_enrollment (enrollment_id),
  INDEX idx_attempts_quiz (quiz_id)
);

CREATE TABLE IF NOT EXISTS elearning_certificates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  enrollment_id INT NOT NULL,
  issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  certificate_sent TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uk_cert_enrollment (enrollment_id),
  FOREIGN KEY (enrollment_id) REFERENCES elearning_enrollments(id) ON DELETE CASCADE
);

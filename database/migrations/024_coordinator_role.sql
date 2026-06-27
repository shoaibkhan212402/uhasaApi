ALTER TABLE users MODIFY COLUMN role ENUM('admin', 'corporate', 'bank', 'cto', 'cma', 'individual', 'elearner', 'coordinator') NOT NULL DEFAULT 'corporate';

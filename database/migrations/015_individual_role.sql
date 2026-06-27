-- Add individual user role for self-service portal
ALTER TABLE users
  MODIFY role ENUM('admin', 'corporate', 'bank', 'cto', 'cma', 'individual') NOT NULL DEFAULT 'corporate';

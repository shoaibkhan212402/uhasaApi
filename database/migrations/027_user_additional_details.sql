-- Migration to add phone, company_address, and company_trn to the users table
ALTER TABLE users ADD COLUMN phone VARCHAR(50) NULL AFTER bank_id;
ALTER TABLE users ADD COLUMN company_address TEXT NULL AFTER phone;
ALTER TABLE users ADD COLUMN company_trn VARCHAR(100) NULL AFTER company_address;

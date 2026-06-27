ALTER TABLE registrations
  ADD COLUMN invoice_number VARCHAR(50) NULL AFTER total_amount;

ALTER TABLE registrations
  MODIFY workshop_id INT NULL;

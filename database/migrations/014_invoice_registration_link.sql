ALTER TABLE registrations
  ADD COLUMN invoice_type VARCHAR(20) NULL AFTER invoice_number;

ALTER TABLE invoices
  ADD COLUMN registration_id INT NULL AFTER participant_id,
  MODIFY participant_id INT NULL,
  MODIFY workshop_id INT NULL;

ALTER TABLE invoices
  ADD INDEX idx_invoices_registration (registration_id);

ALTER TABLE invoices
  ADD CONSTRAINT fk_invoices_registration
  FOREIGN KEY (registration_id) REFERENCES registrations(id) ON DELETE CASCADE;

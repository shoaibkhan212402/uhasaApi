CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cart_id VARCHAR(64) NOT NULL UNIQUE,
  telr_order_ref VARCHAR(64) NULL,
  amount DECIMAL(10,2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'AED',
  status ENUM('pending', 'authorized', 'declined', 'cancelled', 'failed') NOT NULL DEFAULT 'pending',
  source ENUM('public_cart', 'portal_booking', 'individual_portal') NOT NULL,
  context JSON NOT NULL,
  customer_email VARCHAR(255) NOT NULL,
  customer_name VARCHAR(255) NULL,
  telr_status_code INT NULL,
  telr_response JSON NULL,
  paid_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_payments_status (status),
  INDEX idx_payments_telr_ref (telr_order_ref)
);

CREATE TABLE IF NOT EXISTS applications (
    id SERIAL PRIMARY KEY,
    reference_number VARCHAR(100) UNIQUE NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    id_number VARCHAR(20) NOT NULL,
    dob DATE NOT NULL,
    email VARCHAR(255) NOT NULL,
    cell_phone VARCHAR(20) NOT NULL,
    purpose VARCHAR(100) NOT NULL,
    bank_name VARCHAR(100) NOT NULL,
    acc_num VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    guarantor_name VARCHAR(100) NOT NULL,
    guarantor_id VARCHAR(20) NOT NULL,
    guarantor_phone VARCHAR(20) NOT NULL,
    guarantor_rel VARCHAR(50) NOT NULL,
    popia_consent BOOLEAN NOT NULL DEFAULT FALSE,
    path_id VARCHAR(255) NOT NULL,
    path_student_card VARCHAR(255) NOT NULL,
    path_registration VARCHAR(255) NOT NULL,
    path_bank_statement VARCHAR(255) NOT NULL,
    path_selfie VARCHAR(255) NOT NULL,
    path_nsfas VARCHAR(255) NOT NULL,
    path_address VARCHAR(255) NOT NULL,
    loan_amount DECIMAL(10,2),
    term_months INT,
    total_settlement DECIMAL(10,2),
    discount_applied BOOLEAN DEFAULT FALSE,
    status VARCHAR(50) DEFAULT 'Pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
    setting_key VARCHAR(50) PRIMARY KEY,
    setting_value TEXT
);

INSERT INTO settings (setting_key, setting_value) VALUES ('whatsapp_number', '27682749288') ON CONFLICT DO NOTHING;

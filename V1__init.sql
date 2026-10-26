SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS sys_admin (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(50) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  enabled TINYINT UNSIGNED NOT NULL DEFAULT 1,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sys_admin_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS survey_org (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  org_code VARCHAR(32) NOT NULL,
  org_name VARCHAR(100) NOT NULL,
  org_address VARCHAR(255) NOT NULL DEFAULT '',
  status TINYINT UNSIGNED NOT NULL DEFAULT 1,
  sort_no INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_survey_org_code (org_code),
  KEY idx_survey_org_status_sort (status, sort_no, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS survey_response (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  response_no VARCHAR(32) NOT NULL,
  submit_token CHAR(36) NOT NULL,
  questionnaire_version VARCHAR(32) NOT NULL,
  privacy_version VARCHAR(32) NOT NULL,
  org_code VARCHAR(32) NOT NULL,
  org_name VARCHAR(100) NOT NULL,
  filler_type TINYINT UNSIGNED NOT NULL,
  filler_relation VARCHAR(20) NULL,
  filler_name VARCHAR(50) NULL,
  patient_name VARCHAR(100) NOT NULL,
  gender CHAR(1) NOT NULL,
  age TINYINT UNSIGNED NOT NULL,
  phone CHAR(11) NOT NULL,
  height_cm DECIMAL(5, 1) NOT NULL,
  weight_kg DECIMAL(5, 1) NOT NULL,
  bmi DECIMAL(4, 1) NOT NULL,
  bp_status VARCHAR(20) NOT NULL,
  glucose_status VARCHAR(20) NOT NULL,
  lipid_status VARCHAR(20) NOT NULL,
  salt_status VARCHAR(20) NOT NULL,
  smoking_status VARCHAR(20) NOT NULL,
  exercise_status VARCHAR(20) NOT NULL,
  family_cvd CHAR(1) NOT NULL,
  has_cvd CHAR(1) NOT NULL,
  has_cerebro CHAR(1) NOT NULL,
  has_chronic CHAR(1) NOT NULL,
  answers_json JSON NOT NULL,
  started_at DATETIME NULL,
  submitted_at DATETIME NOT NULL,
  duration_seconds MEDIUMINT UNSIGNED NULL,
  consent_at DATETIME NOT NULL,
  font_level VARCHAR(10) NOT NULL DEFAULT 'LARGE',
  client_ip VARCHAR(45) NOT NULL DEFAULT '',
  user_agent VARCHAR(255) NOT NULL DEFAULT '',
  is_deleted TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_survey_response_no (response_no),
  UNIQUE KEY uq_survey_response_submit_token (submit_token),
  KEY idx_survey_response_submitted (is_deleted, submitted_at),
  KEY idx_survey_response_org_submitted (org_code, submitted_at),
  KEY idx_survey_response_phone (phone),
  KEY idx_survey_response_patient_name (patient_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO survey_org (org_code, org_name, status, sort_no)
SELECT 'DEFAULT', '示例医院（请修改）', 1, 0
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM survey_org WHERE org_code = 'DEFAULT'
);

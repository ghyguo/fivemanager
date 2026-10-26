ALTER TABLE survey_org
  ADD COLUMN org_address VARCHAR(255) NOT NULL DEFAULT '' AFTER org_name;

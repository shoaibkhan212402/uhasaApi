UPDATE workshops
SET language = CASE
  WHEN language IS NULL OR TRIM(language) = '' THEN NULL
  WHEN LOWER(language) LIKE '%both%' OR (LOWER(language) LIKE '%english%' AND LOWER(language) LIKE '%arabic%') THEN 'Both'
  WHEN LOWER(language) LIKE '%arabic%' THEN 'Arabic'
  ELSE 'English'
END;

ALTER TABLE workshops
  MODIFY COLUMN language ENUM('English', 'Arabic', 'Both') NULL;

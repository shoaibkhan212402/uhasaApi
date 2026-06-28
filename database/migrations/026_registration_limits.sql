-- Add separate cma_limit and hct_limit columns to workshops table
ALTER TABLE workshops
  ADD COLUMN cma_limit INT NULL DEFAULT NULL AFTER cto_cma_limit,
  ADD COLUMN hct_limit INT NULL DEFAULT NULL AFTER cma_limit;

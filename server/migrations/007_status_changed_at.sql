-- Migration 007: track when job status last changed (refused lock UI, auditing)
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;

UPDATE jobs
SET status_changed_at = COALESCE(status_changed_at, NOW())
WHERE status IN ('refused', 'accepted');

-- Migration 005: Extend jobs status lifecycle for interview tracking

ALTER TABLE jobs
  DROP CONSTRAINT IF EXISTS jobs_status_check;

ALTER TABLE jobs
  ADD CONSTRAINT jobs_status_check CHECK (
    status IN (
      'new',
      'applied',
      'hr_interview',
      'technical_interview',
      'second_technical_interview',
      'refused',
      'accepted'
    )
  );

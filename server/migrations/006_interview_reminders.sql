-- Migration 006: Interview scheduling, notes, email reminder preference

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS interview_at timestamptz,
  ADD COLUMN IF NOT EXISTS interview_notes text,
  ADD COLUMN IF NOT EXISTS interview_reminder_sent_at timestamptz;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_interview_reminders boolean NOT NULL DEFAULT true;

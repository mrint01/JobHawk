-- Migration 008: Persist generated cover letters per job and language

CREATE TABLE cover_letters (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id      uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  language    text NOT NULL CHECK (language IN ('en', 'de')),
  content     text NOT NULL,
  filename    text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, job_id, language)
);

CREATE INDEX cover_letters_user_job_idx ON cover_letters (user_id, job_id);

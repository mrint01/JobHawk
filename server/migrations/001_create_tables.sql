-- Migration 001: Create initial tables

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text NOT NULL UNIQUE,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin', 'user')),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       text NOT NULL,
  company     text NOT NULL,
  location    text,
  platform    text NOT NULL CHECK (platform IN ('linkedin', 'stepstone', 'xing')),
  url         text NOT NULL,
  posted_date timestamptz,
  description text,
  salary      text,
  job_type    text,
  scraped_at  timestamptz NOT NULL DEFAULT now(),
  status      text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'applied')),
  applied_at  timestamptz,
  UNIQUE (user_id, url)
);

CREATE TABLE platform_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform     text NOT NULL CHECK (platform IN ('linkedin', 'stepstone', 'xing')),
  username     text,
  cookies      jsonb,
  logged_in_at timestamptz,
  UNIQUE (user_id, platform)
);

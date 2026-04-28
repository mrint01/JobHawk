-- Allow storing Jobriver jobs and opt-in sessions (public listings — no credentials).

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_platform_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_platform_check
  CHECK (platform IN ('linkedin', 'stepstone', 'xing', 'indeed', 'jobriver'));

ALTER TABLE platform_sessions DROP CONSTRAINT IF EXISTS platform_sessions_platform_check;
ALTER TABLE platform_sessions ADD CONSTRAINT platform_sessions_platform_check
  CHECK (platform IN ('linkedin', 'stepstone', 'xing', 'indeed', 'jobriver'));

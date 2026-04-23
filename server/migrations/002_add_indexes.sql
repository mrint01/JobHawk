-- Migration 002: Performance indexes

-- Jobs: most queries filter by user_id
CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id);

-- Jobs: analytics queries filter by status + applied_at
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_applied_at ON jobs(applied_at);

-- Jobs: combined index for the most common query (user jobs by status)
CREATE INDEX IF NOT EXISTS idx_jobs_user_status ON jobs(user_id, status);

-- Jobs: analytics date range queries
CREATE INDEX IF NOT EXISTS idx_jobs_user_applied_at ON jobs(user_id, applied_at) WHERE status = 'applied';

-- Platform sessions: always queried by user_id
CREATE INDEX IF NOT EXISTS idx_platform_sessions_user_id ON platform_sessions(user_id);

-- Users: login queries lookup by email or username
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

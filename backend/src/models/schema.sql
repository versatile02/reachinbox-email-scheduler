-- ========================================================
-- ReachInbox Email Scheduler - Database Schema
-- ========================================================

-- Enable pgcrypto / uuid-ossp if available (gen_random_uuid is native in Postgres 13+)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 0. Users Table (Authentication & Multi-Tenant Isolation)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    avatar_url TEXT,
    google_id VARCHAR(255) UNIQUE,
    password_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);

-- Seed default user (Oliver Brown from Figma design, and default scheduler user)
INSERT INTO users (id, email, name, avatar_url, password_hash)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'oliver.brown@domain.io', 'Oliver Brown', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80', NULL),
  ('00000000-0000-0000-0000-000000000002', 'scheduler@reachinbox.ai', 'ReachInbox Default User', NULL, NULL)
ON CONFLICT (email) DO NOTHING;

-- 1. User Sessions Table (Stateful Cookie Sessions)
CREATE TABLE IF NOT EXISTS user_sessions (
    id VARCHAR(255) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);

-- 2. Senders Table (Multi-Sender Support & Tenant Scoping)
CREATE TABLE IF NOT EXISTS senders (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    hourly_limit INT NOT NULL DEFAULT 200,
    min_delay_seconds INT NOT NULL DEFAULT 2,
    smtp_host VARCHAR(255),
    smtp_port INT,
    smtp_user VARCHAR(255),
    smtp_pass_encrypted TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE senders ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_senders_email ON senders(email);
CREATE INDEX IF NOT EXISTS idx_senders_user_id ON senders(user_id);

-- Seed default sender identities if not present
INSERT INTO senders (id, email, name, hourly_limit, min_delay_seconds)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'scheduler@reachinbox.ai', 'ReachInbox Default Sender', 200, 2),
  ('00000000-0000-0000-0000-000000000002', 'oliver.brown@domain.io', 'Oliver Brown', 200, 2)
ON CONFLICT (email) DO NOTHING;

-- Backfill user_id on existing senders if NULL
UPDATE senders SET user_id = '00000000-0000-0000-0000-000000000001' WHERE user_id IS NULL;

-- 3. Emails Table
CREATE TABLE IF NOT EXISTS emails (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    sender_email VARCHAR(255) NOT NULL DEFAULT 'scheduler@reachinbox.ai',
    sender_id UUID,
    recipient VARCHAR(255) NOT NULL,
    subject VARCHAR(500) NOT NULL,
    body TEXT NOT NULL,
    scheduled_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'scheduled',
    sent_at TIMESTAMPTZ,
    error_message TEXT,
    ethereal_preview_url TEXT,
    attachments JSONB DEFAULT '[]'::jsonb,
    claim_token VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure claim_token, sender, attachments, and user columns exist if migrating an existing table
ALTER TABLE emails ADD COLUMN IF NOT EXISTS claim_token VARCHAR(64);
ALTER TABLE emails ADD COLUMN IF NOT EXISTS sender_email VARCHAR(255) NOT NULL DEFAULT 'scheduler@reachinbox.ai';
ALTER TABLE emails ADD COLUMN IF NOT EXISTS sender_id UUID;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;

-- Backfill user_id on existing emails if NULL
UPDATE emails SET user_id = '00000000-0000-0000-0000-000000000001' WHERE user_id IS NULL;

-- Indexes on emails
CREATE INDEX IF NOT EXISTS idx_emails_status ON emails(status);
CREATE INDEX IF NOT EXISTS idx_emails_sender_email ON emails(sender_email);
CREATE INDEX IF NOT EXISTS idx_emails_scheduled_at ON emails(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_emails_created_at ON emails(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_emails_user_id ON emails(user_id);

-- 4. Slack Integrations Table (OAuth Tokens & Webhooks Scoped per User/Tenant)
CREATE TABLE IF NOT EXISTS slack_integrations (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    team_id VARCHAR(255),
    team_name VARCHAR(255),
    channel_id VARCHAR(255),
    channel_name VARCHAR(255),
    webhook_url_encrypted TEXT NOT NULL,
    access_token_encrypted TEXT,
    authed_user_id VARCHAR(255),
    scope TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE slack_integrations ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE slack_integrations ADD COLUMN IF NOT EXISTS authed_user_id VARCHAR(255);
ALTER TABLE slack_integrations ADD COLUMN IF NOT EXISTS scope TEXT;

-- Backfill user_id on existing slack_integrations if NULL
UPDATE slack_integrations SET user_id = '00000000-0000-0000-0000-000000000001' WHERE user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_slack_integrations_user_id ON slack_integrations(user_id);

-- 5. Outbox Events Table (Transactional Outbox Pattern for Guaranteed Queue Publication)
CREATE TABLE IF NOT EXISTS outbox_events (
    id UUID PRIMARY KEY,
    email_id UUID NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL DEFAULT 'EMAIL_SCHEDULED',
    payload JSONB NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    attempts INT NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_outbox_status_created ON outbox_events(status, created_at);
CREATE INDEX IF NOT EXISTS idx_outbox_email_id ON outbox_events(email_id);

-- 6. OAuth States Table (CSRF Protection for Google & Slack OAuth Flows)
CREATE TABLE IF NOT EXISTS oauth_states (
    state VARCHAR(255) PRIMARY KEY,
    provider VARCHAR(50) NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    redirect_url TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states(expires_at);

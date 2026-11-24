-- ========================================================
-- ReachInbox Email Scheduler - Database Schema
-- ========================================================

-- 1. Senders Table (Multi-Sender Support)
CREATE TABLE IF NOT EXISTS senders (
    id UUID PRIMARY KEY,
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

CREATE INDEX IF NOT EXISTS idx_senders_email ON senders(email);

-- Seed default sender identity if not present
INSERT INTO senders (id, email, name, hourly_limit, min_delay_seconds)
VALUES ('00000000-0000-0000-0000-000000000001', 'scheduler@reachinbox.ai', 'ReachInbox Default Sender', 200, 2)
ON CONFLICT (email) DO NOTHING;

-- 2. Emails Table
CREATE TABLE IF NOT EXISTS emails (
    id UUID PRIMARY KEY,
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
    claim_token VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure claim_token and sender columns exist if migrating an existing table
ALTER TABLE emails ADD COLUMN IF NOT EXISTS claim_token VARCHAR(64);
ALTER TABLE emails ADD COLUMN IF NOT EXISTS sender_email VARCHAR(255) NOT NULL DEFAULT 'scheduler@reachinbox.ai';
ALTER TABLE emails ADD COLUMN IF NOT EXISTS sender_id UUID;

-- Indexes on emails
CREATE INDEX IF NOT EXISTS idx_emails_status ON emails(status);
CREATE INDEX IF NOT EXISTS idx_emails_sender_email ON emails(sender_email);
CREATE INDEX IF NOT EXISTS idx_emails_scheduled_at ON emails(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_emails_created_at ON emails(created_at DESC);

-- 3. Slack Integrations Table
CREATE TABLE IF NOT EXISTS slack_integrations (
    id UUID PRIMARY KEY,
    team_id VARCHAR(255),
    team_name VARCHAR(255),
    channel_id VARCHAR(255),
    channel_name VARCHAR(255),
    webhook_url_encrypted TEXT NOT NULL,
    access_token_encrypted TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

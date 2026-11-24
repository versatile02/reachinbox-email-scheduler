-- ========================================================
-- ReachInbox Email Scheduler - Database Schema
-- ========================================================

CREATE TABLE IF NOT EXISTS emails (
    id UUID PRIMARY KEY,
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

-- Ensure claim_token column exists if migrating an existing table
ALTER TABLE emails ADD COLUMN IF NOT EXISTS claim_token VARCHAR(64);

-- Index on status for rapid filtering (scheduled, processing, sent, failed)
CREATE INDEX IF NOT EXISTS idx_emails_status ON emails(status);

-- Index on scheduled_at for queue and timeline ordering
CREATE INDEX IF NOT EXISTS idx_emails_scheduled_at ON emails(scheduled_at);

-- Index on created_at for dashboard reverse chronological listings
CREATE INDEX IF NOT EXISTS idx_emails_created_at ON emails(created_at DESC);

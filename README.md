# ReachInbox Full-Stack Email Job Scheduler

A production-grade, distributed email scheduling service and interactive dashboard built for the **ReachInbox (Outbox Labs)** Software Development Intern hiring assignment.

---

## Table of Contents
1. [Project Overview](#project-overview)
2. [Key Architectural Highlights](#key-architectural-highlights)
3. [Technology Stack](#technology-stack)
4. [Prerequisites](#prerequisites)
5. [Infrastructure Setup (PostgreSQL & Redis)](#infrastructure-setup-postgresql--redis)
   - [Option A: Managed Cloud Setup (Neon & Upstash — Recommended)](#option-a-managed-cloud-setup-neon--upstash--recommended)
   - [Option B: Local Development Setup](#option-b-local-development-setup)
6. [Environment Variables Configuration](#environment-variables-configuration)
7. [Getting Started (Step-by-Step)](#getting-started-step-by-step)
   - [Step 1: Install Dependencies & Run Database Migrations](#step-1-install-dependencies--run-database-migrations)
   - [Step 2: Start Express Backend API](#step-2-start-express-backend-api)
   - [Step 3: Start Decoupled BullMQ Worker](#step-3-start-decoupled-bullmq-worker)
   - [Step 4: Start Frontend Dashboard](#step-4-start-frontend-dashboard)
8. [Automated Test Suite (74 Tests)](#automated-test-suite-74-tests)
9. [REST API Specifications](#rest-api-specifications)
10. [Reliability, Delivery & Concurrency Guarantees](#reliability-delivery--concurrency-guarantees)
    - [Strictly No Cron Jobs](#strictly-no-cron-jobs)
    - [Multi-Sender Distributed Rate Limiting & Safe Rescheduling](#multi-sender-distributed-rate-limiting--safe-rescheduling)
    - [Atomic PostgreSQL Lease Fencing & Heartbeats](#atomic-postgresql-lease-fencing--heartbeats)
    - [At-Least-Once Delivery Semantics](#at-least-once-delivery-semantics)
    - [PostgreSQL Sent-State Retries After SMTP Acceptance](#postgresql-sent-state-retries-after-smtp-acceptance)
    - [Redis Persistence vs Complete Data Loss](#redis-persistence-vs-complete-data-loss)
    - [Slack Alert Notification Semantics](#slack-alert-notification-semantics)
11. [Security & Rate Limiting Overview](#security--rate-limiting-overview)
12. [Known Limitations & Design Assumptions](#known-limitations--design-assumptions)
13. [Assignment Requirement Coverage](#assignment-requirement-coverage)
14. [5-Minute Demo Video Walkthrough Guide](#5-minute-demo-video-walkthrough-guide)

---

## Project Overview

ReachInbox relies on reliable scheduling and sending of cold outreach emails at scale. This project implements a full-stack, enterprise-grade email scheduler that:
- **Accepts Scheduling Requests:** Supports single recipient dispatch and bulk CSV parsing via REST APIs and an intuitive React 19 UI.
- **Precision Delayed Execution:** Uses **BullMQ + Redis** as a persistent delayed job scheduler (**strictly no cron jobs**).
- **Restart Resilience:** Persists all scheduled jobs in Redis sorted sets and PostgreSQL across crashes and normal process restarts without losing jobs or premature triggering.
- **Multi-Sender Quota & Pacing:** Enforces configurable hourly send limits per sender identity and minimum inter-send spacing gaps across multiple concurrent worker instances using atomic Redis Lua scripts.
- **Non-Blocking Rescheduling:** Uses BullMQ `moveToDelayed()` and `DelayedError` to defer rate-limited jobs without blocking worker concurrency slots with in-process sleeps.
- **Ethereal Test SMTP:** Automatically provisions ephemeral test inboxes on [Ethereal.email](https://ethereal.email) and captures web preview URLs for immediate inspection.
- **Real-Time Web Dashboard:** Built with React 19 and Vite, featuring queue metrics, live sender management, sent history with preview links, and Slack alert configuration.

---

## Key Architectural Highlights

- **Strictly No Cron Jobs:** Jobs are scheduled directly with millisecond delay in Redis (`ZSET`), eliminating database polling stampedes.
- **Decoupled Architecture:** The API server, background worker, and frontend dashboard operate as separate, independently scalable processes.
- **Lease Fencing:** Concurrency guard prevents duplicate processing using atomic UUID claim tokens and an active 15-second heartbeat.
- **TypeScript Strict Mode:** Both backend API and worker engine are fully migrated to ES Module TypeScript with NodeNext resolution.

---

## Technology Stack

- **Frontend:** React 19, Vite, Lucide Icons, CSS Modules
- **Backend API:** Node.js (v20+), Express 5, TypeScript (strict mode, ES Modules)
- **Queue & Scheduler:** BullMQ 6.7+, Redis 6+ / Upstash Redis
- **Database:** PostgreSQL 14+ (`pg` connection pool with parameterized queries)
- **SMTP Transport:** Nodemailer 10+ with Ethereal Email test preview generation
- **Test Harness:** Node.js native test runner (`node:test`, `node:assert/strict`)

---

## Prerequisites

- **Node.js:** `v18.0.0` or higher (verified with `v20.17.0`)
- **npm:** `v9.0.0` or higher (verified with `v10.8.2`)
- **PostgreSQL:** Local instance OR managed cloud provider (Neon, Supabase)
- **Redis:** Local instance OR managed cloud provider (Upstash Redis with TCP/TLS)

---

## Infrastructure Setup (PostgreSQL & Redis)

### Option A: Managed Cloud Setup (Neon & Upstash — Recommended)

If your local environment lacks Docker or native PostgreSQL/Redis binaries, you can use free-tier managed cloud providers in under 2 minutes:

#### 1. PostgreSQL on Neon (or Supabase)
1. Go to [Neon.tech](https://neon.tech/) (or [Supabase.com](https://supabase.com/)) and sign in.
2. Create a free project (e.g. `reachinbox-scheduler`).
3. Copy the **Postgres Connection String** (format: `postgresql://user:password@ep-xyz.us-east-2.aws.neon.tech/neondb?sslmode=require`).
4. Paste this into `backend/.env` as `DATABASE_URL`.

#### 2. Redis on Upstash (Using TCP Endpoint)
1. Go to [Upstash.com](https://upstash.com/) and sign in.
2. Create a free Redis database (choose your nearest region).
3. In the Upstash console, select the **ioredis** or **Node.js** tab under **Connect**.
4. Copy the `rediss://` TCP connection URL (format: `rediss://default:YOUR_PASSWORD@YOUR_ENDPOINT.upstash.io:6379`).
   > [!IMPORTANT]
   > Do **NOT** use the Upstash REST API credentials (`UPSTASH_REDIS_REST_URL`). BullMQ and ioredis strictly require the **TCP** endpoint (`rediss://...`).
5. Paste this into `backend/.env` as `REDIS_URL`.

---

### Option B: Local Development Setup

If you have native local services or Docker installed:

```bash
# Start local Redis on port 6379
redis-server

# Start local PostgreSQL on port 5432 and create database:
psql -U postgres -c "CREATE DATABASE reachinbox_scheduler;"
```

---

## Environment Variables Configuration

Copy `backend/.env.example` to `backend/.env`:

### On Windows PowerShell:
```powershell
Copy-Item backend/.env.example backend/.env
```

### On Linux / macOS / Bash:
```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env` with your values:

```env
PORT=5000
NODE_ENV=development
CLIENT_URL=http://localhost:5173

# Redis Configuration (Either REDIS_URL or discrete variables)
# Upstash TCP endpoint format:
REDIS_URL=rediss://default:YOUR_PASSWORD@YOUR_ENDPOINT.upstash.io:6379

# PostgreSQL Configuration (Either DATABASE_URL or discrete variables)
# Neon / Supabase connection string format:
DATABASE_URL=postgresql://user:password@ep-xyz.us-east-2.aws.neon.tech/neondb?sslmode=require
DATABASE_POOL_MAX=10

# PostgreSQL SSL Certificate Verification
# By default, strict CA certificate verification is enforced (rejectUnauthorized: true).
# Set DATABASE_SSL_ALLOW_INSECURE=true only if your environment strictly requires self-signed/insecure certs.
# Leaving this false ensures secure defaults for Neon, Supabase, and production environments.
DATABASE_SSL_ALLOW_INSECURE=false

# Ethereal SMTP (Leave blank to auto-create ephemeral accounts)
SMTP_HOST=smtp.ethereal.email
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=ReachInbox Scheduler <scheduler@reachinbox.ai>

# Optional Slack Webhook (Default fallback if not configured in database via UI)
SLACK_WEBHOOK_URL=
```

> [!NOTE]
> **Frontend Configuration:** The frontend requests `/api/...` endpoints via the Vite development proxy defined in `frontend/vite.config.js`, forwarding requests to `http://localhost:5000`. No separate frontend environment file is required for local development.

---

## Getting Started (Step-by-Step)

### Step 1: Install Dependencies & Run Database Migrations

In the `backend` directory:

```bash
cd backend
npm install
npm run build
npm run db:migrate
```

> [!IMPORTANT]
> **Database Migrations Note:** `npm run db:migrate` uses `tsx src/models/migrate.ts` to execute `backend/src/models/schema.sql` directly from the source tree. Development dependencies (including `tsx`) must be installed. Do not invoke `node dist/models/migrate.js` directly, as the TypeScript compiler does not copy `.sql` files into `dist/`.

### Step 2: Start Express Backend API

In Terminal 1:
```bash
cd backend
npm run dev
# Or run compiled production build:
npm start
```
The API server will listen on `http://localhost:5000`. Health check: `http://localhost:5000/api/health`.

### Step 3: Start Decoupled BullMQ Worker

In Terminal 2 (separate process):
```bash
cd backend
npm run worker:dev
# Or run compiled production worker:
npm run worker
```

> [!IMPORTANT]
> **Decoupled Worker Architecture:** The worker is an independent background process. It does not run inside the Express HTTP server process and must be started separately. The worker claims maturing jobs from `email-queue`, enforces sender rate limits, and dispatches emails via Nodemailer.

### Step 4: Start Frontend Dashboard

In Terminal 3:
```bash
cd frontend
npm install
npm run dev
```
Open your browser to **`http://localhost:5173`**.

To verify the production frontend build:
```bash
npm run build
```

---

## Automated Test Suite (74 Tests)

The backend features an automated test harness built on the Node.js native test runner (`node:test`):

```bash
cd backend
npm test
```

### Test Coverage Highlights:
- **74 passing tests across 15 test suites, 0 failures, 0 skipped.**
- **Configuration & Connection Strategy:** Validates fast-fail producer timeouts vs non-failing worker options.
- **PostgreSQL SSL Strict Verification:** Validates default strict CA verification (`rejectUnauthorized: true`) and opt-out flag behavior.
- **Rate Limiting & Pacing:** Verifies atomic Redis Lua reservations, multi-sender isolation, UTC hour boundaries, and retry reservation idempotency.
- **Safe Rescheduling:** Tests non-blocking BullMQ `moveToDelayed()` and `DelayedError` handling.
- **Database Repository:** Parameterized queries, lease fencing, and heartbeat touch mechanisms.
- **Mailer Service:** Transport timeout handling, mock/live Ethereal accounts, and preview URL capture.
- **Worker Concurrency & Stalled Recovery:** Simulates crashed workers, lease timeouts, and superseded claim tokens.
- **Slack Alerting:** Verifies best-effort webhook dispatches and hourly deduplication.

---

## REST API Specifications

### 1. System Health & BullMQ Queue Metrics
- `GET /api/health` — Returns backend health, uptime, environment, and live BullMQ queue metrics:
```json
{
  "status": "ok",
  "message": "ReachInbox Email Scheduler Backend is running",
  "timestamp": "2026-11-24T14:34:02.000Z",
  "uptimeSeconds": 1420,
  "environment": "development",
  "queue": {
    "status": "healthy",
    "queueName": "email-queue",
    "isPaused": false,
    "counts": {
      "waiting": 0,
      "active": 0,
      "delayed": 0,
      "completed": 2,
      "failed": 0
    }
  }
}
```

> [!NOTE]
> All live BullMQ queue counts (waiting, active, delayed, completed, failed) are reported through `GET /api/health`.

### 2. Schedule an Email
- `POST /api/emails/schedule`
```json
{
  "senderEmail": "scheduler@reachinbox.ai",
  "recipient": "client@example.com",
  "subject": "Introductory Cold Outreach",
  "body": "Hello, reaching out to explore AI automation workflows.",
  "delayMs": 5000
}
```
*(Alternatively, pass `"scheduledAt": "2026-11-25T14:30:00.000Z"` for an absolute UTC datetime).*

### 3. List Emails
- `GET /api/emails?status=scheduled&page=1&limit=20` — Returns paginated email records with status filtering.

### 4. Get Email by ID
- `GET /api/emails/:id` — Returns single email details, status, timestamps, and `etherealPreviewUrl`.

### 5. Sender Management & Rate Limits
- `GET /api/senders` — List registered senders with their hourly limits and pacing seconds.
- `POST /api/senders` — Register a new sender identity:
```json
{
  "email": "outreach@reachinbox.ai",
  "name": "Outreach Team",
  "hourlyLimit": 150,
  "minDelaySeconds": 3
}
```

### 6. Slack Alert Integration
- `GET /api/slack/status` — Checks whether Slack alerts are configured.
  - Response: `{ "connected": true, "teamName": "ReachInbox", "channelName": "#alerts", "isEnvConfigured": false }`
- `POST /api/slack/webhook` — Registers or updates a Slack Incoming Webhook URL:
  - Request body: `{ "webhookUrl": "https://hooks.slack.com/services/...", "channelName": "#alerts", "teamName": "ReachInbox" }`
  - URL is encrypted with AES-256-GCM before database storage.
- `DELETE /api/slack` — Removes the configured Slack webhook integration.

> [!NOTE]
> Slack integration uses **Incoming Webhooks**, not a multi-tenant Slack OAuth application.

---

## Reliability, Delivery & Concurrency Guarantees

### Strictly No Cron Jobs
Scheduling is powered entirely by BullMQ delayed jobs persisted in Redis sorted sets (`ZSET`). Delayed jobs mature at exact millisecond epochs without recurring database polling overhead or query stampedes.

### Multi-Sender Distributed Rate Limiting & Safe Rescheduling
Every sender identity has a configurable `hourly_limit` and `min_delay_seconds`. Quota checks and reservations occur inside an atomic Redis Lua script.
When a sender's hourly quota is reached or pacing delay exceeds 2000ms:
1. The database lease is released back to `scheduled`.
2. The job is rescheduled to the next window boundary via `job.moveToDelayed()`.
3. The worker throws `DelayedError`, returning the worker thread to BullMQ immediately without blocking concurrency slots.

> [!NOTE]
> Senders are logical rate-limiting and identity records in the database. In the current implementation, all messages dispatch through the configured primary SMTP transporter (Ethereal test SMTP in development).

### Atomic PostgreSQL Lease Fencing & Heartbeats
Workers acquire ownership of an email record using a unique UUID claim token:
```sql
UPDATE emails
SET status = 'processing',
    claim_token = $claimToken,
    updated_at = NOW()
WHERE id = $id
  AND (status = 'scheduled' OR (status = 'processing' AND updated_at < NOW() - INTERVAL '60 seconds'))
RETURNING *;
```
An active background heartbeat touches `updated_at = NOW()` every 15 seconds while SMTP dispatch is underway. If a worker crashes, the 60-second lease expires and BullMQ safely reclaims the job.

> [!IMPORTANT]
> **Fencing Boundary:** Database lease fencing prevents competing workers from picking up the same record. However, once an SMTP network transmission is initiated with the upstream mail server, the network transmission cannot be cancelled or rolled back by database fencing.

### At-Least-Once Delivery Semantics
Because the SMTP protocol does not support two-phase commit (2PC) or transactional rollback, **the system guarantees at-least-once delivery semantics**.
If an upstream SMTP server accepts an email (`250 OK`) but the worker process dies or loses its database connection before recording `status = 'sent'`, a subsequent retry will redeliver the message. The system does not guarantee exactly-once email delivery. Under certain failure conditions, an email accepted by the SMTP server may be delivered again during a retry.

### PostgreSQL Sent-State Retries After SMTP Acceptance
After an email is accepted by the SMTP server, the worker attempts to update the database status to `sent`. If a transient database error occurs, the worker retries the status update up to three times with exponential backoff. If all three retries fail, the worker cannot record the sent state, and the email may be delivered again on a subsequent BullMQ retry attempt.

### Redis Persistence vs Complete Data Loss
- **Normal Process Restarts:** BullMQ delayed jobs persisted in Redis sorted sets survive standard application or Redis restarts when Redis persistence (AOF or RDB) is enabled.
- **Complete Redis Data Loss / Flush:** If Redis memory is completely wiped or flushed (`FLUSHALL`) without persistent storage, there is no automatic startup database scraper that reconstructs BullMQ jobs from PostgreSQL. This is an intentional architectural boundary designed to prevent query stampedes and respect the "Strictly No DB Polling" constraint.

### Slack Alert Notification Semantics
Slack alerts for hourly limit breaches use a Redis deduplication key (`slack:alert:{sender}:{utc_hour}`) to prevent spamming notifications within the same window. Slack alerts operate on a **best-effort basis**: network errors or Slack API timeouts are logged and will never fail or interrupt the primary email delivery pipeline.

---

## Security & Rate Limiting Overview

- **SQL Injection Prevention:** Every database query uses parameterized SQL (`$1, $2, ...`) through the PostgreSQL connection pool.
- **Webhook Credential Encryption:** Slack webhook URLs are encrypted before persistence using `crypto` AES-256-GCM with unique initialization vectors (IV) and authentication tags.
- **Strict PostgreSQL SSL:** SSL certificate verification is enabled by default (`rejectUnauthorized: true`), with an explicit opt-out via `DATABASE_SSL_ALLOW_INSECURE=true`.
- **Environment Protection:** `.env` files are ignored by version control.
- **Scope Disclosure:** The application does not implement incoming REST API authentication, API keys, or HTTP request rate limiting on ingestion endpoints.

---

## Known Limitations & Design Assumptions

1. **Single-Tenant Demo Session:** The top-right profile badge (`Arham Uddin` / `Demo Session`) is a static visual representation for evaluation. The application does not provide real user authentication, JWT/session management, Google OAuth, or multi-tenant data isolation.
2. **Ethereal Mock SMTP:** Ethereal is a mock mail transfer service designed for testing. Messages accepted by Ethereal are viewable through web preview URLs and are not delivered to real external recipient inboxes.
3. **Multi-Sender SMTP Scope:** Senders define rate-limiting boundaries in the database; individual per-sender external SMTP credentials are not currently used during dispatch.
4. **Upstash Free-Tier Limits:** Upstash Redis free tier applies connection and request caps. Connection parameters have been tuned with `DATABASE_POOL_MAX=10` and TCP keep-alive (`keepAlive: 10000`).

---

## Assignment Requirement Coverage

| Requirement | Implementation Status | Implementation Details |
| :--- | :---: | :--- |
| **Email Scheduling (Delay & ISO Datetime)** | **Implemented** | Accepts `delayMs` or absolute ISO 8601 `scheduledAt` via REST API and React UI. |
| **Zero Cron / No Database Polling** | **Implemented** | Uses BullMQ delayed sorted sets (`ZSET`) maturing at target millisecond timestamps. |
| **Persistence Across Restarts** | **Implemented** | Scheduled records saved in PostgreSQL; BullMQ delayed jobs persist in Redis across normal restarts. |
| **Multi-Sender Hourly Rate Limiting** | **Implemented** | Configurable `hourly_limit` per sender identity, enforced atomically via Redis Lua script. |
| **Inter-Send Rate Pacing** | **Implemented** | Enforces `min_delay_seconds`. Sub-2000ms pauses execute in-process; longer delays reschedule non-blocking via `moveToDelayed()`. |
| **Worker Concurrency & Crash Safety** | **Implemented** | Atomic 60s lease fencing (`claim_token`) with 15s background heartbeats. Stalled jobs reclaimable. |
| **Ethereal SMTP & Web Preview** | **Implemented** | Nodemailer with Ethereal. Captures preview URLs and displays clickable links in Sent tab. |
| **Slack Quota Breach Alerts** | **Implemented** | Best-effort incoming webhook alert with AES-256-GCM encryption and hourly Redis deduplication. |
| **Interactive Frontend Dashboard** | **Implemented** | React 19 single-page dashboard with 5 tabs, countdown timers, single and bulk outreach composition. |
| **Comprehensive Automated Tests** | **Implemented** | 74 passing tests across 15 suites covering rate limiting, worker logic, database repo, and SSL. |

---

## 5-Minute Demo Video Walkthrough Guide

The hiring assignment permits a demo video of up to 5 minutes. Below is a practical, structured walkthrough sequence:

### 1. System Overview & Live Health (Approx. 0:00 – 1:00)
- Open `http://localhost:5173/` in your browser.
- Navigate to the **System Health & BullMQ** tab.
- Show live connectivity for Express API (Port 5000), BullMQ Engine, Neon PostgreSQL, and Upstash Redis.
- Explain the decoupled architecture: Express API, BullMQ Worker, and Vite Frontend run as independent processes.

### 2. Scheduling Outreach (Approx. 1:00 – 2:00)
- Click **+ Compose Outreach**.
- In **Single Mode**, select a sender (`scheduler@reachinbox.ai`), enter a recipient and subject, set a delay (e.g. 15 seconds), and click **Schedule Email**.
- Switch to the **Scheduled Queue** tab and show the email waiting with its live countdown timer.
- (Optional) Toggle to **Bulk Outreach (CSV)** to demonstrate bulk campaign parsing.

### 3. Demonstrating Restart Resilience (Approx. 2:00 – 3:00)
- Schedule an email with a 30-second delay.
- In your terminal, stop the BullMQ worker process (`Ctrl + C`).
- Show that the email remains safely in the queue.
- Restart the worker (`npm run worker:dev`).
- Watch the worker resume, pick up the delayed job upon maturity, and dispatch it without missing or prematurely firing.

### 4. Rate Limiting, Pacing & Slack Modal (Approx. 3:00 – 4:00)
- Navigate to the **Senders & Rate Limits** tab.
- Explain how different senders have independent hourly limits and pacing gaps.
- Click **Configure Slack Alert** to show the encrypted Slack webhook configuration modal for quota exhaustion alerts.

### 5. Execution Verification & Ethereal Preview (Approx. 4:00 – 5:00)
- Switch to the **Sent Emails** tab.
- Locate the dispatched email.
- Click the green **View in Ethereal** preview link to open the rendered message inside the Ethereal web inbox.
- Conclude by highlighting the automated test suite (74 tests) and at-least-once delivery guarantees.

> [!CAUTION]
> **Privacy Reminder:** Do not display real passwords, database connection strings, or full Slack webhook URLs on screen during the recording.

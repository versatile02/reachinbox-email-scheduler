# ReachInbox Full-Stack Email Job Scheduler

A production-grade, distributed email scheduling service and interactive dashboard built for the **ReachInbox (Outbox Labs)** Software Development Intern hiring assignment.

---

## Table of Contents
1. [Project Overview](#project-overview)
2. [Key Architectural Highlights](#key-architectural-highlights)
3. [Technology Stack](#technology-stack)
4. [Prerequisites](#prerequisites)
5. [Infrastructure Setup (PostgreSQL & Redis)](#infrastructure-setup-postgresql--redis)
   - [Option A: Quickest Managed Cloud Setup (Zero Local Install — Recommended)](#option-a-quickest-managed-cloud-setup-zero-local-install--recommended)
   - [Option B: Local Development Setup](#option-b-local-development-setup)
6. [Environment Variables Configuration](#environment-variables-configuration)
7. [Getting Started (Step-by-Step)](#getting-started-step-by-step)
   - [Step 1: Install Dependencies & Run Database Migrations](#step-1-install-dependencies--run-database-migrations)
   - [Step 2: Start Express Backend API](#step-2-start-express-backend-api)
   - [Step 3: Start Decoupled BullMQ Worker](#step-3-start-decoupled-bullmq-worker)
   - [Step 4: Start Frontend Dashboard](#step-4-start-frontend-dashboard)
8. [Automated Test Suite (73 Tests)](#automated-test-suite-73-tests)
9. [REST API Specifications](#rest-api-specifications)
10. [Reliability, Delivery & Concurrency Guarantees](#reliability-delivery--concurrency-guarantees)
    - [Strictly No Cron Jobs](#strictly-no-cron-jobs)
    - [Multi-Sender Distributed Rate Limiting & Safe Rescheduling](#multi-sender-distributed-rate-limiting--safe-rescheduling)
    - [Atomic PostgreSQL Lease Fencing & Heartbeats](#atomic-postgresql-lease-fencing--heartbeats)
    - [At-Least-Once Delivery Semantics](#at-least-once-delivery-semantics)
    - [Slack Alert Notification Semantics](#slack-alert-notification-semantics)
11. [Known Limitations & Design Assumptions](#known-limitations--design-assumptions)

---

## Project Overview

ReachInbox relies on reliable scheduling and sending of cold outreach emails at scale. This project implements a full-stack, enterprise-grade email scheduler that:
- **Accepts Scheduling Requests:** Supports single recipient dispatch and bulk CSV/TXT parsing via REST APIs and an intuitive React 19 UI.
- **Precision Delayed Execution:** Uses **BullMQ + Redis** as a persistent delayed job scheduler (**strictly no cron jobs**).
- **Survives Server Restarts:** Persists all scheduled jobs in Redis sorted sets and PostgreSQL across crashes and restarts without losing jobs or premature triggering.
- **Multi-Sender Quota & Pacing:** Enforces configurable hourly send limits per sender identity and minimum inter-send spacing gaps across multiple concurrent worker instances using atomic Redis Lua scripts.
- **Non-Blocking Rescheduling:** Uses BullMQ `moveToDelayed()` and `DelayedError` to defer rate-limited jobs without blocking worker concurrency slots with in-process sleeps.
- **Ethereal Test SMTP:** Automatically provisions ephemeral test inboxes on [Ethereal.email](https://ethereal.email) and captures web preview URLs for immediate review.
- **Real-Time Web Dashboard:** Built with React 19 and Vite, featuring queue metrics, live sender management, sent history with preview links, and Slack alert integration.

---

## Key Architectural Highlights

- **Strictly No Cron Jobs:** Jobs are scheduled directly with millisecond delay in Redis (`ZSET`), eliminating database polling stampedes.
- **Decoupled Architecture:** The API server, background worker, and frontend dashboard operate as separate, independently scalable processes.
- **Lease Fencing:** Concurrency guard prevents duplicate delivery using atomic UUID claim tokens and an active 15-second heartbeat.
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

### Option A: Quickest Managed Cloud Setup (Zero Local Install — Recommended)

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

# Ethereal SMTP (Leave blank to auto-create ephemeral accounts)
SMTP_HOST=smtp.ethereal.email
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=ReachInbox Scheduler <scheduler@reachinbox.ai>

# Optional Slack Webhook
SLACK_WEBHOOK_URL=
```

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
The worker will listen on `email-queue`, claim maturing jobs, enforce sender rate limits, and dispatch emails via Ethereal SMTP.

### Step 4: Start Frontend Dashboard

In Terminal 3:
```bash
cd frontend
npm install
npm run dev
```
Open your browser to **`http://localhost:5173`**.

---

## Automated Test Suite (73 Tests)

The backend features an automated test harness built on the Node.js native test runner (`node:test`):

```bash
cd backend
npm test
```

### Test Coverage Highlights:
- **73 passing tests across 15 test suites, 0 failures, 0 skipped.**
- **Configuration & Connection Strategy:** Validates fast-fail producer timeouts vs non-failing worker options.
- **Rate Limiting & Pacing:** Verifies atomic Redis Lua reservations, multi-sender isolation, UTC hour boundaries, and retry reservation idempotency.
- **Safe Rescheduling:** Tests non-blocking BullMQ `moveToDelayed()` and `DelayedError` handling.
- **Database Repository:** Parameterized queries, lease fencing, and heartbeat touch mechanisms.
- **Mailer Service:** Transport timeout handling, mock/live Ethereal accounts, and preview URL capture.
- **Worker Concurrency & Stalled Recovery:** Simulates crashed workers, lease timeouts, and superseded claim tokens.
- **Slack Alerting:** Verifies best-effort webhook dispatches and hourly deduplication.

---

## REST API Specifications

### 1. Health Check
- `GET /api/health` — Returns status of backend service and timestamp.

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
- `GET /api/emails?status=scheduled&page=1&limit=20` — Returns paginated email records.

### 4. Get Email by ID
- `GET /api/emails/:id` — Returns single email details, status, timestamps, and `etherealPreviewUrl`.

### 5. Sender Management & Rate Limits
- `GET /api/senders` — List registered senders with their hourly limits and pacing seconds.
- `POST /api/senders` — Register a new sender identity.

### 6. Queue Metrics
- `GET /api/emails/metrics/queue` — Returns live BullMQ queue counts (waiting, active, delayed, failed, completed).

---

## Reliability, Delivery & Concurrency Guarantees

### Strictly No Cron Jobs
Scheduling is powered entirely by BullMQ delayed jobs persisted in Redis sorted sets (`ZSET`). Delayed jobs mature at exact millisecond epochs without recurring polling overhead.

### Multi-Sender Distributed Rate Limiting & Safe Rescheduling
Every sender identity has a configurable `hourly_limit` and `min_delay_seconds`. Quota checks and reservations occur inside an atomic Redis Lua script.
When a sender's hourly quota is reached or pacing delay exceeds 2000ms:
1. The database lease is released back to `scheduled`.
2. The job is rescheduled to the next window boundary via `job.moveToDelayed()`.
3. The worker throws `DelayedError`, returning the worker thread to BullMQ immediately without blocking concurrency slots.

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

### At-Least-Once Delivery Semantics
Because the SMTP protocol does not support two-phase commit (2PC) or transactional rollback, **the system guarantees at-least-once delivery semantics**.
If an upstream SMTP server accepts an email (`250 OK`) but the worker crashes before recording `sent` in PostgreSQL, subsequent retries may deliver duplicate messages. Exactly-once delivery is physically impossible over standard SMTP.

### Slack Alert Notification Semantics
Slack alerts for hourly limit breaches use a Redis deduplication key to prevent spam. However, a Redis key does not guarantee exactly-once webhook delivery due to potential network retries or timeouts. Slack notifications operate on a best-effort basis and never block or fail the primary email delivery pipeline.

---

## Known Limitations & Design Assumptions

1. **SMTP Acceptance vs Recipient Inbox Delivery:** Ethereal SMTP acceptance verifies that the mail transfer agent received the payload. Downstream delivery to real recipients is governed by external mail provider spam filters and DNS reputations.
2. **Upstash Free-Tier Connection Limits:** When using Upstash Redis on the free tier, concurrent connection limits and request rate limits apply. The connection pool has been tuned with `DATABASE_POOL_MAX=10` and `keepAlive: 10000` to remain safely within free-tier thresholds.
3. **Single-Tenant Dashboard Session:** The dashboard provides a verified user profile session (`Arham Uddin`) for demonstration and evaluation. Production multi-tenant deployments should integrate an OAuth/OIDC identity provider.

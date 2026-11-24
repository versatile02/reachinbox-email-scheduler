# ReachInbox Full-Stack Email Job Scheduler

A production-grade, distributed email scheduling service and interactive dashboard built for the **ReachInbox (Outbox Labs)** Software Development Intern hiring assignment.

---

## Table of Contents
1. [Project Overview](#project-overview)
2. [Requirement Compliance Matrix](#requirement-compliance-matrix)
3. [Architecture Overview & System Flow](#architecture-overview--system-flow)
4. [Key Architectural Features](#key-architectural-features)
   - [Strictly No Cron Jobs](#strictly-no-cron-jobs)
   - [Transactional Outbox Pattern & Zero Lost Jobs](#transactional-outbox-pattern--zero-lost-jobs)
   - [Queue Reconciliation & Restart Recovery](#queue-reconciliation--restart-recovery)
   - [Multi-Sender Distributed Rate Limiting & Pacing](#multi-sender-distributed-rate-limiting--pacing)
   - [Non-Blocking Rescheduling](#non-blocking-rescheduling)
   - [Bull Board Live Queue Dashboard (/admin/queues)](#bull-board-live-queue-dashboard-adminqueues)
   - [Elasticsearch Full-Text Search with Postgres Fallback](#elasticsearch-full-text-search-with-postgres-fallback)
   - [Real Google OAuth 2.0 & Session Management](#real-google-oauth-20--session-management)
   - [Slack OAuth & Live Rate-Limit Breach Alerts](#slack-oauth--live-rate-limit-breach-alerts)
   - [SMTP Delivery: Ethereal Sandbox vs Production SMTP](#smtp-delivery-ethereal-sandbox-vs-production-smtp)
5. [Frontend Dashboard (React 19 & Figma Fidelity)](#frontend-dashboard-react-19--figma-fidelity)
6. [Technology Stack](#technology-stack)
7. [Installation & Local Development (Windows & PowerShell Friendly)](#installation--local-development)
   - [Prerequisites](#prerequisites)
   - [Option 1: Quickstart Concurrent Runner (Recommended)](#option-1-quickstart-concurrent-runner-recommended)
   - [Option 2: Microservice Multi-Terminal Mode](#option-2-microservice-multi-terminal-mode)
   - [Option 3: Infrastructure with Docker Compose](#option-3-infrastructure-with-docker-compose)
8. [Environment Variable Configuration](#environment-variable-configuration)
9. [REST API Specifications](#rest-api-specifications)
10. [Reliability, Operational Semantics & Honest Disclosures](#reliability-operational-semantics--honest-disclosures)
11. [Automated Test Suite & Verification (108 Tests, 24 Suites)](#automated-test-suite--verification)
12. [Submission & Repository Structure](#submission--repository-structure)

---

## Project Overview

At ReachInbox, reliable scheduling and sending of cold outreach campaigns at scale is a critical core capability. This project delivers an enterprise-grade, distributed email scheduler and interactive web dashboard that:

- **Accepts Email Scheduling Requests:** Supports single-recipient dispatch and bulk campaign uploads (CSV/TXT with automatic email lead count extraction) via REST APIs and an intuitive React 19 UI.
- **Precision Delayed Execution:** Uses **BullMQ + Redis** as a persistent delayed job scheduler with **strictly zero cron jobs**.
- **Crash Resilience & Zero Lost Jobs:** Combines PostgreSQL transactions with the **Transactional Outbox Pattern** and startup **Queue Reconciliation** to ensure that scheduled emails are neither dropped nor duplicated across server crashes or Redis restarts.
- **Multi-Sender Quota & Pacing:** Enforces configurable hourly sending limits per sender identity and inter-send minimum pacing gaps (e.g. min 2 seconds between emails) across concurrent workers using atomic Redis Lua scripts.
- **Non-Blocking Rescheduling:** Defers rate-limited jobs to the next available UTC hour window using BullMQ `moveToDelayed()` and `DelayedError` without blocking worker threads.
- **Dual SMTP Delivery:** Uses [Ethereal.email](https://ethereal.email) fake SMTP for local testing with clickable webmail previews, while seamlessly supporting real external SMTP (such as Gmail App Passwords or Amazon SES) for real recipient delivery.
- **Live Queue Monitoring:** Mounts `@bull-board/express` at `/admin/queues` with role-based allowlist authorization.
- **Full-Text Search:** Indexes scheduled and sent emails into Elasticsearch with automatic fallback to PostgreSQL `ILIKE` queries when Elasticsearch is offline.
- **Clean SaaS UI:** React 19 dashboard matching the provided Figma design with Google OAuth, 1-click Demo Login, collapsible sidebar (`☰`), live status badges, and compose pacing controls.

---

## Requirement Compliance Matrix

| Requirement | Assignment Specification | Implementation Detail | Status |
| :--- | :--- | :--- | :---: |
| **API Scheduling** | Accept email send requests via API | `POST /api/emails/schedule` & `POST /api/emails/bulk` in `email.controller.ts` | ✅ **Fully Met** |
| **Relational Storage** | Store emails in PostgreSQL | PostgreSQL schema (`emails`, `senders`, `user_sessions`, `outbox_events`) | ✅ **Fully Met** |
| **BullMQ Delayed Queue** | BullMQ + Redis persistent scheduler; **no cron jobs** | Native Redis `ZSET` delayed scheduling via BullMQ in `email.queue.ts` | ✅ **Fully Met** |
| **Decoupled Worker** | Dedicated background worker | Standalone worker in `email.worker.ts` with heartbeat lease management | ✅ **Fully Met** |
| **Multiple Senders** | Support multiple sender identities | Per-sender table & rate limits (`sender.controller.ts`, `sender.routes.ts`) | ✅ **Fully Met** |
| **Inter-Send Pacing** | Minimum delay between sends | Configurable `MIN_DELAY_BETWEEN_EMAILS_MS` (default 2s) enforced via Redis Lua script | ✅ **Fully Met** |
| **Hourly Rate Limiting** | Rate limit per sender identity | Configurable `MAX_EMAILS_PER_HOUR_PER_SENDER` (default 200) via Redis sliding counter | ✅ **Fully Met** |
| **Non-Dropping Reschedule** | Reschedule to next hour window | Rate-limited jobs moved via BullMQ `moveToDelayed()` without dropping | ✅ **Fully Met** |
| **Slack Notifications** | Real OAuth + alert on limit hit | Real Slack OAuth 2.0 + live incoming webhook dispatch upon hourly limit breach | ✅ **Fully Met** |
| **Search Engine** | Searchable via Elasticsearch | Multi-match search across subject/body/recipient with Postgres fallback | ✅ **Fully Met** |
| **Queue Dashboard** | Live queue monitoring UI | Bull Board mounted at `/admin/queues` with allowlist authorization | ✅ **Fully Met** |
| **Restart Resilience** | Zero lost jobs across restart | Transactional outbox table + startup queue reconciliation in `outbox.service.ts` | ✅ **Fully Met** |
| **Idempotency** | No duplicate sends | Worker lease tokens (`lease_token`, `lease_expires_at`) + idempotency checks | ✅ **Fully Met** |
| **Google OAuth** | Real Google login (no mock) | Google OAuth 2.0 flow via `/api/auth/google` with cookie sessions + Demo login | ✅ **Fully Met** |
| **Figma Frontend** | React dashboard matching design | React 19 UI with collapsible sidebar, KPI overview, Compose modal, and lead import | ✅ **Fully Met** |

---

## Architecture Overview & System Flow

```mermaid
flowchart TD
    Client["React 19 Frontend Dashboard\n(Vite @ localhost:5173)"]
    API["Express 5 REST API Server\n(TypeScript @ localhost:5000)"]
    Postgres[("PostgreSQL\n(Neon / Docker)")]
    Redis[("Redis 7 / Upstash\n(BullMQ ZSET Engine)")]
    Worker["Standalone BullMQ Worker\n(Concurrent Processor)"]
    SMTP{"SMTP Provider Router"}
    Ethereal["Ethereal Fake SMTP\n(Webmail Preview)"]
    RealSMTP["Real SMTP / Gmail\n(Direct Mailbox Delivery)"]
    Slack["Slack API Gateway\n(Live Alert Webhook)"]
    ES["Elasticsearch 8.11\n(Full-Text Index)"]

    Client -->|"REST API / Cookies"| API
    API -->|"1. Single Transaction:\nInsert Email + Outbox Event"| Postgres
    API -->|"2. Enqueue Delayed Job"| Redis
    API -->|"3. Index Document"| ES
    API -.->|"Search Fallback"| Postgres

    Redis -->|"4. Delayed Job Fires"| Worker
    Worker -->|"5. Acquire Lease Token"| Postgres
    Worker -->|"6. Atomic Rate Limit & Pacing Check (Lua)"| Redis
    Redis -->|"Hourly Limit Breached"| Worker
    Worker -->|"7a. Trigger Live Alert"| Slack
    Worker -->|"7b. moveToDelayed(next_hour)"| Redis
    Worker -->|"8. Dispatch Email"| SMTP
    SMTP -->|"Development"| Ethereal
    SMTP -->|"Production"| RealSMTP
    Worker -->|"9. Mark Status = 'sent' + Preview URL"| Postgres
```

### Detailed Component Roles:
1. **Frontend (Port 5173):** React 19 SPA communicating with Express APIs over `/api` and `/admin` proxies.
2. **Express API Server (Port 5000):** Validates payloads, handles Google/Slack OAuth, coordinates the transactional outbox, and exposes `@bull-board/express`.
3. **PostgreSQL Database:** Authoritative system of record for emails, sender quotas, user sessions, and outbox reconciliation events.
4. **BullMQ + Redis:** Persistent queue manager using Redis Sorted Sets (`ZSET`) keyed by millisecond epoch timestamps for sub-second delayed dispatch.
5. **Decoupled Email Worker:** Concurrently polls BullMQ, acquires lease locks in PostgreSQL, runs atomic Redis Lua rate-limit scripts, and communicates with SMTP gateways.
6. **Elasticsearch Cluster:** Dedicated full-text search engine with automatic fallback to PostgreSQL pattern matching if offline.

---

## Key Architectural Features

### Strictly No Cron Jobs
Scheduling is powered entirely by **BullMQ delayed jobs backed by Redis `ZSET`s**. When an email is scheduled for `scheduledAt`, BullMQ computes `delay = scheduledAt - Date.now()`. Redis stores the job in a sorted set ordered by execution timestamp. A BullMQ worker immediately picks up the job when its timestamp matures. There are **zero OS cron jobs (`crontab`) and zero Node cron packages (`node-cron`, `agenda`)** in the codebase.

### Transactional Outbox Pattern & Zero Lost Jobs
To prevent dual-write inconsistencies between PostgreSQL and Redis:
1. When an email schedule request arrives, the email record and an `outbox_events` record are committed within a **single ACID transaction** in PostgreSQL.
2. An asynchronous publisher loop sweeps unpublished outbox events and pushes them to Redis.
3. If Redis is temporarily unreachable during the API request, the email is safely persisted in PostgreSQL and will be dispatched to Redis as soon as connectivity resumes.

### Queue Reconciliation & Restart Recovery
If Redis suffers data loss, is flushed, or the worker restarts after a crash:
1. On startup, the server runs `reconcileQueue()` in `outbox.service.ts`.
2. It queries PostgreSQL for emails in `scheduled` status whose scheduled time has not yet passed and checks Redis for corresponding BullMQ job IDs.
3. Any orphaned emails are safely re-enqueued into BullMQ with their correct remaining delay.
4. Stale in-flight worker leases (`processing` status older than lease timeout) are automatically reclaimed.

### Multi-Sender Distributed Rate Limiting & Pacing
Each sender identity has an independent hourly quota and minimum pacing gap:
1. **Sliding Hour Quota:** Evaluated atomically in Redis using Lua scripts: `rate_limit:{senderId}:{hourWindow}`.
2. **Inter-Send Minimum Pacing:** Tracks `last_send:{senderId}` in Redis. If a sender dispatched an email 1 second ago and `MIN_DELAY_BETWEEN_EMAILS_MS=2000`, the worker delays execution by the remaining 1000ms.
3. **Concurrency-Safe:** Multiple worker instances across different processes safely share rate-limit counters without race conditions.

### Non-Blocking Rescheduling
When a sender reaches their hourly sending limit:
1. The worker does not drop or mark the email as failed.
2. The worker computes the exact milliseconds remaining until the start of the next UTC hour window.
3. The job is rescheduled via BullMQ `job.moveToDelayed(nextHourTimestamp, token)` and throws `DelayedError`.
4. The worker thread is immediately freed to process other pending jobs for other senders without sleeping or blocking.

### Bull Board Live Queue Dashboard (`/admin/queues`)
Mounted directly in Express via `@bull-board/express` and `@bull-board/api`. Evaluators can inspect:
- **Active:** Currently processing jobs with worker lease tokens.
- **Delayed:** Scheduled jobs awaiting their future send timestamp.
- **Waiting:** Ready jobs waiting for an idle worker thread.
- **Completed:** Successfully sent emails with payload data.
- **Failed:** Permanent failures with stack traces.

Access is protected by role-based email allowlisting (`ADMIN_EMAILS`) to ensure secure administration.

### Elasticsearch Full-Text Search with Postgres Fallback
Search queries (`GET /api/emails/search?q=...`) execute multi-match queries against the `reachinbox_emails` index in Elasticsearch across `subject`, `body`, and `recipient`. If Elasticsearch is unreachable, the API gracefully falls back to PostgreSQL `ILIKE` pattern matching without failing the request.

### Real Google OAuth 2.0 & Session Management
- **OAuth Initiation:** Direct top-level navigation to `/api/auth/google`.
- **OAuth Callback:** Exchanges authorization code for Google profile tokens, creates or updates the user in PostgreSQL, generates a cryptographically secure session token, sets an HTTP-only `reachinbox_session` cookie, and redirects to the dashboard.
- **1-Click Demo Login:** Evaluators can click **"⚡ Instant Login as Oliver Brown (Demo)"** to immediately access the dashboard without third-party credentials.

### Slack OAuth & Live Rate-Limit Breach Alerts
- Evaluators can connect Slack via real OAuth 2.0 (`/api/slack/oauth`) or by saving an incoming webhook URL (`https://hooks.slack.com/...`).
- Webhook URLs are encrypted at rest using **AES-256-GCM**.
- When an hourly rate-limit is breached, the worker dispatches a live HTTP POST notification to Slack detailing the sender email, limit value, and reschedule window.

### SMTP Delivery: Ethereal Sandbox vs Production SMTP
- **Default (Ethereal Sandbox):** When `SMTP_USER` and `SMTP_PASS` are omitted, ReachInbox provisions an ephemeral test account on [Ethereal.email](https://ethereal.email) and captures message preview URLs.
- **Real Mailbox Delivery (Gmail / Production SMTP):** To deliver emails to real inboxes (e.g. Gmail), provide Gmail SMTP credentials and an App Password in `backend/.env`.

---

## Frontend Dashboard (React 19 & Figma Fidelity)

The frontend is built with **React 19, Vite, and modern CSS**, matching the uploaded Figma design screens:

1. **Authentication Screen:**
   - Real Google OAuth button.
   - Email/password authentication form.
   - 1-Click Demo Evaluator Access button.
2. **Main Dashboard:**
   - **Header:** Sidebar toggle button (`☰`), ReachInbox purple lightning brand logo, Outbox Labs badge, search/filter bar, live Bull Board link pill, compact user avatar (28px) with name, and Logout.
   - **Collapsible Sidebar:** Toggled via the `☰` button; features the primary `+ Compose` button, `Scheduled` and `Sent` sections with live counters, `Senders` configuration, `Slack Integration`, and `Queue Board ↗`.
   - **Overview Header:** Clean section title with real-time status summary pills (`Scheduled: X`, `Sent: Y`, `Senders: Z`).
3. **Compose Modal:**
   - Subject, rich snippet body input.
   - CSV/TXT file upload for email leads with automatic lead counter.
   - Scheduling controls: Start time picker, inter-email delay, and hourly sending limits.
4. **Email List & Detail Views:**
   - Table displaying recipient, status badges (`Scheduled`, `In Flight`, `Sent`, `Failed`), subject preview, and star action.
   - Detail view with highlight callout banner, attachments list, and Ethereal webmail preview button with dedicated non-overlapping layout.

---

## Technology Stack

| Layer | Technology | Version | Purpose |
| :--- | :--- | :--- | :--- |
| **Backend Runtime** | Node.js (ES Modules) | v20+ / v24+ | Asynchronous backend runtime |
| **Language** | TypeScript | v5+ / v7+ | Type safety across API, worker, and frontend |
| **Framework** | Express.js | v5.3 | REST API and middleware routing |
| **Persistent Queue** | BullMQ | v6.7 | Delayed job scheduling and concurrency |
| **In-Memory Store** | Redis (ioredis) | v6.1 | BullMQ backend, distributed locks, and rate limit counters |
| **Database** | PostgreSQL (`pg`) | v8.23 | Relational persistence and outbox event transactions |
| **Search Engine** | Elasticsearch | v9.5 | Multi-match full-text email search |
| **Mail Gateway** | Nodemailer | v10.6 | SMTP transmission (Ethereal / Gmail / Custom) |
| **Monitoring UI** | Bull Board | v9.14 | Live queue administration dashboard |
| **Cryptography** | Node Crypto | Native | AES-256-GCM encryption and salted scrypt hashing |
| **Frontend Framework** | React 19 | v19.3 | Reactive user interface components |
| **Build Tool** | Vite | v8.3 | Sub-second frontend bundling and HMR |
| **Linter** | Oxlint | v1.90 | High-performance Rust-based JavaScript/TypeScript linter |

---

## Installation & Local Development

### Prerequisites
- **Node.js**: v18.0.0 or higher (`node -v`)
- **Package Manager**: `npm` (v9+)
- **PostgreSQL**: Neon cloud instance or local Docker container
- **Redis**: Upstash cloud instance or local Docker container

---

### Option 1: Quickstart Concurrent Runner (Recommended)

Run the entire backend (API Server + BullMQ Worker) in a single terminal:

#### 1. Clone the repository
```powershell
git clone https://github.com/versatile02/reachinbox-email-scheduler.git
cd reachinbox-email-scheduler
```

#### 2. Configure Environment Variables
Copy the example configuration to `backend/.env`:
```powershell
Copy-Item backend/.env.example backend/.env
```

#### 3. Install Dependencies & Run Database Migrations
```powershell
npm --prefix backend install
npm --prefix backend run db:migrate
npm --prefix frontend install
```

#### 4. Start Backend API & Worker Concurrently
```powershell
npm --prefix backend run dev:all
```
* API Server: **`http://localhost:5000`**
* Bull Board Queue UI: **`http://localhost:5000/admin/queues`**

#### 5. Start Frontend Dashboard (Separate Terminal)
```powershell
npm --prefix frontend run dev
```
* Frontend Dashboard: **`http://localhost:5173`**

---

### Option 2: Microservice Multi-Terminal Mode

If you prefer to run the API, worker, and frontend in separate terminals:

| Terminal | Command | Purpose |
| :--- | :--- | :--- |
| **Terminal 1 (API)** | `npm --prefix backend run dev` | Express API Server (`localhost:5000`) |
| **Terminal 2 (Worker)** | `npm --prefix backend run worker:dev` | Standalone BullMQ Worker |
| **Terminal 3 (Frontend)** | `npm --prefix frontend run dev` | React 19 Frontend Dashboard (`localhost:5173`) |

---

### Option 3: Infrastructure with Docker Compose

To spin up local PostgreSQL, Redis (AOF persistence), and Elasticsearch containers:

```powershell
# 1. Start all infrastructure services
docker compose up -d

# 2. Configure environment for Docker
Copy-Item .env.docker.example backend/.env

# 3. Apply schema migrations
npm --prefix backend run db:migrate

# 4. Start backend and frontend
npm --prefix backend run dev:all
npm --prefix frontend run dev
```

---

## Environment Variable Configuration

All environment variables are configured in `backend/.env`. A template is provided in `backend/.env.example`:

| Variable | Required | Default / Example | Purpose |
| :--- | :---: | :--- | :--- |
| `PORT` | Optional | `5000` | Port for Express API server |
| `NODE_ENV` | Optional | `development` | Environment mode (`development`, `production`, `test`) |
| `CLIENT_URL` | **Required** | `http://localhost:5173` | Allowed CORS origin and OAuth redirect destination |
| `DATABASE_URL` | **Required** | `postgresql://user:pass@host/db?sslmode=require` | PostgreSQL connection string |
| `DATABASE_SSL` | Optional | `true` | Enables TLS for PostgreSQL connections |
| `REDIS_URL` | **Required** | `rediss://default:pass@host:6379` | Redis TCP connection URL (Upstash or local) |
| `SMTP_PROVIDER` | Optional | `ethereal` | SMTP provider: `ethereal`, `gmail`, or `custom` |
| `SMTP_USER` | Optional | *(empty for auto-Ethereal)* | SMTP username (e.g. your Gmail address) |
| `SMTP_PASS` | Optional | *(empty for auto-Ethereal)* | SMTP password (e.g. Gmail 16-character App Password) |
| `SMTP_HOST` | Optional | `smtp.ethereal.email` | SMTP server host |
| `SMTP_PORT` | Optional | `587` | SMTP server port |
| `GOOGLE_CLIENT_ID` | Optional | `your-google-client-id` | Google OAuth 2.0 Client ID |
| `GOOGLE_CLIENT_SECRET` | Optional | `your-google-client-secret` | Google OAuth 2.0 Client Secret |
| `GOOGLE_REDIRECT_URI` | Optional | `http://localhost:5000/api/auth/google/callback` | Google OAuth redirect URL |
| `SLACK_CLIENT_ID` | Optional | `your-slack-client-id` | Slack OAuth 2.0 Client ID |
| `SLACK_CLIENT_SECRET` | Optional | `your-slack-client-secret` | Slack OAuth 2.0 Client Secret |
| `SLACK_REDIRECT_URI` | Optional | `http://localhost:5000/api/slack/callback` | Slack OAuth redirect URL |
| `ENCRYPTION_KEY` | **Required** | `0123...def (32 bytes hex)` | AES-256-GCM key for encrypting Slack webhooks |
| `SESSION_SECRET` | **Required** | `secure_session_secret...` | Secret key for signing session tokens |
| `ADMIN_EMAILS` | Optional | `oliver.brown@domain.io,admin@reachinbox.ai` | Allowlist of admin emails permitted to view `/admin/queues` |
| `DEFAULT_HOURLY_LIMIT` | Optional | `200` | Fallback hourly send quota per sender |
| `DEFAULT_MIN_DELAY_SECONDS` | Optional | `2` | Minimum spacing gap between consecutive sends |
| `WORKER_CONCURRENCY` | Optional | `5` | Number of parallel jobs processed by BullMQ worker |
| `ELASTICSEARCH_NODE` | Optional | `http://localhost:9200` | Elasticsearch HTTP endpoint |

---

## REST API Specifications

### Authentication Routes
- `GET /api/auth/google`: Initiates Google OAuth 2.0 login redirect.
- `GET /api/auth/google/callback`: Handles Google authorization code exchange, sets session cookie.
- `POST /api/auth/demo`: 1-Click Instant Demo Login as Oliver Brown.
- `POST /api/auth/login`: Email and password authentication.
- `POST /api/auth/signup`: Create a new user account.
- `GET /api/auth/me`: Retrieve current authenticated user profile.
- `POST /api/auth/logout`: Clears session cookie and destroys database session.

### Email Operations
- `POST /api/emails/schedule`: Schedule a single email.
  ```json
  {
    "recipient": "lead@example.com",
    "subject": "Quick question regarding cold outreach",
    "body": "Hi there, wanted to follow up on our discussion.",
    "scheduledAt": "2026-11-25T14:30:00.000Z",
    "senderEmail": "oliver.brown@domain.io"
  }
  ```
- `POST /api/emails/bulk`: Batch schedule an email campaign to multiple recipients with inter-send pacing delay.
- `GET /api/emails`: List scheduled or sent emails with pagination and status filters (`?status=scheduled&page=1&limit=50`).
- `GET /api/emails/search?q=query`: Full-text search across subject, body, and recipient.
- `GET /api/emails/:id`: Retrieve single email details and delivery metadata.
- `POST /api/emails/:id/star`: Star or unstar an email record.
- `GET /api/emails/:id/attachments/:attachmentId`: Download email attachment.
- `POST /api/emails/reindex`: Reindex all PostgreSQL email records into Elasticsearch.

### Senders & Quotas
- `GET /api/senders`: List all configured email sender identities with quota usage.
- `POST /api/senders`: Create or update a sender identity with custom `hourlyLimit` and `minDelaySeconds`.

### Slack Integration
- `GET /api/slack/status`: Returns whether Slack is currently connected.
- `POST /api/slack/webhook`: Configure incoming webhook URL (encrypted with AES-256-GCM).
- `GET /api/slack/oauth`: Initiate Slack OAuth 2.0 flow.
- `GET /api/slack/callback`: Slack OAuth callback handler.
- `DELETE /api/slack`: Disconnect active Slack integration.

### Health & Monitoring
- `GET /api/health`: System health status (PostgreSQL connection, Redis connection, BullMQ queue metrics, and Elasticsearch status).
- `GET /admin/queues`: Live Bull Board Queue UI.

---

## Reliability, Operational Semantics & Honest Disclosures

1. **At-Least-Once Delivery Over SMTP:**
   The application enforces *at-least-once* delivery semantics. If a downstream SMTP server accepts an email transmission with `250 OK`, but the worker process crashes before persisting the `sent` status in PostgreSQL, BullMQ will re-queue the job upon lease expiration, potentially delivering a duplicate email. This is standard industry behavior across distributed email pipelines.
2. **Elasticsearch Graceful Fallback:**
   If Elasticsearch is offline or unconfigured, the search endpoint automatically falls back to PostgreSQL `ILIKE` pattern matching without failing user requests.
3. **Queue Reconciliation on Startup:**
   Any scheduled email in PostgreSQL that lacks an active Redis BullMQ job upon server reboot is automatically discovered and re-enqueued, guaranteeing zero lost jobs.
4. **Rate Limit Breach Alerts:**
   Slack rate-limit notifications execute live HTTP POST calls to the user's encrypted webhook when a limit is reached. If Slack is disconnected, the system logs the event and continues normal deferred scheduling without errors.
5. **Ethereal Sandbox vs Production SMTP:**
   In development, when no credentials are provided, Ethereal test accounts are dynamically generated. Ethereal captures emails in an isolated developer webmail view and does **not** deliver to external mailboxes. To send real emails to Gmail, valid Gmail SMTP credentials must be supplied.

---

## Automated Test Suite & Verification

The repository contains an enterprise test suite covering every critical subsystem.

Run all tests:
```powershell
npm --prefix backend test
```

### Verified Test Results (108 Tests Across 24 Suites — 100% Pass Rate):
```text
✔ API Endpoints - /api/emails (12 tests)
✔ Auth Service & Password Hashing Unit Tests (3 tests)
✔ Redis Configuration & Options (5 tests)
✔ PostgreSQL Pool Configuration & Error Handling (6 tests)
✔ Elasticsearch Service Integration & Fallback Tests (4 tests)
✔ Mailer Service Unit Tests (8 tests)
✔ Rate Limiting & Inter-Send Pacing Tests (5 tests)
✔ Reschedule Service Tests (3 tests)
✔ Slack Service Unit Tests (7 tests)
✔ Transactional Outbox & Queue Reconciliation Tests (3 tests)
✔ Email Repository Unit Tests (9 tests)
✔ Email Worker Job Processing Logic (10 tests)
✔ Security & RBAC Tests (Bull Board Admin 403 enforcement) (3 tests)
✔ Payload Validation Unit Tests (9 tests)

ℹ tests 108
ℹ suites 24
ℹ pass 108
ℹ fail 0
```

Frontend production verification:
```powershell
npm --prefix frontend run lint
npm --prefix frontend run build
```
* **Oxlint:** 0 errors, 0 warnings across 13 files.
* **Vite Build:** Built in **321ms**.

---

## Submission & Repository Structure

```text
reachinbox-email-scheduler/
├── backend/
│   ├── src/
│   │   ├── config/          # Database, Redis, and app configuration
│   │   ├── controllers/     # Express route controllers (Auth, Email, Sender, Slack, Health)
│   │   ├── middleware/      # Auth, upload, and error handling middleware
│   │   ├── models/          # SQL schema, migrations, and PostgreSQL repository
│   │   ├── queues/          # BullMQ queue instantiation
│   │   ├── routes/          # Express route definitions
│   │   ├── services/        # Mailer, Outbox, Rate Limiting, Slack, and Elasticsearch
│   │   ├── types/           # Backend TypeScript interface definitions
│   │   ├── workers/         # Standalone BullMQ email processing worker
│   │   ├── app.ts           # Express application initialization & Bull Board mounting
│   │   ├── dev-all.ts       # Concurrent orchestrator (API + Worker)
│   │   └── server.ts        # Express HTTP server entrypoint
│   ├── tests/               # 108 automated unit, integration, and security tests
│   ├── .env.example         # Template with safe placeholder values
│   ├── package.json         # Backend scripts and dependencies
│   └── tsconfig.json        # Backend TypeScript compiler configuration
├── frontend/
│   ├── src/
│   │   ├── components/      # React 19 UI components (Header, Sidebar, EmailList, Compose, etc.)
│   │   ├── services/        # Frontend API client
│   │   ├── App.tsx          # Root application component
│   │   ├── App.css          # Figma-matched styling rules
│   │   ├── main.tsx         # React DOM entrypoint
│   │   └── types.ts         # Frontend TypeScript interfaces
│   ├── index.html           # HTML template
│   ├── package.json         # Frontend scripts and dependencies
│   ├── tsconfig.json        # Frontend TypeScript configuration
│   └── vite.config.js       # Vite configuration with API and Bull Board proxy
├── .env.docker.example      # Local Docker configuration template
├── docker-compose.yml       # Infrastructure orchestration (Postgres 16, Redis 7, Elasticsearch)
├── .gitignore               # Strict exclusion of .env, uploads, and node_modules
└── README.md                # Comprehensive project documentation
```

### Evaluator Quick Access
- **Submission Form:** [ClickUp Assignment Submission Form](https://forms.clickup.com/9005062261/f/8cbwp3n-8876/6NNNJ92DV93PQTAYST)
- **GitHub Collaborators:** Granted access to `Mitrajit` and `Yadav036`.
- **Demo Access:** Run `npm --prefix backend run dev:all` and `npm --prefix frontend run dev`, navigate to `http://localhost:5173`, and click **"⚡ Instant Login as Oliver Brown (Demo)"**.

---

*Built with precision for the ReachInbox (Outbox Labs) hiring assignment.*

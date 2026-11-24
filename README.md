# ReachInbox — Distributed Email Job Scheduler

ReachInbox is a distributed email scheduling service and interactive web dashboard engineered for reliable cold email outreach at scale. The platform decouples email intake and scheduling from dispatch using **BullMQ** and **Redis** sorted sets for millisecond-accurate delayed execution, backed by **PostgreSQL** transactions and an **Outbox Pattern** to prevent dropped or duplicated messages across server restarts.

---

## Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [Architecture & Workflow](#architecture--workflow)
4. [Technology Stack](#technology-stack)
5. [Prerequisites](#prerequisites)
6. [Installation & Setup](#installation--setup)
7. [Environment Configuration](#environment-configuration)
8. [Running the Application](#running-the-application)
9. [Demo Mode](#demo-mode)
10. [Application Usage](#application-usage)
11. [API Reference](#api-reference)
12. [Testing](#testing)
13. [Docker Infrastructure Setup](#docker-infrastructure-setup)
14. [Operational Semantics & Reliability](#operational-semantics--reliability)
15. [Known Limitations & Trade-offs](#known-limitations--trade-offs)
16. [Project Structure](#project-structure)

---

## Overview

Cold outreach systems face demanding concurrency, deliverability, and rate-limiting challenges. Email service providers enforce strict hourly quotas per sending address, while network interruptions, worker restarts, and SMTP latency can cause dual-write discrepancies, dropped jobs, or unintentional bursts that trigger spam filters.

ReachInbox addresses these challenges through a resilient distributed architecture:
- **Precision Scheduling Without Cron:** Avoids polling overhead by utilizing Redis sorted sets (`ZSET`) via BullMQ for delayed execution.
- **Fault-Tolerant Persistence:** Uses PostgreSQL transactions with a Transactional Outbox and startup reconciliation to guarantee zero lost jobs.
- **Distributed Multi-Sender Pacing:** Enforces hourly sending caps and minimum inter-send delays per sender identity across concurrent workers using atomic Redis Lua scripts.
- **Non-Blocking Rescheduling:** Automatically defers rate-limited jobs to the next hour window without starving worker execution threads.

---

## Features

### Scheduling & Queue Engine
* **Single & Bulk Scheduling:** Schedule individual emails with exact timestamps or upload CSV/TXT lead lists with automatic recipient extraction and staggered pacing.
* **Persistent Delayed Execution:** Jobs are registered with BullMQ using calculated millisecond delays (`delay = scheduledAt - now()`), backed by persistent Redis sorted sets. No recurring cron processes (`crontab` or `node-cron`) are used.
* **Transactional Outbox:** Email records and outbox dispatch events are written in a single PostgreSQL ACID transaction, ensuring no job is scheduled unless persisted to disk.
* **Startup Queue Reconciliation:** On process reboot, the system sweeps PostgreSQL for scheduled emails without active Redis jobs and re-enqueues them with their remaining delay.

### Multi-Sender Quotas & Rate Limiting
* **Independent Sender Identities:** Manage multiple sender mailboxes, each with custom hourly sending quotas and minimum inter-send delays.
* **Atomic Redis Lua Limiting:** Sliding-window rate limit checks and inter-send pacing timestamps are executed atomically in Redis to prevent race conditions across parallel workers.
* **Non-Blocking Reschedule:** When a sender hits their hourly limit, the job is deferred via BullMQ `moveToDelayed()` to the next UTC hour window without blocking worker threads.

### Delivery & Integrations
* **Dual SMTP Routing:** Uses [Ethereal.email](https://ethereal.email) ephemeral accounts by default for safe local sandbox testing with webmail preview links, while supporting production SMTP servers (e.g., Gmail, Amazon SES) for live mailbox delivery.
* **Slack Breach Alerts:** Sends notifications to an encrypted Slack incoming webhook or OAuth integration when a sender breaches their hourly quota.
* **Full-Text Search:** Indexes email subjects, bodies, and recipients in Elasticsearch with automatic graceful fallback to PostgreSQL pattern matching when the search cluster is offline.
* **Live Queue Dashboard:** Exposes a web administration interface via `@bull-board/express` at `/admin/queues` with role-based email allowlisting.

### Web Dashboard
* **Clean SPA Interface:** Built with React 19, Vite, and modern CSS.
* **Collapsible Navigation:** Collapsible sidebar (`☰`) with live queue metrics, compose shortcuts, and sender settings.
* **Lead Ingestion:** Drag-and-drop CSV/TXT lead import with live recipient detection.
* **Authentication Options:** Supports Google OAuth 2.0, email/password registration, and a 1-click Demo mode.

---

## Architecture & Workflow

```mermaid
flowchart TD
    Client["React 19 Frontend Dashboard\n(Vite @ localhost:5173)"]
    API["Express 5 REST API Server\n(TypeScript @ localhost:5000)"]
    Postgres[("PostgreSQL\n(Emails, Senders, Outbox)")]
    Redis[("Redis 7\n(BullMQ ZSET Engine)")]
    Worker["Standalone BullMQ Worker\n(Concurrent Processor)"]
    SMTP{"SMTP Provider Router"}
    Ethereal["Ethereal Fake SMTP\n(Webmail Preview)"]
    RealSMTP["Production SMTP / Gmail\n(Direct Mailbox Delivery)"]
    Slack["Slack API Gateway\n(Rate Limit Alerts)"]
    ES["Elasticsearch 8.11\n(Full-Text Index)"]

    Client -->|"REST API / HTTP Cookies"| API
    API -->|"1. ACID Transaction:\nSave Email + Outbox Event"| Postgres
    API -->|"2. Dispatch Delayed Job"| Redis
    API -->|"3. Index Document"| ES
    API -.->|"Search Fallback"| Postgres

    Redis -->|"4. Delayed Job Matures"| Worker
    Worker -->|"5. Acquire Distributed Lease"| Postgres
    Worker -->|"6. Atomic Rate Limit Check (Lua)"| Redis
    Redis -->|"Hourly Limit Exceeded"| Worker
    Worker -->|"7a. Post Alert Webhook"| Slack
    Worker -->|"7b. moveToDelayed(next_hour)"| Redis
    Worker -->|"8. Dispatch Email"| SMTP
    SMTP -->|"Development"| Ethereal
    SMTP -->|"Production"| RealSMTP
    Worker -->|"9. Update Status to 'sent'"| Postgres
```

### Component Roles

1. **Frontend (Port 5173):** React 19 single-page application providing campaign composition, queue tables, sender settings, and email previews.
2. **API Server (Port 5000):** Express 5 application handling payload validation, authentication, Google/Slack OAuth flows, transactional outbox publishing, search dispatching, and Bull Board administration.
3. **Background Worker:** Independent Node.js process that polls BullMQ, acquires heartbeat-renewed leases in PostgreSQL, evaluates Redis Lua rate limits, and drives SMTP delivery.
4. **PostgreSQL Database:** Authoritative source of record for email records, user accounts, sessions, sender configurations, and outbox logs.
5. **Redis Store:** High-performance backing engine for BullMQ delayed sorted sets, distributed lock leases, and sliding hourly counters.
6. **Elasticsearch Cluster:** Dedicated search node for fast multi-match queries across email metadata with automatic database fallback.

---

## Technology Stack

| Layer | Technology | Version | Purpose |
| :--- | :--- | :--- | :--- |
| **Backend Runtime** | Node.js (ES Modules) | v20+ / v24+ | Asynchronous server execution environment |
| **Language** | TypeScript | v5+ / v7+ | Static typing across backend and frontend codebases |
| **API Framework** | Express.js | v5.3 | HTTP routing, middleware, and API endpoints |
| **Persistent Queue** | BullMQ | v6.7 | Distributed delayed job scheduling and concurrency control |
| **In-Memory Store** | Redis (`ioredis`) | v6.1 | Sorted set scheduling, rate-limit counters, and atomic Lua execution |
| **Relational Database** | PostgreSQL (`pg`) | v8.23 | Persistent storage and ACID transactional outbox |
| **Search Engine** | Elasticsearch | v9.5 | Multi-match full-text email search |
| **Mail Gateway** | Nodemailer | v10.6 | SMTP transmission (Ethereal Sandbox / Gmail / Custom SMTP) |
| **Queue Admin UI** | Bull Board | v9.14 | Real-time queue telemetry and job inspection |
| **Cryptography** | Node Crypto | Native | AES-256-GCM webhook encryption and salted scrypt hashing |
| **Frontend Framework** | React 19 | v19.3 | Component-driven user interface |
| **Build Tool** | Vite | v8.3 | Frontend development server and production bundler |
| **Linter** | Oxlint | v1.90 | High-speed Rust-based JavaScript/TypeScript linter |

---

## Prerequisites

- **Node.js**: `v18.0.0` or higher (`node -v`)
- **Package Manager**: `npm` (`v9.0.0` or higher)
- **PostgreSQL**: Local instance or managed cloud provider (e.g., Neon, AWS RDS)
- **Redis**: Local Redis instance (`v6.0+`) or cloud provider (e.g., Upstash)
- *(Optional)* **Docker & Docker Compose**: For local containerized infrastructure

---

## Installation & Setup

### 1. Clone the Repository

```bash
git clone https://github.com/versatile02/reachinbox-email-scheduler.git
cd reachinbox-email-scheduler
```

### 2. Configure Environment Variables

Create the backend environment file from the provided template:

```bash
cp backend/.env.example backend/.env
```

*(On Windows PowerShell: `Copy-Item backend/.env.example backend/.env`)*

Configure your database and Redis credentials in `backend/.env`. Refer to the [Environment Configuration](#environment-configuration) section for details.

### 3. Install Dependencies & Apply Migrations

```bash
# Install backend dependencies
npm --prefix backend install

# Run database schema migrations
npm --prefix backend run db:migrate

# Install frontend dependencies
npm --prefix frontend install
```

---

## Environment Configuration

All backend configuration is defined in `backend/.env`. A complete template is maintained in `backend/.env.example`.

| Variable | Required | Default / Example | Description |
| :--- | :---: | :--- | :--- |
| `PORT` | Optional | `5000` | Port for Express API server |
| `NODE_ENV` | Optional | `development` | Runtime mode (`development`, `production`, `test`) |
| `CLIENT_URL` | **Required** | `http://localhost:5173` | Allowed CORS origin and OAuth redirect target |
| `DATABASE_URL` | **Required** | `postgresql://user:pass@localhost:5432/reachinbox` | PostgreSQL connection string |
| `DATABASE_SSL` | Optional | `false` | Enable TLS certificate validation for PostgreSQL |
| `REDIS_URL` | **Required** | `redis://localhost:6379` | Redis TCP connection URL |
| `SMTP_PROVIDER` | Optional | `ethereal` | SMTP provider: `ethereal`, `gmail`, or `custom` |
| `SMTP_USER` | Optional | *(auto-generated)* | SMTP login username (leave blank for Ethereal test sandbox) |
| `SMTP_PASS` | Optional | *(auto-generated)* | SMTP login password (e.g., Gmail 16-character App Password) |
| `SMTP_HOST` | Optional | `smtp.ethereal.email` | SMTP server host |
| `SMTP_PORT` | Optional | `587` | SMTP server port |
| `GOOGLE_CLIENT_ID` | Optional | `your-google-client-id` | Google OAuth 2.0 Client ID |
| `GOOGLE_CLIENT_SECRET` | Optional | `your-google-client-secret` | Google OAuth 2.0 Client Secret |
| `GOOGLE_REDIRECT_URI` | Optional | `http://localhost:5000/api/auth/google/callback` | Authorized Google OAuth callback URL |
| `SLACK_CLIENT_ID` | Optional | `your-slack-client-id` | Slack OAuth 2.0 Client ID |
| `SLACK_CLIENT_SECRET` | Optional | `your-slack-client-secret` | Slack OAuth 2.0 Client Secret |
| `SLACK_REDIRECT_URI` | Optional | `http://localhost:5000/api/slack/callback` | Slack OAuth callback URL |
| `ENCRYPTION_KEY` | **Required** | `0123456789abcdef... (32-byte hex)` | Key used for AES-256-GCM encryption of Slack webhooks |
| `SESSION_SECRET` | **Required** | `your-secure-session-secret` | Secret key for signing user session tokens |
| `ADMIN_EMAILS` | Optional | `oliver.brown@domain.io,admin@reachinbox.ai` | Allowlisted emails authorized to view `/admin/queues` |
| `DEFAULT_HOURLY_LIMIT` | Optional | `200` | Fallback hourly sending limit per sender |
| `DEFAULT_MIN_DELAY_SECONDS` | Optional | `2` | Minimum spacing gap between consecutive sends |
| `WORKER_CONCURRENCY` | Optional | `5` | Number of concurrent jobs processed by the worker |
| `ELASTICSEARCH_NODE` | Optional | `http://localhost:9200` | Elasticsearch HTTP endpoint |

---

## Running the Application

### Option A: Development Runner (Recommended)

Run the API server and BullMQ background worker concurrently within a single terminal:

```bash
# Terminal 1: Backend API + Background Worker
npm --prefix backend run dev:all

# Terminal 2: Frontend Dashboard
npm --prefix frontend run dev
```

* **Frontend Dashboard:** `http://localhost:5173`
* **API Server:** `http://localhost:5000`
* **Bull Board Queue UI:** `http://localhost:5000/admin/queues`

---

### Option B: Decoupled Multi-Process Mode

In production or structured development environments, run each process in its own terminal or supervisor:

| Component | Command | Target URL |
| :--- | :--- | :--- |
| **API Server** | `npm --prefix backend run dev` | `http://localhost:5000` |
| **Background Worker** | `npm --prefix backend run worker:dev` | Runs headless in background |
| **Frontend App** | `npm --prefix frontend run dev` | `http://localhost:5173` |

---

## Demo Mode

For local testing and evaluation without setting up third-party OAuth credentials, ReachInbox includes a preconfigured **Demo Mode**.

1. Start the application services using `npm --prefix backend run dev:all` and `npm --prefix frontend run dev`.
2. Open `http://localhost:5173` in your browser.
3. On the login screen, click **"⚡ Instant Login as Oliver Brown (Demo)"**.
4. The system automatically creates a local session for `oliver.brown@domain.io`, redirects to the dashboard, and grants access to email scheduling, sender management, and the `/admin/queues` monitoring board.

> **Note:** Demo Mode provides a local, preconfigured session and does not initiate an external Google OAuth redirect. Google OAuth requires valid Google Cloud credentials configured in `backend/.env`.

---

## Application Usage

### 1. Scheduling an Email
* Click the **+ Compose** button in the sidebar or overview header.
* Select a sender identity from the dropdown.
* Enter recipient email, subject, and body text.
* Pick a future date and time for scheduling.
* Click **Schedule Email**. The email is persisted in PostgreSQL and dispatched to the BullMQ delayed queue.

### 2. Ingesting Leads via Bulk Upload
* In the Compose modal, click **Upload CSV / TXT**.
* Upload a file containing email addresses (one per line, comma-separated, or CSV column format).
* The modal parses and displays the detected lead count.
* Set an inter-email delay (e.g., 5 seconds) and starting time.
* Click **Schedule Campaign**. Emails are enqueued with staggered delays.

### 3. Monitoring Scheduled and Sent Emails
* Navigate to **Scheduled** in the sidebar to view pending jobs, scheduled execution times, and status badges.
* Navigate to **Sent** to view dispatched emails, delivery timestamps, and clickable **View in Ethereal Webmail ↗** preview links.

### 4. Configuring Senders & Quotas
* Open **Senders** from the sidebar to view active mailboxes.
* Configure custom hourly quotas (e.g., max 50 emails/hour) and minimum delays between sends (e.g., 3 seconds).

### 5. Connecting Slack Alerts
* Open **Slack Integration** in the sidebar.
* Paste an incoming webhook URL (`https://hooks.slack.com/services/...`).
* The webhook URL is encrypted at rest using AES-256-GCM. When any sender hits their hourly quota, a live notification is sent to the designated channel.

---

## API Reference

### Authentication
* `GET /api/auth/google` — Initiates Google OAuth 2.0 flow.
* `GET /api/auth/google/callback` — Handles Google OAuth callback and issues session cookie.
* `POST /api/auth/demo` — Authenticates as the local demo user.
* `POST /api/auth/login` — Authenticates with email and password.
* `POST /api/auth/signup` — Registers a new user account.
* `GET /api/auth/me` — Returns current authenticated user profile.
* `POST /api/auth/logout` — Destroys current session and clears cookies.

### Email Operations
* `POST /api/emails/schedule` — Schedule a single email:
  ```json
  {
    "recipient": "lead@example.com",
    "subject": "Platform Partnership",
    "body": "Hi, wanted to connect regarding cold outreach workflows.",
    "scheduledAt": "2026-11-26T10:00:00.000Z",
    "senderEmail": "oliver.brown@domain.io"
  }
  ```
* `POST /api/emails/bulk` — Schedule a bulk campaign with staggered delays.
* `GET /api/emails` — List emails with pagination and status filters (`?status=scheduled&page=1&limit=50`).
* `GET /api/emails/search?q={query}` — Full-text search across subject, body, and recipient.
* `GET /api/emails/:id` — Retrieve details and delivery metadata for an email.
* `POST /api/emails/:id/star` — Toggle starred status on an email.
* `GET /api/emails/:id/attachments/:attachmentId` — Download email attachment.
* `POST /api/emails/reindex` — Trigger reindexing of PostgreSQL records into Elasticsearch.

### Senders & Quotas
* `GET /api/senders` — List configured sender accounts and quota usage.
* `POST /api/senders` — Create or update a sender identity with custom `hourlyLimit` and `minDelaySeconds`.

### Slack Integration
* `GET /api/slack/status` — Check whether Slack integration is active.
* `POST /api/slack/webhook` — Store and encrypt an incoming Slack webhook URL.
* `GET /api/slack/oauth` — Initiate Slack OAuth 2.0 authorization.
* `GET /api/slack/callback` — Handle Slack OAuth callback.
* `DELETE /api/slack` — Disconnect Slack integration.

### Health & Queue Telemetry
* `GET /api/health` — Returns system health (PostgreSQL, Redis, BullMQ, Elasticsearch).
* `GET /admin/queues` — Web UI for Bull Board queue monitoring (requires admin email).

---

## Testing

The project includes an automated test suite verifying unit logic, transactional boundaries, rate-limit algorithms, queue recovery, and security access controls.

### Running Backend Tests

```bash
npm --prefix backend test
```

* **Current Verified Suite Status:** 108 tests passing across 24 test suites.
* **Test Coverage Areas:**
  * Express API route handlers, input validation, and HTTP error responses.
  * Auth service, salted scrypt password hashing, and session management.
  * Redis client configuration, exponential backoff, and retry strategies.
  * PostgreSQL connection pool error trapping and query execution.
  * Elasticsearch multi-match queries and automatic PostgreSQL fallback.
  * Mailer service and Ethereal preview extraction.
  * Distributed rate limiting and inter-send minimum pacing scripts.
  * Non-blocking reschedule logic via BullMQ `moveToDelayed`.
  * Slack notification service and webhook payload formatting.
  * Transactional outbox persistence and startup queue reconciliation.
  * Email worker lease locks, heartbeat renewals, and crash recovery.
  * Security authorization and admin allowlisting on `/admin/queues`.

> **Note on Integration Boundaries:** Automated tests validate system logic, error paths, and mock boundaries locally. They do not substitute for live end-to-end integration with external providers (such as live Google OAuth consent screens or active Slack workspaces), which require live credentials.

### Running Frontend Verification

```bash
# Run static linter
npm --prefix frontend run lint

# Run production build
npm --prefix frontend run build
```

* **Linter (`oxlint`):** 0 errors, 0 warnings across 13 TypeScript/TSX source files.
* **Production Build (`vite build`):** Generates optimized static assets cleanly.

---

## Docker Infrastructure Setup

For local development with completely containerized backing services, a `docker-compose.yml` configuration is provided:

```bash
# 1. Start PostgreSQL 16, Redis 7 (AOF enabled), and Elasticsearch 8.11
docker compose up -d

# 2. Copy Docker environment settings
cp .env.docker.example backend/.env

# 3. Apply database migrations
npm --prefix backend run db:migrate

# 4. Start backend and frontend
npm --prefix backend run dev:all
npm --prefix frontend run dev
```

---

## Operational Semantics & Reliability

1. **At-Least-Once Delivery Over SMTP:**
   Distributed email systems inherently operate under *at-least-once* delivery semantics. If an SMTP server accepts a message with `250 OK`, but the worker process terminates unexpectedly before updating the record to `sent` in PostgreSQL, BullMQ will re-queue the job once the lease expires. This ensures emails are not lost during node crashes, though recipients may rarely receive a duplicate in crash scenarios.
2. **Elasticsearch Resilience:**
   Elasticsearch is treated as a secondary search index. If the cluster is unreachable or unconfigured, the search endpoint automatically falls back to PostgreSQL `ILIKE` pattern matching without failing user requests.
3. **Queue Reconciliation on Startup:**
   If Redis is flushed, restarted, or encounters memory eviction, the startup reconciler queries PostgreSQL for scheduled emails without active Redis jobs and re-enqueues them with their exact remaining delay.
4. **Rate Limit Breach Handling:**
   When an hourly sending cap is reached, the worker calculates milliseconds until the start of the next UTC hour window and defers the job using BullMQ `moveToDelayed()`. The worker thread immediately returns to the pool to process jobs for other senders without sleeping or blocking.
5. **Ethereal Sandbox vs Production SMTP:**
   When no SMTP credentials are provided, ReachInbox provisions an ephemeral account on [Ethereal.email](https://ethereal.email). Emails sent through Ethereal are captured in a private webmail sandbox and are not delivered to public inboxes. To send to public recipients (e.g., Gmail), valid SMTP credentials must be configured.

---

## Known Limitations & Trade-offs

* **Redis Volatility:** While BullMQ delayed jobs are persisted in Redis, Redis should be configured with Append-Only File (`appendonly yes`) persistence in production. In the event of an unpersisted Redis restart, the application relies on its PostgreSQL queue reconciliation sweep.
* **Google OAuth Setup:** Google OAuth requires a registered Google Cloud project, OAuth Client ID, Client Secret, and an exact matching callback URL (`http://localhost:5000/api/auth/google/callback`). For environments without Google Cloud access, use Demo Mode or email/password authentication.
* **Elasticsearch Memory Requirements:** Running Elasticsearch locally requires at least 2 GB of available RAM. For lightweight local development, Elasticsearch is optional; the application seamlessly routes search queries to PostgreSQL.

---

## Project Structure

```text
reachinbox-email-scheduler/
├── backend/
│   ├── src/
│   │   ├── config/          # Database, Redis, and environment configuration
│   │   ├── controllers/     # Route controllers (Auth, Email, Sender, Slack, Health)
│   │   ├── middleware/      # Auth session, file upload, and error middleware
│   │   ├── models/          # PostgreSQL schema, migrations, and repository
│   │   ├── queues/          # BullMQ queue instantiation and connection options
│   │   ├── routes/          # Express route definitions
│   │   ├── services/        # Mailer, Outbox, Rate Limiting, Slack, and Elasticsearch
│   │   ├── types/           # TypeScript interfaces and shared types
│   │   ├── workers/         # Standalone BullMQ email processing worker
│   │   ├── app.ts           # Express application initialization & Bull Board mounting
│   │   ├── dev-all.ts       # Concurrent development runner (API + Worker)
│   │   └── server.ts        # Express HTTP server entrypoint
│   ├── tests/               # 108 automated unit, integration, and security tests
│   ├── .env.example         # Template environment file with safe placeholder values
│   ├── package.json         # Backend scripts and dependencies
│   └── tsconfig.json        # Backend TypeScript compiler configuration
├── frontend/
│   ├── src/
│   │   ├── components/      # React 19 UI components (Header, Sidebar, EmailList, Compose, etc.)
│   │   ├── services/        # Frontend API client
│   │   ├── App.tsx          # Root application component
│   │   ├── App.css          # Application layout and design styling
│   │   ├── main.tsx         # React DOM entrypoint
│   │   └── types.ts         # Frontend TypeScript interfaces
│   ├── index.html           # HTML template
│   ├── package.json         # Frontend scripts and dependencies
│   ├── tsconfig.json        # Frontend TypeScript configuration
│   └── vite.config.js       # Vite configuration with API and Bull Board proxies
├── .env.docker.example      # Local Docker configuration template
├── docker-compose.yml       # Docker orchestration (Postgres 16, Redis 7, Elasticsearch)
├── .gitignore               # Excludes .env files, uploads, and node_modules
└── README.md                # Project documentation
```

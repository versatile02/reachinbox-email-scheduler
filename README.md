# ReachInbox Email Job Scheduler

A production-grade, distributed email scheduling service and dashboard built for the **ReachInbox (Outbox Labs)** Software Development Intern hiring assignment.

---

## Table of Contents
1. [Project Overview](#project-overview)
2. [Technology Stack](#technology-stack)
3. [Project Directory Structure](#project-directory-structure)
4. [Current Implementation Status](#current-implementation-status)
5. [Prerequisites](#prerequisites)
6. [Getting Started](#getting-started)
   - [Database Migration](#database-migration)
   - [Backend API Setup](#backend-api-setup)
   - [Background Worker Setup](#background-worker-setup)
   - [Frontend Setup](#frontend-setup)
7. [Automated Test Suite](#automated-test-suite)
8. [API Endpoints & Specifications](#api-endpoints--specifications)
   - [Health Check](#health-check)
   - [Schedule an Email](#schedule-an-email)
   - [List Emails](#list-emails)
   - [Get Email by ID](#get-email-by-id)
9. [Architecture & Reliability Highlights](#architecture--reliability-highlights)
   - [Strictly No Cron Jobs](#strictly-no-cron-jobs)
   - [Producer vs Worker Redis Connection Design](#producer-vs-worker-redis-connection-design)
   - [Idempotency & Concurrency Guards](#idempotency--concurrency-guards)
   - [Hardened Graceful Shutdown](#hardened-graceful-shutdown)
10. [Development Roadmap](#development-roadmap)

---

## Project Overview

ReachInbox relies on reliable scheduling and sending of cold outreach emails at scale. This project implements a full-stack email scheduler that:
- Accepts email scheduling requests via REST API.
- Schedules emails for specific future dates and times.
- Uses **BullMQ + Redis** as a persistent delayed job scheduler (**strictly no cron jobs**).
- Processes jobs via a decoupled background worker process (`backend/src/workers/email.worker.js`).
- Sends test emails using fake SMTP via **Nodemailer + Ethereal Email**, generating web preview URLs.
- Persists scheduling status and email history in **PostgreSQL** across all states (`scheduled`, `processing`, `sent`, `failed`).
- Survives server and worker restarts without losing scheduled jobs.
- Provides a clean **React Dashboard** to schedule emails and view scheduled and sent emails.

---

## Technology Stack

- **Frontend:** React 19, Vite, Vanilla CSS
- **Backend:** Node.js (v24+), Express.js (ES Modules)
- **Queue & Scheduler:** BullMQ + Redis (delayed jobs)
- **Database:** PostgreSQL (`pg` driver with parameterized queries & connection pooling)
- **Email Service:** Nodemailer + Ethereal Email (Fake SMTP)
- **Testing:** Node.js native test runner (`node:test`, `node:assert/strict`)

---

## Project Directory Structure

```text
reachinbox-email-scheduler/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   ├── index.js             # Centralized environment & app configuration
│   │   │   ├── database.js          # PostgreSQL connection pool & lifecycle management
│   │   │   └── redis.js             # Producer & worker Redis connection options
│   │   ├── controllers/
│   │   │   ├── health.controller.js # Service health check handler
│   │   │   └── email.controller.js  # Email scheduling, listing & lookup handlers
│   │   ├── models/
│   │   │   ├── schema.sql           # PostgreSQL table definitions & performance indexes
│   │   │   ├── migrate.js           # CLI-executable database schema migrator
│   │   │   └── email.repository.js  # Parameterized SQL repository for email records
│   │   ├── queues/
│   │   │   └── email.queue.js       # Reusable BullMQ email queue & scheduling helpers
│   │   ├── routes/
│   │   │   ├── index.js             # Central API router mounting /health and /emails
│   │   │   ├── health.routes.js     # Health check routes
│   │   │   └── email.routes.js      # REST API endpoints for email scheduling
│   │   ├── services/
│   │   │   └── mailer.service.js    # Nodemailer + Ethereal SMTP transporter & preview capture
│   │   ├── workers/
│   │   │   └── email.worker.js      # Standalone background worker process for delayed jobs
│   │   ├── app.js                   # Express application configuration & middlewares
│   │   └── server.js                # HTTP server entry point & graceful shutdown
│   ├── tests/
│   │   ├── setup.js                 # Global test environment configuration
│   │   ├── config.test.js           # Redis options & retry strategies test suite
│   │   ├── validation.test.js       # Payload & timing validation unit tests
│   │   ├── repository.test.js       # PostgreSQL parameterized repository tests
│   │   ├── mailer.test.js           # Mailer service transport & error tests
│   │   ├── worker.test.js           # Worker job processing & idempotency tests
│   │   └── api.test.js              # HTTP endpoint integration tests
│   ├── .env.example                 # Backend environment variable template
│   └── package.json                 # Backend dependencies, scripts & test runners
├── frontend/                        # React 19 + Vite dashboard (scheduled for UI integration)
├── docs/
│   └── architecture.md              # Architectural decisions & system designs
└── README.md                        # Project documentation & instructions
```

---

## Current Implementation Status

- **Task 1: Foundation Initialization (Completed):** Monorepo structure, Express API, Vite frontend, and `/api/health`.
- **Task 2.1: Redis & BullMQ Infrastructure (Completed):** Centralized Redis configuration, TLS & Upstash username support, BullMQ queue setup, and hardened graceful shutdown.
- **Task 2.2: Complete Backend Email Scheduling Engine (Completed):**
  - **PostgreSQL Persistence:** Complete `emails` table schema with indexes on `status`, `scheduled_at`, and `created_at`.
  - **REST API Endpoints:** `POST /api/emails/schedule`, `GET /api/emails`, and `GET /api/emails/:id`.
  - **Producer vs Worker Redis Separation:** HTTP API producers use bounded retries (`maxRetriesPerRequest: 3`) to fail fast and prevent hanging requests, while workers use `maxRetriesPerRequest: null` for blocking operations.
  - **Decoupled Background Worker:** Standalone worker process (`npm run worker`) consuming delayed BullMQ jobs with atomic concurrency checks and idempotency guards.
  - **Nodemailer + Ethereal Fake SMTP:** Automated test account provisioning and live message preview URL generation.
  - **Comprehensive Automated Test Suite:** 39 tests passing across 6 test suites covering validation, configuration, repository, mailer, worker, and API endpoints.

---

## Prerequisites

- **Node.js**: `v18.0.0` or higher (verified with `v24.6.0`)
- **npm**: `v9.0.0` or higher (verified with `v11.5.1`)
- **Redis**: `v6.0.0` or higher (`v7+` recommended). Required for BullMQ job queue persistence.
- **PostgreSQL**: `v14.0.0` or higher. Required for email metadata persistence.

---

## Getting Started

### 1. Database Migration

Ensure your PostgreSQL instance is running and configured in `backend/.env` (or via `DATABASE_URL` / standard `PGHOST`, `PGUSER`, `PGDATABASE` environment variables).

Run the automated migration runner to apply the schema:
```bash
cd backend
npm run db:migrate
```

### 2. Backend API Setup

1. Navigate to the `backend` directory:
   ```bash
   cd backend
   ```
2. Start the API server:
   ```bash
   npm run dev
   # or production mode:
   npm start
   ```
   The API will listen at `http://localhost:5000`.

### 3. Background Worker Setup

In a separate terminal, launch the standalone BullMQ background worker:
```bash
cd backend
npm run worker
```
The worker will listen on `email-queue`, process delayed jobs as they mature, dispatch emails via Ethereal SMTP, and log the generated web preview URLs.

### 4. Frontend Setup

```bash
cd frontend
npm run dev
```
The dashboard will open at `http://localhost:5173`.

---

## Automated Test Suite

Run the full automated test suite:
```bash
cd backend
npm test
```
The test suite utilizes the Node.js native test runner (`node:test`) and executes 39 unit and integration tests across 6 suites without requiring active Redis or PostgreSQL servers.

---

## API Endpoints & Specifications

### Health Check
- **Endpoint:** `GET /api/health`
- **Response:** `200 OK`
```json
{
  "status": "ok",
  "message": "ReachInbox Email Scheduler Backend is running",
  "environment": "development"
}
```

### Schedule an Email
- **Endpoint:** `POST /api/emails/schedule`
- **Request Headers:** `Content-Type: application/json`
- **Request Body:**
```json
{
  "recipient": "client@example.com",
  "subject": "Scheduled Meeting Reminder",
  "body": "Hello! Just reminding you about our scheduled call tomorrow.",
  "scheduledAt": "2026-11-25T10:00:00.000Z"
}
```
*(Alternatively, you can supply `"delayMs": 60000` for relative scheduling).*

- **Response:** `201 Created`
```json
{
  "message": "Email scheduled successfully",
  "data": {
    "id": "e8e19572-c51d-407b-8c88-e99d821a8d05",
    "recipient": "client@example.com",
    "subject": "Scheduled Meeting Reminder",
    "body": "Hello! Just reminding you about our scheduled call tomorrow.",
    "scheduledAt": "2026-11-25T10:00:00.000Z",
    "status": "scheduled",
    "sentAt": null,
    "errorMessage": null,
    "etherealPreviewUrl": null,
    "createdAt": "2026-11-24T08:00:00.000Z",
    "updatedAt": "2026-11-24T08:00:00.000Z"
  }
}
```
- **Error Responses:**
  - `400 Bad Request`: Missing/invalid recipient, empty subject/body, past `scheduledAt` timestamp.
  - `503 Service Unavailable`: Redis queue offline (email saved with `status: 'failed'`).

### List Emails
- **Endpoint:** `GET /api/emails`
- **Query Parameters:**
  - `status` (optional): Filter by `scheduled`, `processing`, `sent`, `failed`
  - `page` (optional, default `1`): Page number
  - `limit` (optional, default `20`): Items per page (max 100)
- **Response:** `200 OK`
```json
{
  "data": [
    {
      "id": "e8e19572-c51d-407b-8c88-e99d821a8d05",
      "recipient": "client@example.com",
      "subject": "Scheduled Meeting Reminder",
      "status": "sent",
      "scheduledAt": "2026-11-25T10:00:00.000Z",
      "sentAt": "2026-11-25T10:00:02.124Z",
      "etherealPreviewUrl": "https://ethereal.email/message/...",
      "createdAt": "2026-11-24T08:00:00.000Z"
    }
  ],
  "pagination": {
    "total": 1,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

### Get Email by ID
- **Endpoint:** `GET /api/emails/:id`
- **Response:** `200 OK` or `404 Not Found`

---

## Architecture & Reliability Highlights

### Strictly No Cron Jobs
Scheduling is handled with BullMQ delayed jobs (`emailQueue.add('sendEmail', data, { delay, jobId })`). Delayed jobs are persisted in Redis sorted sets (`ZSET`) and evaluated with millisecond accuracy. This completely avoids recurring database polling stampedes.

### Producer vs Worker Redis Connection Design
- **Producers (`getProducerConnectionOptions`)**: The HTTP API server uses bounded retries (`maxRetriesPerRequest: 3`) and a 3-second connect timeout. If Redis is down, HTTP requests fail fast with `503 Service Unavailable` rather than hanging indefinitely.
- **Workers (`getWorkerConnectionOptions`)**: The standalone worker process uses `maxRetriesPerRequest: null`, which is strictly required by BullMQ for blocking commands (`BRPOPLPUSH` / `BLMOVE`).

### Idempotency & Concurrency Guards
1. **Queue Job ID Uniqueness:** When enqueuing, `jobId = email.id`, preventing duplicate jobs from being scheduled in BullMQ for the same record.
2. **Atomic Lease Claim with Fencing Token:** The worker claims the record using a time-bounded atomic SQL lease with a unique UUID fencing token:
   ```sql
   UPDATE emails
   SET status = 'processing',
       claim_token = $3,
       updated_at = NOW()
   WHERE id = $1
     AND (
       status = 'scheduled'
       OR (status = 'processing' AND updated_at < NOW() - ($2 * INTERVAL '1 second'))
     )
   RETURNING *;
   ```
   If another worker holds an unexpired lease, `markEmailProcessing` returns `null`. The worker throws an error so BullMQ schedules a retry instead of silently dropping the job.
3. **Fenced Lease Heartbeat:** While SMTP delivery is in flight, an in-process heartbeat touches `updated_at = NOW()` every 15 seconds, enforcing `WHERE claim_token = $claimToken`. If the query returns 0 rows (e.g. lease expired and was claimed by a newer worker), the heartbeat stops immediately and sets `leaseLost = true`.
4. **Stalled Worker Recovery:** If a worker process abruptly dies (OOM, network cutoff), its heartbeat halts. After the 60-second claim lease expires, BullMQ's stalled-job recovery safely allows another worker to claim the abandoned record.
5. **In-Flight SMTP Cancellation Limitation & At-Least-Once Processing Semantics:**
   - **Heartbeat & Responsive Event Loop:** The heartbeat runs asynchronously every 15 seconds while `sendEmail()` awaits SMTP response. If an SMTP transaction takes 60+ seconds (e.g., slow remote MTA response or tarpitting), the heartbeat continues to renew `updated_at = NOW()` as long as the Node.js event loop remains responsive and PostgreSQL connection is healthy. A slow SMTP response alone will not expire the 60-second database lease.
   - **Heartbeat Interruption & Lease Expiry:** Lease expiry during processing becomes possible when heartbeat renewal is interrupted for longer than the 60-second lease window. Real-world causes include process/VM suspension, container CPU freeze/throttling, long garbage collection pauses, event-loop starvation, or sustained database connectivity failure.
   - **In-Flight Cancellation Impossibility:** If heartbeat renewal is interrupted long enough for the lease to expire, BullMQ's stalled-job recovery or a subsequent retry attempt can allow a replacement worker to claim the record with a new fencing token and initiate delivery. Meanwhile, the original worker's in-flight SMTP TCP connection may still be active. Because the SMTP protocol (RFC 5321) does not support two-phase commit or transactional rollback, an in-flight email transmission cannot be recalled once data has been streamed across the wire.
   - **Token Fencing Outcome:** If the original worker resumes, detects lease loss via `touchEmailProcessing`, or finishes its SMTP send, its attempt to update the database to `'sent'` will be rejected by token fencing (`WHERE claim_token = $claimToken`), preventing it from corrupting the replacement worker's state in PostgreSQL. However, because both workers may successfully communicate with remote MTAs, the recipient may receive duplicate messages.
   - **Precise Delivery Semantics:** The system provides **at-least-once processing/retry semantics with possible duplicate delivery**. It does not guarantee exactly-once delivery. The application reports successful acceptance by the upstream SMTP server when Nodemailer receives a successful SMTP response. This does not guarantee final delivery to the recipient's inbox (as downstream MTAs, anti-spam filters, or recipient mail servers may defer, reject, or quarantine messages outside the application's control).
6. **Dual-Write Mitigation:** If SMTP succeeds (`250 OK`) but the database update to `sent` encounters a transient connection error, the worker retries the database update up to 3 times before failing. All state transitions enforce `WHERE claim_token = $claimToken` to prevent superseded workers from overwriting newer claims.
7. **Sent Status Safeguard:** If an email is already marked as `sent`, delivery is immediately bypassed (`{ skipped: true, reason: 'Already sent' }`).
8. **Explicit SMTP Transport Timeouts:** Nodemailer SMTP transport is configured with explicit socket-level timeouts (`connectionTimeout: 10000`, `greetingTimeout: 10000`, `socketTimeout: 30000`) to fail fast on unresponsive or tarpitting SMTP hosts. A socket timeout does not guarantee cancellation of a message already accepted by a remote mail server, preserving the system's at-least-once processing/retry semantics.
9. **PostgreSQL Pool Idle-Client Error Handler:** The database pool attaches a `pool.on('error', ...)` listener in `backend/src/config/database.js` to safely catch unexpected errors emitted by idle pooled connections (e.g. Server-side connection terminations or firewall drops) without crashing the Node.js process. This listener logs a fixed generic message with a validated alphanumeric error code, guaranteeing that raw error messages, connection strings, and credentials never appear in logs.

### Hardened Graceful Shutdown
Both the HTTP server (`server.js`) and the background worker (`email.worker.js`) listen for `SIGTERM` and `SIGINT`:
- Stop accepting new HTTP requests and drain active connections.
- Close BullMQ queues and workers cleanly.
- Terminate PostgreSQL connection pool.
- Active 10-second watchdog to guarantee termination in stuck container environments.

---

## Development Roadmap

- **Task 1 (Completed):** Project structure, Express health check, React Vite frontend landing page, and documentation.
- **Task 2.1 (Completed):** BullMQ queue integration and centralized Redis connection setup with graceful shutdown.
- **Task 2.2 (Completed):** Complete backend email scheduling engine (PostgreSQL persistence, REST API, decoupled worker, Nodemailer + Ethereal SMTP, automated test suite).
- **Task 3 / Task 5 (Upcoming):** React Dashboard for composing emails, scheduling time pickers, and viewing real-time queue states and delivery previews.
- **Task 6 (Upcoming):** Server restart resilience validation, comprehensive end-to-end verification, and demo video preparation.

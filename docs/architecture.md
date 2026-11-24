# ReachInbox Email Job Scheduler — Architecture & System Design

## 1. System Overview

ReachInbox Email Scheduler is a production-grade, distributed email scheduling service and interactive dashboard designed for cold outreach workflows. The architecture is engineered around high concurrency, crash resilience, multi-sender rate limiting, and zero-loss restart persistence.

### Core Architecture Pillars:
1. **Interactive React 19 Dashboard & Management Plane:** Single-page dashboard for composing single or bulk outreach campaigns, managing multi-sender quotas and pacing, inspecting real-time queue states, and connecting Slack alert webhooks.
2. **Express TypeScript REST API:** High-throughput, stateless endpoints for email scheduling, status inspection, sender configuration, and queue health monitoring. Producers use bounded Redis connection timeouts (`maxRetriesPerRequest: 3`) to fail fast rather than hang incoming client requests.
3. **Persistent Delayed Queue Engine (BullMQ + Redis):** Precision-timed execution engine. Delayed jobs are persisted in Redis sorted sets (`ZSET`) keyed by execution epoch, completely avoiding recurring cron jobs or database polling stampedes.
4. **Decoupled Background Worker Process:** Standalone process consuming jobs from BullMQ, enforcing multi-sender distributed rate limits and minimum pacing gaps, maintaining active PostgreSQL lease heartbeats, and dispatching via Ethereal SMTP with dual-write safety.
5. **PostgreSQL Relational State Store:** ACID state machine tracking email records (`scheduled` → `processing` → `sent` / `failed`) with atomic fencing tokens (`claim_token`) to prevent split-brain delivery.

---

## 2. Architecture & Data Flow Diagram

```
+-----------------------------------------------------------------------------------+
|                           ReachInbox Frontend Dashboard                           |
|                                 (React 19 + Vite)                                 |
+-----------------------------------------------------------------------------------+
           |                                                      ^
           | HTTP REST (Compose, Senders, Slack)                  | Live Polling / Status
           v                                                      |
+-----------------------------------------------------------------------------------+
|                         Express TypeScript Backend API                            |
|                            (Port 5000 / Stateless)                                |
+-----------------------------------------------------------------------------------+
        |                                                              |
        | 1. Enqueue Delayed Job                                       | 2. Persist Record
        | (jobId = email.id)                                           | (status: 'scheduled')
        v                                                              v
+-------------------------------+                     +-------------------------------+
|      Redis (BullMQ ZSET)      |                     |      PostgreSQL Database      |
|    - BullMQ delayed queue     |                     |    - emails table             |
|    - Rate limit quotas (Lua)  |                     |    - senders table            |
|    - Slack deduplication keys |                     |    - slack_integrations table |
+-------------------------------+                     +-------------------------------+
        |                                                              ^
        | 3. Delayed Job Matures                                       | 4. Atomic Lease Claim
        |    (BLMOVE / BRPOPLPUSH)                                     |    (claim_token & heartbeat)
        v                                                              |
+----------------------------------------------------------------------+------------+
|                         Decoupled Background Worker                               |
|                         (BullMQ Worker Process)                                   |
|                                                                                   |
|  - Idempotency & Lease Guard: Check DB record, acquire atomic lease token         |
|  - Distributed Rate Limiter: Atomic Redis Lua hourly quota & pacing verification   |
|  - Safe Rescheduling: Non-blocking job.moveToDelayed() + DelayedError             |
|  - Two-Phase Slack Alerting: Best-effort alert dispatch on quota exhaustion       |
|  - SMTP Dispatcher: Nodemailer with socket timeouts and Ethereal preview extract  |
|  - Dual-Write Transition: Mark 'sent' with ethereal_preview_url & claim token    |
+-----------------------------------------------------------------------------------+
                                       |
                                       | 5. SMTP Transmission
                                       v
+-----------------------------------------------------------------------------------+
|                          Ethereal Email (Fake SMTP)                               |
|                    Web-viewable test inboxes with preview URL                     |
+-----------------------------------------------------------------------------------+
```

---

## 3. Core Reliability & Concurrency Designs

### 3.1 Strictly No Cron Jobs
Cron-based architectures poll database tables at fixed intervals (e.g., every 60 seconds), introducing latency jitter, query stampedes, and race conditions across horizontal instances. ReachInbox uses **BullMQ delayed jobs** backed by Redis sorted sets (`bull:email-queue:delayed`). Jobs are scheduled for their target millisecond epoch and delivered immediately upon maturity.

### 3.2 Dual-Tier Redis Connection Strategy
- **Producers (`getProducerConnectionOptions`):** The Express API server connects using `maxRetriesPerRequest: 3` and a 3-second connect timeout. If Redis is unavailable, client HTTP requests fail immediately with `503 Service Unavailable` instead of queuing indefinitely.
- **Workers (`getWorkerConnectionOptions`):** The background worker connects with `maxRetriesPerRequest: null`, which is strictly mandatory for BullMQ worker instances to execute non-failing blocking commands (`BLMOVE`). In addition, TCP keep-alive (`keepAlive: 10000`) and TLS SNI (`servername: config.redis.host`) ensure uninterrupted connectivity across cloud Redis providers (such as Upstash).

### 3.3 Atomic Concurrency Lease & Heartbeat Fencing
To guarantee that concurrent workers never dispatch the same email record twice:
1. **Atomic SQL Lease Claim:** A worker attempts to acquire an ownership lease using a unique UUID fencing token:
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
2. **Active Lease Heartbeat:** While SMTP transmission is in progress, an in-process heartbeat touches `updated_at = NOW()` every 15 seconds enforcing `WHERE claim_token = $claimToken`. If the touch query returns 0 rows (meaning the lease was superseded or reclaimed), the heartbeat halts immediately and flags `leaseLost = true`.
3. **Stalled Worker Recovery:** If a worker crashes or encounters an OOM event, its heartbeat halts. Once the 60-second lease window elapses, a replacement worker safely reclaims the record without deadlocking.

### 3.4 Distributed Multi-Sender Rate Limiting & Safe Rescheduling
Every sender identity has a configurable maximum emails per UTC hour (`hourly_limit`) and minimum delay between emails (`min_delay_seconds`).
1. **Atomic Redis Lua Reservation:** Quota and pacing checks are executed in a single atomic Lua script (`ratelimit.service.ts`). The script tracks sent email IDs in an hourly Redis Set (`rl:quota:{sender}:{utc_hour}:emails`).
2. **Idempotent Retry Reservations:** Retrying an email within the same UTC hour detects its presence in the set and does NOT re-increment the sender's hourly quota.
3. **Non-Blocking Rescheduling via `DelayedError`:** When a sender exceeds their hourly limit or requires inter-send pacing delay exceeding 2000ms:
   - The worker releases the PostgreSQL lease back to `scheduled`.
   - The worker calculates the delay until the next UTC hour boundary (or pacing slot).
   - The worker calls `await job.moveToDelayed(targetEpoch, job.token)` and throws `new DelayedError()`.
   - This returns the worker concurrency thread to BullMQ immediately without sleeping in-process, preventing queue thread starvation.

---

## 4. Delivery Semantics & Failure Modes

### 4.1 At-Least-Once Delivery Guarantee
Because the SMTP protocol (RFC 5321) does not support two-phase commit (2PC) or transactional rollback, **the system provides at-least-once delivery semantics**.
- If a worker successfully dispatches an email through SMTP, but experiences an unrecoverable network partition or server termination before recording `status = 'sent'` in PostgreSQL, a subsequent retry attempt may redeliver the message.
- Exactly-once delivery is physically impossible over standard SMTP without end-to-end downstream deduplication at the recipient MTA.

### 4.2 Slack Alert Notifications (Best-Effort Delivery)
When a sender breaches their hourly quota, the worker dispatches a Slack Webhook alert.
- **Deduplication:** A Redis key `slack:alert:{sender}:{utc_hour}` prevents spamming multiple alerts within the same hour window.
- **Semantics:** A Redis lock does not provide exactly-once notification guarantees. In the event of transient network failure between the worker and the Slack API, the alert is logged and skipped rather than failing the core email dispatch pipeline. Slack notifications are strictly best-effort.

### 4.3 Dual-Write Resilience
If SMTP delivery returns a `250 OK` acceptance response from the upstream MTA, but the database update to `sent` fails due to a transient database blip, the worker retries the status update up to 3 times with exponential backoff before throwing, preserving the `ethereal_preview_url` and Message-ID.

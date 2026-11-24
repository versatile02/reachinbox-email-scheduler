# ReachInbox Email Job Scheduler - Architecture Overview

## 1. System Overview

ReachInbox Email Scheduler is a production-grade full-stack service designed for reliable, scalable email scheduling and dispatch. The architecture is built around three core pillars:
1. **REST API & Management Dashboard**: Endpoints and interactive UI for scheduling emails and viewing delivery states.
2. **Persistent Queue Engine (BullMQ + Redis)**: Persistent delayed job scheduling that survives server restarts without relying on cron jobs.
3. **Decoupled Background Worker & Fake SMTP**: Asynchronous worker consuming jobs from Redis and delivering them via Ethereal Email with PostgreSQL status persistence.

---

## 2. Architecture Diagram

```
+-------------------------------------------------------------+
|                     ReachInbox Dashboard                    |
|                      (React 19 + Vite)                      |
+-------------------------------------------------------------+
                              |
                              | HTTP REST Requests
                              v
+-------------------------------------------------------------+
|                     Express Backend API                     |
|                 (REST Controllers & Routes)                 |
+-------------------------------------------------------------+
               |                               |
               | Push Delayed Job              | Query Status & Logs
               v                               v
+-----------------------------+ +-----------------------------+
|        Redis + BullMQ       | |         PostgreSQL          |
|    (Persistent Job Queue)   | |   (Email & Job Records)     |
+-----------------------------+ +-----------------------------+
               |                               ^
               | Pull Scheduled Job at Target  |
               | Time                          | Update Status
               v                               |
+----------------------------------------------+--------------+
|                   Decoupled Background Worker               |
|                     (BullMQ Worker Process)                 |
+-------------------------------------------------------------+
                              |
                              | SMTP Dispatch
                              v
+-------------------------------------------------------------+
|                   Ethereal Email (Fake SMTP)                |
|                    (Web-viewable test inbox)                |
+-------------------------------------------------------------+
```

---

## 3. Key Design Decisions

### 3.1 Why BullMQ + Redis instead of Cron Jobs?
- **Prohibition of Cron**: The assignment strictly forbids cron jobs.
- **Precision & Scale**: Cron jobs typically poll database tables at intervals (e.g. every minute), creating query stampedes and latency jitter. BullMQ utilizes Redis sorted sets (`ZSET`) with timestamps as scores, executing scheduled jobs precisely when their delay timer elapses without repeated polling overhead.
- **Persistence Across Restarts**: When the server or worker restarts, Redis preserves all pending delayed jobs. No scheduled emails are lost or re-executed prematurely.

### 3.2 Decoupled API and Worker
- The API server handles client requests, validation, and queue insertion.
- The background worker executes independently. High traffic on email dispatching will never block HTTP requests or degrade user experience on the dashboard.

### 3.3 Monorepo Structure
- Backend and frontend reside in the same repository for simplified version control, unified documentation, and streamlined setup for reviewers, while remaining strictly decoupled at runtime.

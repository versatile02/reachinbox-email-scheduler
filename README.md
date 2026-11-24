# ReachInbox Email Job Scheduler

A production-grade, distributed email scheduling service and dashboard built for the **ReachInbox (Outbox Labs)** Software Development Intern hiring assignment.

---

## Table of Contents
1. [Project Overview](#project-overview)
2. [Technology Stack](#technology-stack)
3. [Project Directory Structure](#project-directory-structure)
4. [Current Implementation Status (Task 1)](#current-implementation-status-task-1)
5. [Prerequisites](#prerequisites)
6. [Getting Started](#getting-started)
   - [Backend Setup](#backend-setup)
   - [Frontend Setup](#frontend-setup)
7. [Testing the Health-Check Endpoint](#testing-the-health-check-endpoint)
8. [Architecture & Reliability Highlights](#architecture--reliability-highlights)
9. [Development Roadmap](#development-roadmap)
10. [Git & Submission Guidelines](#git--submission-guidelines)

---

## Project Overview

ReachInbox relies on reliable scheduling and sending of cold outreach emails at scale. This project implements a full-stack email scheduler that:
- Accepts email scheduling requests via REST API.
- Schedules emails for specific future dates and times.
- Uses **BullMQ + Redis** as a persistent delayed job scheduler (**no cron jobs**).
- Processes jobs via a decoupled background worker.
- Sends test emails using fake SMTP via **Ethereal Email**.
- Persists scheduling status and email history in **PostgreSQL**.
- Survives server and worker restarts without losing scheduled jobs.
- Provides a clean **React Dashboard** to schedule emails and view scheduled and sent emails.

---

## Technology Stack

- **Frontend:** React 19, Vite, Vanilla CSS
- **Backend:** Node.js (v24+), Express.js (ES Modules)
- **Queue & Scheduler:** BullMQ + Redis (delayed jobs)
- **Database:** PostgreSQL
- **Email Service:** Nodemailer + Ethereal Email (Fake SMTP)
- **Package Manager:** npm

---

## Project Directory Structure

```text
reachinbox-email-scheduler/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   ├── index.js         # Centralized environment & app configuration
│   │   │   └── redis.js         # Redis client factory & connection options
│   │   ├── controllers/         # Request handlers (e.g., health.controller.js)
│   │   ├── routes/              # Express API route declarations
│   │   ├── services/            # Business logic (email & scheduler services)
│   │   ├── queues/
│   │   │   └── email.queue.js   # Reusable BullMQ email queue & scheduling helpers
│   │   ├── workers/             # Dedicated background email dispatch workers
│   │   ├── models/              # Database entities & schema definitions
│   │   ├── middleware/          # Error handling, validation, logging middlewares
│   │   ├── utils/               # Helper functions and shared utilities
│   │   ├── app.js               # Express application configuration
│   │   └── server.js            # HTTP server entry point & graceful shutdown
│   ├── tests/                   # Backend unit and integration tests
│   ├── .env.example             # Backend environment variable template
│   └── package.json             # Backend dependencies and scripts
├── frontend/
│   ├── src/
│   │   ├── assets/              # Static assets
│   │   ├── App.jsx              # Main React component & dashboard landing
│   │   ├── App.css              # Dashboard styling
│   │   └── main.jsx             # React entry point
│   ├── public/                  # Static web resources
│   ├── index.html               # Vite HTML template
│   ├── vite.config.js           # Vite build and proxy configuration
│   ├── .env.example             # Frontend environment variable template
│   └── package.json             # Frontend dependencies and scripts
├── docs/
│   └── architecture.md          # Architectural decisions & system designs
├── .gitignore                   # Root Git ignore rules (node_modules, .env, builds)
└── README.md                    # Project documentation & instructions
```

---

## Current Implementation Status (Task 1)

In this **Phase 1: Foundation Initialization**, we have established:
- Monorepo structure with clean separation of frontend and backend.
- Node.js + Express backend configured with standard JavaScript ES Modules (`"type": "module"`).
- Centralized configuration loader with `.env.example`.
- Global error handler and 404 middleware.
- Live `/api/health` health-check endpoint.
- React 19 + Vite frontend with dev server proxy to backend.
- Interactive landing page capable of testing the backend health check in real time.
- Standard root `.gitignore` to prevent committing secrets (`.env`), builds, or `node_modules`.

> **Note on Implementation Boundaries:** In accordance with Task 1 instructions, BullMQ, Redis, PostgreSQL models, email sending, and dashboard scheduling forms are deferred to subsequent development phases.

---

## Prerequisites

- **Node.js**: `v18.0.0` or higher (verified with `v24.6.0`)
- **npm**: `v9.0.0` or higher (verified with `v11.5.1`)
- **Redis**: `v6.0.0` or higher (`v7+` recommended). Required for BullMQ job queue persistence.

---

## Getting Started

### 1. Redis Setup (Required for Job Queue)

BullMQ requires a running Redis instance to persist delayed jobs. You can run Redis locally using any of the following methods:

#### Option A: Docker (Recommended for persistence)
```bash
docker run -d --name reachinbox-redis -p 6379:6379 redis:7-alpine redis-server --appendonly yes
```
> **Note on Durability:** Running Redis with `--appendonly yes` enables the Append-Only File (AOF) log, which ensures delayed email jobs are persisted to disk and survive server or container restarts.

#### Option B: Local Service / WSL (Linux or Windows)
- **Ubuntu/Debian / WSL:**
  ```bash
  sudo apt update && sudo apt install redis-server -y
  sudo service redis-server start
  ```
- **Windows (Native):** Run Redis via Windows service or [Redis for Windows port](https://github.com/microsoftarchive/redis/releases).

#### Option C: Cloud Redis
If running without local Docker/Redis, configure a free managed instance (e.g., [Upstash](https://upstash.com) or [Redis Cloud](https://redis.io/cloud/)) and specify `REDIS_HOST`, `REDIS_PORT`, and `REDIS_PASSWORD` in `backend/.env`.

---

### 2. Backend Setup

1. Open a terminal and navigate to the `backend` directory:
   ```bash
   cd backend
   ```

2. Dependencies are already installed. If needed, install via:
   ```bash
   npm install
   ```

3. (Optional) Create a `.env` file from `.env.example`:
   ```bash
   cp .env.example .env
   ```
   *By default, the server runs on port 5000 if no `.env` is supplied.*

4. Start the backend development server:
   ```bash
   npm run dev
   ```
   The backend will start at: `http://localhost:5000`

### Frontend Setup

1. Open a second terminal and navigate to the `frontend` directory:
   ```bash
   cd frontend
   ```

2. Dependencies are already installed. If needed, install via:
   ```bash
   npm install
   ```

3. Start the Vite development server:
   ```bash
   npm run dev
   ```
   The frontend will start at: `http://localhost:5173`

4. Open `http://localhost:5173` in your browser.

---

## Testing the Health-Check Endpoint

### Method 1: Using the Frontend Dashboard
1. Ensure both the backend (`npm run dev` in `/backend`) and frontend (`npm run dev` in `/frontend`) are running.
2. Open `http://localhost:5173`.
3. Click the **"Check Backend Health (/api/health)"** button.
4. The dashboard will display the live JSON response from the backend.

### Method 2: Using cURL or PowerShell
```bash
curl http://localhost:5000/api/health
```

### Method 3: Using a Web Browser
Navigate directly to:
[http://localhost:5000/api/health](http://localhost:5000/api/health)

**Expected JSON Response:**
```json
{
  "status": "ok",
  "message": "ReachInbox Email Scheduler Backend is running",
  "timestamp": "2026-11-24T05:50:00.000Z",
  "uptimeSeconds": 12,
  "environment": "development"
}
```

---

## Architecture & Reliability Highlights

- **Strictly No Cron Jobs:** The scheduler uses BullMQ delayed jobs (`emailQueue.add('sendEmail', data, { delay })`). Delayed jobs are scheduled in Redis sorted sets (`ZSET`) with millisecond precision without recurring database polling stampedes.
- **BullMQ Connection Standard (`maxRetriesPerRequest: null`):** BullMQ requires setting `maxRetriesPerRequest: null` on its Redis connection options. This allows blocking queue commands (such as `BRPOPLPUSH` / `BLMOVE`) to wait for jobs without prematurely throwing retry limit errors.
- **Server Restart Resilience & Redis AOF:** Because job state is maintained in Redis, restarting the Node.js backend server does not lose scheduled jobs. To ensure true durability against Redis server restarts or host crashes, Redis must be configured with Append-Only File persistence (`--appendonly yes`).
- **Decoupled Worker Architecture:** Email dispatching runs in a dedicated worker process, preventing SMTP network delays or rate limits from blocking HTTP API response times.
- **At-Least-Once Delivery Considerations:** Network retries or worker restarts during SMTP dispatch can lead to duplicate sends unless idempotency is enforced. The queue supports custom `jobId` parameters, and upcoming phases will introduce database transaction checks to enforce idempotency.

---

## Development Roadmap

- **Task 1 (Completed):** Environment inspection, project structure initialization, Express health check, React Vite frontend landing page, `.gitignore`, `.env.example`, and documentation.
- **Task 2 (In Progress - Task 2.1 Complete):** BullMQ queue integration and centralized Redis connection setup with graceful shutdown.
- **Task 3:** PostgreSQL integration with schema migrations for email records (`id`, `recipient`, `subject`, `body`, `scheduledAt`, `sentAt`, `status`).
- **Task 4:** Background worker implementation with Nodemailer and Ethereal Email fake SMTP.
- **Task 5:** React Dashboard for composing emails, scheduling time pickers, and viewing real-time queue states.
- **Task 6:** Restart resilience verification, comprehensive error handling, and demo video preparation.

---

## Git & Submission Guidelines

- Branch: `main`
- Remote: `https://github.com/versatile02/reachinbox-email-scheduler.git`
- Reviewers invited: `mitrajit`, `Yadav036`

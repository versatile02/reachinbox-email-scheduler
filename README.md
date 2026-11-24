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
│   │   ├── config/              # Centralized environment & app configuration
│   │   ├── controllers/         # Request handlers (e.g., health.controller.js)
│   │   ├── routes/              # Express API route declarations
│   │   ├── services/            # Business logic (email & scheduler services)
│   │   ├── queues/              # BullMQ queue definitions
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

---

## Getting Started

### Backend Setup

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

- **Strictly No Cron Jobs:** The scheduler will use BullMQ with Redis delayed jobs (`queue.add('sendEmail', data, { delay })`). Delayed jobs are persisted in Redis sorted sets.
- **Server Restart Resilience:** Because job state lives inside Redis and email records reside in PostgreSQL, restarting the backend or worker process does not drop pending jobs.
- **Decoupled Worker Architecture:** Email dispatching runs in a dedicated worker process, preventing SMTP network delays or rate limits from blocking HTTP API response times.

---

## Development Roadmap

- **Task 1 (Completed):** Environment inspection, project structure initialization, Express health check, React Vite frontend landing page, `.gitignore`, `.env.example`, and documentation.
- **Task 2 (Next):** BullMQ queue integration and Redis connection setup for persistent delayed jobs.
- **Task 3:** PostgreSQL integration with schema migrations for email records (`id`, `recipient`, `subject`, `body`, `scheduledAt`, `sentAt`, `status`).
- **Task 4:** Background worker implementation with Nodemailer and Ethereal Email fake SMTP.
- **Task 5:** React Dashboard for composing emails, scheduling time pickers, and viewing real-time queue states.
- **Task 6:** Restart resilience verification, comprehensive error handling, and demo video preparation.

---

## Git & Submission Guidelines

- Branch: `main`
- Remote: `https://github.com/versatile02/reachinbox-email-scheduler.git`
- Reviewers invited: `mitrajit`, `Yadav036`

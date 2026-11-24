import React, { useState } from 'react';
import './App.css';

export default function App() {
  const [healthStatus, setHealthStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const checkBackendHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/health');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setHealthStatus(data);
    } catch (err) {
      console.error('Failed to connect to backend:', err);
      setError(err.message || 'Failed to reach backend server. Ensure backend is running on port 5000.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="badge">Task 1: Foundation Setup Complete</div>
        <h1>ReachInbox Email Scheduler</h1>
        <p className="subtitle">
          Full-Stack Distributed Email Job Scheduling Service & Dashboard
        </p>
      </header>

      <main className="content-grid">
        {/* Foundation Card */}
        <div className="card">
          <h2>Application Foundation</h2>
          <p>
            The project workspace has been successfully initialized using a clean monorepo architecture.
          </p>
          <ul className="feature-list">
            <li>
              <strong>Frontend:</strong> React 19 + Vite (Port 5173) - ES Modules
            </li>
            <li>
              <strong>Backend:</strong> Node.js + Express (Port 5000) - ES Modules
            </li>
            <li>
              <strong>Architecture:</strong> API server + decoupled background worker model
            </li>
            <li>
              <strong>Queue Engine:</strong> BullMQ + Redis (Delayed Jobs, No Cron)
            </li>
          </ul>
        </div>

        {/* Backend Health Check Card */}
        <div className="card">
          <h2>Backend Health Status</h2>
          <p>
            Verify connectivity between the React frontend and the Express backend API.
          </p>

          <button 
            className="btn-primary" 
            onClick={checkBackendHealth} 
            disabled={loading}
          >
            {loading ? 'Checking Health...' : 'Check Backend Health (/api/health)'}
          </button>

          {error && (
            <div className="status-box error-box">
              <strong>Connection Error:</strong>
              <p>{error}</p>
              <small>Tip: Start backend with <code>npm run dev</code> inside <code>/backend</code></small>
            </div>
          )}

          {healthStatus && (
            <div className="status-box success-box">
              <div className="status-title">Backend Status: <strong>{healthStatus.status.toUpperCase()}</strong></div>
              <pre>{JSON.stringify(healthStatus, null, 2)}</pre>
            </div>
          )}
        </div>

        {/* Roadmap Card */}
        <div className="card full-width">
          <h2>Architecture & Implementation Roadmap</h2>
          <div className="roadmap-grid">
            <div className="roadmap-step done">
              <div className="step-num">Phase 1</div>
              <div className="step-title">Foundation & Health Check</div>
              <div className="step-desc">Monorepo setup, Vite React frontend, Express API foundation</div>
            </div>
            <div className="roadmap-step pending">
              <div className="step-num">Phase 2</div>
              <div className="step-title">Redis & BullMQ Setup</div>
              <div className="step-desc">Job scheduling queue with delayed execution (no cron)</div>
            </div>
            <div className="roadmap-step pending">
              <div className="step-num">Phase 3</div>
              <div className="step-title">PostgreSQL Persistence</div>
              <div className="step-desc">Email records, job status tracking, and schema migrations</div>
            </div>
            <div className="roadmap-step pending">
              <div className="step-num">Phase 4</div>
              <div className="step-title">Worker & Ethereal SMTP</div>
              <div className="step-desc">Decoupled worker, Nodemailer + Ethereal email dispatch</div>
            </div>
            <div className="roadmap-step pending">
              <div className="step-num">Phase 5</div>
              <div className="step-title">Dashboard & Scheduling UI</div>
              <div className="step-desc">Compose form, scheduled queue viewer, sent email history</div>
            </div>
          </div>
        </div>
      </main>

      <footer className="app-footer">
        ReachInbox.ai Engineering Assignment &bull; Outbox Labs &bull; Built with Node.js, Express, React, BullMQ & Redis
      </footer>
    </div>
  );
}

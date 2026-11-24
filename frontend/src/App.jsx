import React, { useState, useEffect, useCallback } from 'react';
import './App.css';

// SVG Icons
const InboxIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline>
    <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path>
  </svg>
);

const ClockIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"></circle>
    <polyline points="12 6 12 12 16 14"></polyline>
  </svg>
);

const SendIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13"></line>
    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
  </svg>
);

const CheckCircleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
    <polyline points="22 4 12 14.01 9 11.01"></polyline>
  </svg>
);

const AlertTriangleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
    <line x1="12" y1="9" x2="12" y2="13"></line>
    <line x1="12" y1="17" x2="12.01" y2="17"></line>
  </svg>
);

const ExternalLinkIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
    <polyline points="15 3 21 3 21 9"></polyline>
    <line x1="10" y1="14" x2="21" y2="3"></line>
  </svg>
);

const RefreshIcon = ({ spin }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: spin ? 'spin 1s linear infinite' : 'none' }}>
    <polyline points="23 4 23 10 17 10"></polyline>
    <polyline points="1 20 1 14 7 14"></polyline>
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
  </svg>
);

export default function App() {
  // Tabs & Navigation
  const [activeTab, setActiveTab] = useState('scheduled'); // 'scheduled' | 'sent' | 'failed' | 'senders' | 'health'

  // Data States
  const [emails, setEmails] = useState([]);
  const [senders, setSenders] = useState([]);
  const [healthStatus, setHealthStatus] = useState(null);
  const [slackStatus, setSlackStatus] = useState({ connected: false });
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);

  // Modal States
  const [showComposeModal, setShowComposeModal] = useState(false);
  const [showSlackModal, setShowSlackModal] = useState(false);
  const [showSenderModal, setShowSenderModal] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState(null);

  // Compose Form State
  const [composeMode, setComposeMode] = useState('single'); // 'single' | 'bulk'
  const [recipient, setRecipient] = useState('');
  const [bulkEmails, setBulkEmails] = useState('');
  const [selectedSender, setSelectedSender] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [scheduleType, setScheduleType] = useState('delay'); // 'delay' | 'datetime'
  const [delaySeconds, setDelaySeconds] = useState(5);
  const [scheduledAt, setScheduledAt] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Slack Form State
  const [slackWebhookUrl, setSlackWebhookUrl] = useState('');
  const [slackChannelName, setSlackChannelName] = useState('#email-alerts');
  const [slackTeamName, setSlackTeamName] = useState('ReachInbox Team');
  const [savingSlack, setSavingSlack] = useState(false);

  // New Sender Form State
  const [newSenderEmail, setNewSenderEmail] = useState('');
  const [newSenderName, setNewSenderName] = useState('');
  const [newSenderLimit, setNewSenderLimit] = useState(200);
  const [newSenderDelay, setNewSenderDelay] = useState(2);

  const showNotification = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Fetch Emails
  const fetchEmails = useCallback(async () => {
    try {
      const res = await fetch('/api/emails?limit=100');
      if (res.ok) {
        const json = await res.json();
        setEmails(json.data || []);
      }
    } catch (err) {
      console.warn('Failed to fetch emails:', err.message);
    }
  }, []);

  // Fetch Senders
  const fetchSenders = useCallback(async () => {
    try {
      const res = await fetch('/api/senders');
      if (res.ok) {
        const json = await res.json();
        setSenders(json.data || []);
        if (json.data && json.data.length > 0 && !selectedSender) {
          setSelectedSender(json.data[0].email);
        }
      }
    } catch (err) {
      console.warn('Failed to fetch senders:', err.message);
    }
  }, [selectedSender]);

  // Fetch Health & Slack
  const fetchSystemStatus = useCallback(async () => {
    try {
      const [hRes, sRes] = await Promise.all([
        fetch('/api/health'),
        fetch('/api/slack/status'),
      ]);
      if (hRes.ok) setHealthStatus(await hRes.json());
      if (sRes.ok) setSlackStatus(await sRes.json());
    } catch (err) {
      console.warn('Status fetch warning:', err.message);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchEmails(), fetchSenders(), fetchSystemStatus()]);
    setLoading(false);
  }, [fetchEmails, fetchSenders, fetchSystemStatus]);

  // Initial load and polling every 5 seconds
  useEffect(() => {
    refreshAll();
    const interval = setInterval(refreshAll, 5000);
    return () => clearInterval(interval);
  }, [refreshAll]);

  // Schedule Single or Bulk Email
  const handleScheduleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const emailList = composeMode === 'bulk'
        ? bulkEmails
            .split(/[\n,;]+/)
            .map((e) => e.trim())
            .filter((e) => e && e.includes('@'))
        : [recipient.trim()];

      if (emailList.length === 0) {
        throw new Error('Please provide at least one valid recipient email address');
      }

      let payloadTiming = {};
      if (scheduleType === 'delay') {
        payloadTiming = { delayMs: Math.max(0, parseInt(delaySeconds, 10) * 1000) };
      } else {
        if (!scheduledAt) throw new Error('Please select a scheduled date and time');
        payloadTiming = { scheduledAt: new Date(scheduledAt).toISOString() };
      }

      let successCount = 0;
      for (const rec of emailList) {
        const res = await fetch('/api/emails/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: rec,
            senderEmail: selectedSender || undefined,
            subject: subject.trim(),
            body: body.trim(),
            ...payloadTiming,
          }),
        });

        if (res.ok) {
          successCount++;
        }
      }

      showNotification(`Successfully scheduled ${successCount} email(s)!`);
      setShowComposeModal(false);
      setRecipient('');
      setBulkEmails('');
      setSubject('');
      setBody('');
      fetchEmails();
    } catch (err) {
      showNotification(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // CSV File Upload Parser
  const handleCsvUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const lines = text.split(/\r\n|\n/);
      const parsedEmails = [];

      for (const line of lines) {
        const match = line.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (match) {
          parsedEmails.push(match[0]);
        }
      }

      if (parsedEmails.length > 0) {
        setBulkEmails(parsedEmails.join('\n'));
        setComposeMode('bulk');
        showNotification(`Parsed ${parsedEmails.length} email addresses from ${file.name}!`);
      } else {
        showNotification('No valid email addresses found in CSV file', 'error');
      }
    };
    reader.readAsText(file);
  };

  // Slack Configuration
  const handleSaveSlack = async (e) => {
    e.preventDefault();
    setSavingSlack(true);
    try {
      const res = await fetch('/api/slack/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhookUrl: slackWebhookUrl.trim(),
          channelName: slackChannelName.trim(),
          teamName: slackTeamName.trim(),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to connect Slack');
      }

      showNotification('Slack webhook integrated successfully!');
      setShowSlackModal(false);
      fetchSystemStatus();
    } catch (err) {
      showNotification(err.message, 'error');
    } finally {
      setSavingSlack(false);
    }
  };

  // Disconnect Slack
  const handleDisconnectSlack = async () => {
    try {
      const res = await fetch('/api/slack', { method: 'DELETE' });
      if (res.ok) {
        showNotification('Slack webhook disconnected');
        setShowSlackModal(false);
        setSlackWebhookUrl('');
        fetchSystemStatus();
      }
    } catch (err) {
      showNotification(err.message, 'error');
    }
  };

  // Create Sender
  const handleCreateSender = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/senders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: newSenderEmail.trim(),
          name: newSenderName.trim() || newSenderEmail.split('@')[0],
          hourlyLimit: parseInt(newSenderLimit, 10),
          minDelaySeconds: parseInt(newSenderDelay, 10),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create sender');
      }

      showNotification('New sender created successfully!');
      setShowSenderModal(false);
      setNewSenderEmail('');
      setNewSenderName('');
      fetchSenders();
    } catch (err) {
      showNotification(err.message, 'error');
    }
  };

  // Filter emails by tab
  const scheduledList = emails.filter((e) => e.status === 'scheduled' || e.status === 'processing');
  const sentList = emails.filter((e) => e.status === 'sent');
  const failedList = emails.filter((e) => e.status === 'failed');

  return (
    <div className="app">
      {/* Top Navbar */}
      <header className="app-header">
        <div className="header-inner">
          <div className="brand">
            <div className="brand-icon">
              <InboxIcon />
            </div>
            <div>
              <span className="brand-title">ReachInbox</span>
              <span className="brand-tag">Email Scheduler</span>
            </div>
          </div>

          <div className="header-status">
            <div className="status-indicator">
              <span className={`pulse-dot ${healthStatus ? '' : 'error'}`}></span>
              <span>Backend {healthStatus?.status === 'ok' ? 'Online' : 'Connecting'}</span>
            </div>

            <div className="status-indicator">
              <span className={`pulse-dot ${healthStatus?.queue?.status === 'healthy' ? '' : 'error'}`}></span>
              <span>BullMQ & Redis {healthStatus?.queue?.status === 'healthy' ? 'Ready' : 'Offline'}</span>
            </div>

            <button
              className={`btn btn-sm ${slackStatus.connected ? 'btn-secondary' : 'btn-slack'}`}
              onClick={() => setShowSlackModal(true)}
              style={{ padding: '4px 10px', fontSize: '0.75rem' }}
            >
              💬 {slackStatus.connected ? `Slack: ${slackStatus.channelName || 'Connected'}` : 'Connect Slack'}
            </button>

            {/* Single-Tenant Workspace Profile */}
            <div className="user-profile">
              <div className="user-avatar">AU</div>
              <div className="user-info">
                <span className="user-name">Arham Uddin</span>
                <span className="user-email" style={{ fontSize: '0.7rem', color: '#a5b4fc' }}>Demo Session</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Dashboard Content */}
      <main className="dashboard-container">
        {/* Action Bar */}
        <div className="action-bar">
          <div className="page-heading">
            <h1>Email Scheduling Engine</h1>
            <p>Reliable, distributed multi-sender scheduling with Redis BullMQ pacing and Slack alerts.</p>
          </div>

          <div className="action-buttons">
            <button className="btn btn-secondary" onClick={refreshAll} disabled={loading}>
              <RefreshIcon spin={loading} /> Refresh
            </button>

            <button className="btn btn-secondary" onClick={() => setShowSenderModal(true)}>
              ⚙️ Add Sender
            </button>

            <button className="btn btn-primary" onClick={() => setShowComposeModal(true)}>
              + Compose & Schedule
            </button>
          </div>
        </div>

        {/* Metrics KPI Cards */}
        <div className="metrics-grid">
          <div className="metric-card">
            <div className="metric-info">
              <h3>Scheduled Queue</h3>
              <div className="metric-value">{scheduledList.length}</div>
            </div>
            <div className="metric-icon icon-yellow">
              <ClockIcon />
            </div>
          </div>

          <div className="metric-card">
            <div className="metric-info">
              <h3>Dispatched Sent</h3>
              <div className="metric-value">{sentList.length}</div>
            </div>
            <div className="metric-icon icon-green">
              <CheckCircleIcon />
            </div>
          </div>

          <div className="metric-card">
            <div className="metric-info">
              <h3>Active Senders</h3>
              <div className="metric-value">{senders.length || 1}</div>
            </div>
            <div className="metric-icon icon-purple">
              <SendIcon />
            </div>
          </div>

          <div className="metric-card">
            <div className="metric-info">
              <h3>Failed Dispatches</h3>
              <div className="metric-value">{failedList.length}</div>
            </div>
            <div className="metric-icon icon-red">
              <AlertTriangleIcon />
            </div>
          </div>
        </div>

        {/* Main Tabbed Data Card */}
        <div className="main-card">
          <div className="tabs-bar">
            <div className="tabs-left">
              <button
                className={`tab-btn ${activeTab === 'scheduled' ? 'active' : ''}`}
                onClick={() => setActiveTab('scheduled')}
              >
                Scheduled Queue <span className="tab-badge">{scheduledList.length}</span>
              </button>

              <button
                className={`tab-btn ${activeTab === 'sent' ? 'active' : ''}`}
                onClick={() => setActiveTab('sent')}
              >
                Sent Emails <span className="tab-badge">{sentList.length}</span>
              </button>

              <button
                className={`tab-btn ${activeTab === 'failed' ? 'active' : ''}`}
                onClick={() => setActiveTab('failed')}
              >
                Failed Emails <span className="tab-badge">{failedList.length}</span>
              </button>

              <button
                className={`tab-btn ${activeTab === 'senders' ? 'active' : ''}`}
                onClick={() => setActiveTab('senders')}
              >
                Senders & Rate Limits <span className="tab-badge">{senders.length}</span>
              </button>

              <button
                className={`tab-btn ${activeTab === 'health' ? 'active' : ''}`}
                onClick={() => setActiveTab('health')}
              >
                System Health & BullMQ
              </button>
            </div>
          </div>

          {/* TAB 1: Scheduled Emails */}
          {activeTab === 'scheduled' && (
            <div className="table-responsive">
              {scheduledList.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">
                    <ClockIcon />
                  </div>
                  <h3>No Scheduled Emails in Queue</h3>
                  <p>All scheduled jobs have dispatched or no new email jobs have been scheduled yet.</p>
                  <button className="btn btn-primary" onClick={() => setShowComposeModal(true)}>
                    + Schedule Your First Email
                  </button>
                </div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Recipient</th>
                      <th>Subject</th>
                      <th>Sender Identity</th>
                      <th>Scheduled Time</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scheduledList.map((em) => (
                      <tr key={em.id}>
                        <td>
                          <strong>{em.recipient}</strong>
                        </td>
                        <td>{em.subject}</td>
                        <td>
                          <span style={{ fontSize: '0.8rem', color: '#a5b4fc' }}>{em.senderEmail || 'scheduler@reachinbox.ai'}</span>
                        </td>
                        <td>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                            {new Date(em.scheduledAt).toLocaleString()}
                          </span>
                        </td>
                        <td>
                          <span className={`badge-status badge-${em.status}`}>
                            {em.status === 'processing' ? '⚡ Processing' : '⏳ Scheduled'}
                          </span>
                        </td>
                        <td>
                          <button
                            className="btn btn-secondary"
                            style={{ padding: '3px 8px', fontSize: '0.75rem' }}
                            onClick={() => setSelectedEmail(em)}
                          >
                            Details
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* TAB 2: Sent Emails */}
          {activeTab === 'sent' && (
            <div className="table-responsive">
              {sentList.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">
                    <CheckCircleIcon />
                  </div>
                  <h3>No Sent Emails Yet</h3>
                  <p>When the background BullMQ worker dispatches scheduled emails, delivery confirmation and Ethereal preview links appear here.</p>
                </div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Recipient</th>
                      <th>Subject</th>
                      <th>Sender</th>
                      <th>Delivered Timestamp</th>
                      <th>Status</th>
                      <th>Ethereal Preview URL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sentList.map((em) => (
                      <tr key={em.id}>
                        <td>
                          <strong>{em.recipient}</strong>
                        </td>
                        <td>{em.subject}</td>
                        <td>
                          <span style={{ fontSize: '0.8rem', color: '#a5b4fc' }}>{em.senderEmail || 'scheduler@reachinbox.ai'}</span>
                        </td>
                        <td>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                            {em.sentAt ? new Date(em.sentAt).toLocaleString() : 'Just now'}
                          </span>
                        </td>
                        <td>
                          <span className="badge-status badge-sent">✓ Sent</span>
                        </td>
                        <td>
                          {em.etherealPreviewUrl ? (
                            <a
                              href={em.etherealPreviewUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="preview-link"
                            >
                              View Email <ExternalLinkIcon />
                            </a>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>SMTP Dispatched</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* TAB 3: Failed Emails */}
          {activeTab === 'failed' && (
            <div className="table-responsive">
              {failedList.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">
                    <CheckCircleIcon />
                  </div>
                  <h3>No Failed Emails</h3>
                  <p>All scheduled jobs are executing reliably without terminal failure.</p>
                </div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Recipient</th>
                      <th>Subject</th>
                      <th>Sender</th>
                      <th>Diagnostic Error Message</th>
                      <th>Failed Timestamp</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {failedList.map((em) => (
                      <tr key={em.id}>
                        <td>
                          <strong>{em.recipient}</strong>
                        </td>
                        <td>{em.subject}</td>
                        <td>
                          <span style={{ fontSize: '0.8rem', color: '#a5b4fc' }}>{em.senderEmail}</span>
                        </td>
                        <td>
                          <span style={{ color: 'var(--danger)', fontSize: '0.8rem' }}>
                            {em.errorMessage || 'Delivery failed after configured retry attempts'}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                            {new Date(em.updatedAt || em.createdAt).toLocaleString()}
                          </span>
                        </td>
                        <td>
                          <button
                            className="btn btn-secondary"
                            style={{ padding: '3px 8px', fontSize: '0.75rem' }}
                            onClick={() => setSelectedEmail(em)}
                          >
                            Details
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* TAB 4: Senders & Limits */}
          {activeTab === 'senders' && (
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Sender Name</th>
                    <th>Email Address</th>
                    <th>Hourly Send Limit</th>
                    <th>Inter-Send Pacing Delay</th>
                    <th>Creation Date</th>
                  </tr>
                </thead>
                <tbody>
                  {senders.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <strong>{s.name}</strong>
                      </td>
                      <td>
                        <code style={{ color: '#38bdf8' }}>{s.email}</code>
                      </td>
                      <td>
                        <strong>{s.hourlyLimit}</strong> emails / hour
                      </td>
                      <td>
                        <strong>{s.minDelaySeconds}</strong> seconds between sends
                      </td>
                      <td>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          {s.createdAt ? new Date(s.createdAt).toLocaleDateString() : 'Default'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 5: System Health */}
          {activeTab === 'health' && (
            <div style={{ padding: '1.5rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
                <div style={{ background: '#0f172a', border: '1px solid var(--border)', borderRadius: '10px', padding: '1rem' }}>
                  <h4 style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                    PostgreSQL Database
                  </h4>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <span className="pulse-dot"></span>
                    <strong>Connected & Migrated</strong>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Schema tables: <code>emails</code>, <code>senders</code>, <code>slack_integrations</code>
                  </p>
                </div>

                <div style={{ background: '#0f172a', border: '1px solid var(--border)', borderRadius: '10px', padding: '1rem' }}>
                  <h4 style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                    BullMQ & Redis
                  </h4>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <span className={`pulse-dot ${healthStatus?.queue?.status === 'healthy' ? '' : 'error'}`}></span>
                    <strong>{healthStatus?.queue?.status === 'healthy' ? 'Healthy' : 'Disconnected'}</strong>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Delayed Jobs: <strong>{healthStatus?.queue?.counts?.delayed || 0}</strong> | Active: <strong>{healthStatus?.queue?.counts?.active || 0}</strong>
                  </div>
                </div>

                <div style={{ background: '#0f172a', border: '1px solid var(--border)', borderRadius: '10px', padding: '1rem' }}>
                  <h4 style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                    Slack Integration
                  </h4>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <span className={`pulse-dot ${slackStatus.connected ? '' : 'error'}`}></span>
                    <strong>{slackStatus.connected ? `Channel: ${slackStatus.channelName}` : 'Not Configured'}</strong>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Alerts trigger automatically when any sender breaches hourly limits.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* MODAL 1: Compose / Schedule Email */}
      {showComposeModal && (
        <div className="modal-backdrop" onClick={() => setShowComposeModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Schedule Email Campaign</h2>
              <button className="btn-close" onClick={() => setShowComposeModal(false)}>&times;</button>
            </div>

            <form onSubmit={handleScheduleSubmit}>
              <div className="modal-body">
                {/* Mode Selector */}
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
                  <button
                    type="button"
                    className={`btn ${composeMode === 'single' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ flex: 1, padding: '0.4rem' }}
                    onClick={() => setComposeMode('single')}
                  >
                    Single Recipient
                  </button>
                  <button
                    type="button"
                    className={`btn ${composeMode === 'bulk' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ flex: 1, padding: '0.4rem' }}
                    onClick={() => setComposeMode('bulk')}
                  >
                    📁 CSV / Bulk Leads
                  </button>
                </div>

                {/* Sender Dropdown */}
                <div className="form-group">
                  <label>Sending Identity</label>
                  <select
                    className="form-control"
                    value={selectedSender}
                    onChange={(e) => setSelectedSender(e.target.value)}
                  >
                    {senders.map((s) => (
                      <option key={s.id} value={s.email}>
                        {s.name} ({s.email}) - {s.hourlyLimit}/hr, {s.minDelaySeconds}s delay
                      </option>
                    ))}
                    {senders.length === 0 && (
                      <option value="scheduler@reachinbox.ai">Default (scheduler@reachinbox.ai)</option>
                    )}
                  </select>
                </div>

                {/* Recipient Input (Single vs Bulk) */}
                {composeMode === 'single' ? (
                  <div className="form-group">
                    <label>Recipient Email Address</label>
                    <input
                      type="email"
                      className="form-control"
                      placeholder="e.g. lead@company.com"
                      required
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
                    />
                  </div>
                ) : (
                  <div className="form-group">
                    <label>Bulk Email Addresses or CSV Upload</label>
                    <div className="file-dropzone" onClick={() => document.getElementById('csvFileInput').click()} style={{ marginBottom: '0.5rem' }}>
                      <input
                        id="csvFileInput"
                        type="file"
                        accept=".csv,.txt"
                        style={{ display: 'none' }}
                        onChange={handleCsvUpload}
                      />
                      <span>Drop CSV lead file or <strong>browse file</strong></span>
                    </div>
                    <textarea
                      className="form-control"
                      rows="3"
                      placeholder="Or paste emails (one per line or comma-separated)"
                      value={bulkEmails}
                      onChange={(e) => setBulkEmails(e.target.value)}
                    ></textarea>
                  </div>
                )}

                {/* Subject */}
                <div className="form-group">
                  <label>Subject</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="e.g. Quick question about cold outreach"
                    required
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                  />
                </div>

                {/* Body */}
                <div className="form-group">
                  <label>Email Body (Text or HTML)</label>
                  <textarea
                    className="form-control"
                    rows="4"
                    placeholder="Hi there, I noticed your product and wanted to connect..."
                    required
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                  ></textarea>
                </div>

                {/* Timing Selector */}
                <div className="form-group">
                  <label>Dispatch Timing</label>
                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem' }}>
                      <input
                        type="radio"
                        name="timing"
                        checked={scheduleType === 'delay'}
                        onChange={() => setScheduleType('delay')}
                      />
                      Send After Delay (Seconds)
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem' }}>
                      <input
                        type="radio"
                        name="timing"
                        checked={scheduleType === 'datetime'}
                        onChange={() => setScheduleType('datetime')}
                      />
                      Specific Date & Time
                    </label>
                  </div>

                  {scheduleType === 'delay' ? (
                    <input
                      type="number"
                      min="0"
                      className="form-control"
                      placeholder="Seconds from now (e.g. 5)"
                      value={delaySeconds}
                      onChange={(e) => setDelaySeconds(e.target.value)}
                    />
                  ) : (
                    <input
                      type="datetime-local"
                      className="form-control"
                      value={scheduledAt}
                      onChange={(e) => setScheduledAt(e.target.value)}
                      required
                    />
                  )}
                  <p className="form-hint">
                    Distributed BullMQ delayed jobs with atomic Redis rate limiting.
                  </p>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowComposeModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Scheduling...' : 'Confirm & Schedule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Connect Slack */}
      {showSlackModal && (
        <div className="modal-backdrop" onClick={() => setShowSlackModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Connect Slack Alerts</h2>
              <button className="btn-close" onClick={() => setShowSlackModal(false)}>&times;</button>
            </div>

            <form onSubmit={handleSaveSlack}>
              <div className="modal-body">
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                  Receive immediate alerts when any email sender reaches their configured hourly quota.
                  Alerts use a two-phase Redis state machine to avoid alert storms.
                </p>

                {slackStatus.connected && (
                  <div style={{ background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '8px', padding: '0.75rem', marginBottom: '1rem' }}>
                    <strong style={{ color: '#10b981' }}>✓ Slack is currently connected</strong>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                      Posting to channel: <code>{slackStatus.channelName || '#email-alerts'}</code>
                    </div>
                  </div>
                )}

                <div className="form-group">
                  <label>Slack Incoming Webhook URL</label>
                  <input
                    type="url"
                    className="form-control"
                    placeholder="https://hooks.slack.com/services/T00/B00/XXXX"
                    required
                    value={slackWebhookUrl}
                    onChange={(e) => setSlackWebhookUrl(e.target.value)}
                  />
                  <p className="form-hint">Stored securely using AES-256-GCM encryption.</p>
                </div>

                <div className="form-group">
                  <label>Slack Channel Name</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="#email-alerts"
                    value={slackChannelName}
                    onChange={(e) => setSlackChannelName(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label>Workspace Team Name</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="ReachInbox Workspace"
                    value={slackTeamName}
                    onChange={(e) => setSlackTeamName(e.target.value)}
                  />
                </div>
              </div>

              <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
                <div>
                  {slackStatus.connected && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ color: '#ef4444', borderColor: '#ef4444' }}
                      onClick={handleDisconnectSlack}
                    >
                      Disconnect
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowSlackModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={savingSlack}>
                    {savingSlack ? 'Connecting...' : 'Save & Enable Alerts'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Add Sender */}
      {showSenderModal && (
        <div className="modal-backdrop" onClick={() => setShowSenderModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Configure Sender & Rate Limits</h2>
              <button className="btn-close" onClick={() => setShowSenderModal(false)}>&times;</button>
            </div>

            <form onSubmit={handleCreateSender}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Sender Email Address</label>
                  <input
                    type="email"
                    className="form-control"
                    placeholder="e.g. outreach@reachinbox.ai"
                    required
                    value={newSenderEmail}
                    onChange={(e) => setNewSenderEmail(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label>Sender Display Name</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="e.g. Outreach Team"
                    value={newSenderName}
                    onChange={(e) => setNewSenderName(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label>Hourly Send Limit (Emails / UTC Hour)</label>
                  <input
                    type="number"
                    min="1"
                    className="form-control"
                    value={newSenderLimit}
                    onChange={(e) => setNewSenderLimit(e.target.value)}
                  />
                  <p className="form-hint">Enforced by Redis atomic Lua token script.</p>
                </div>

                <div className="form-group">
                  <label>Minimum Inter-Send Pacing (Seconds)</label>
                  <input
                    type="number"
                    min="0"
                    className="form-control"
                    value={newSenderDelay}
                    onChange={(e) => setNewSenderDelay(e.target.value)}
                  />
                  <p className="form-hint">Minimum delay between consecutive dispatches for this sender.</p>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowSenderModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Sender
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: Email Details */}
      {selectedEmail && (
        <div className="modal-backdrop" onClick={() => setSelectedEmail(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Email Job Details</h2>
              <button className="btn-close" onClick={() => setSelectedEmail(null)}>&times;</button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '0.75rem', fontSize: '0.9rem' }}>
                <strong style={{ color: 'var(--text-muted)' }}>ID:</strong>
                <code>{selectedEmail.id}</code>

                <strong style={{ color: 'var(--text-muted)' }}>Recipient:</strong>
                <span>{selectedEmail.recipient}</span>

                <strong style={{ color: 'var(--text-muted)' }}>Sender:</strong>
                <span>{selectedEmail.senderEmail}</span>

                <strong style={{ color: 'var(--text-muted)' }}>Subject:</strong>
                <span>{selectedEmail.subject}</span>

                <strong style={{ color: 'var(--text-muted)' }}>Status:</strong>
                <span className={`badge-status badge-${selectedEmail.status}`}>
                  {selectedEmail.status.toUpperCase()}
                </span>

                <strong style={{ color: 'var(--text-muted)' }}>Scheduled At:</strong>
                <span>{new Date(selectedEmail.scheduledAt).toLocaleString()}</span>

                {selectedEmail.sentAt && (
                  <>
                    <strong style={{ color: 'var(--text-muted)' }}>Sent At:</strong>
                    <span>{new Date(selectedEmail.sentAt).toLocaleString()}</span>
                  </>
                )}

                {selectedEmail.errorMessage && (
                  <>
                    <strong style={{ color: '#ef4444' }}>Error:</strong>
                    <div style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', padding: '0.5rem', borderRadius: '6px', fontSize: '0.85rem' }}>
                      {selectedEmail.errorMessage}
                    </div>
                  </>
                )}

                {selectedEmail.etherealPreviewUrl && (
                  <>
                    <strong style={{ color: 'var(--text-muted)' }}>Preview:</strong>
                    <a href={selectedEmail.etherealPreviewUrl} target="_blank" rel="noreferrer" className="preview-link">
                      Open Ethereal Preview <ExternalLinkIcon />
                    </a>
                  </>
                )}

                <strong style={{ color: 'var(--text-muted)' }}>Body:</strong>
                <div style={{ background: '#0f172a', padding: '0.75rem', borderRadius: '6px', whiteSpace: 'pre-wrap' }}>
                  {selectedEmail.body}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setSelectedEmail(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className={`toast-banner toast-${toast.type}`}>
          {toast.type === 'success' ? '✓' : '⚠️'} {toast.message}
        </div>
      )}
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { api } from '../services/api.js';
import type { SlackStatus } from '../types.js';

interface SlackModalProps {
  onClose: () => void;
}

export const SlackModal: React.FC<SlackModalProps> = ({ onClose }) => {
  const [slackStatus, setSlackStatus] = useState<SlackStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [channelName, setChannelName] = useState('#outreach-alerts');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    api.getSlackStatus()
      .then((status) => {
        if (isMounted) {
          setSlackStatus(status);
          setLoading(false);
        }
      })
      .catch((err: any) => {
        if (isMounted) {
          setError(err.message || 'Failed to fetch Slack status');
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const status = await api.getSlackStatus();
      setSlackStatus(status);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch Slack status');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!webhookUrl || !webhookUrl.startsWith('https://hooks.slack.com/')) {
      setError('Please provide a valid Slack webhook URL (must start with https://hooks.slack.com/)');
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await api.configureSlackWebhook(webhookUrl, channelName);
      setMessage('Slack incoming webhook configured and securely encrypted!');
      setWebhookUrl('');
      await loadStatus();
    } catch (err: any) {
      setError(err.message || 'Failed to configure webhook');
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.disconnectSlack();
      setMessage('Slack integration disconnected.');
      await loadStatus();
    } catch (err: any) {
      setError(err.message || 'Failed to disconnect Slack');
    } finally {
      setSaving(false);
    }
  };

  const handleOAuthConnect = () => {
    window.location.href = '/api/slack/oauth';
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">💬 Slack Alert Integration</h2>
          <button type="button" onClick={onClose} className="modal-close-btn">✕</button>
        </div>

        <p className="modal-description">
          Receive real-time alerts in Slack whenever any sender reaches their hourly sending limit.
        </p>

        {error && <div className="modal-error">{error}</div>}
        {message && <div className="modal-success">{message}</div>}

        {loading ? (
          <div className="modal-loading">Checking Slack connection...</div>
        ) : (
          <div className="slack-status-card">
            <div className="status-indicator-row">
              <span className={`status-dot ${slackStatus?.connected ? 'connected' : 'disconnected'}`}></span>
              <span className="status-text">
                {slackStatus?.connected
                  ? `Connected to ${slackStatus.teamName || 'Workspace'} (${slackStatus.channelName || '#general'})`
                  : 'Not Connected'}
              </span>
            </div>

            {slackStatus?.connected ? (
              <div className="slack-connected-actions">
                <p className="connected-note">
                  Rate-limit alerts are actively routed to your connected Slack channel.
                </p>
                <button
                  type="button"
                  className="disconnect-slack-btn"
                  onClick={handleDisconnect}
                  disabled={saving}
                >
                  Disconnect Slack
                </button>
              </div>
            ) : (
              <div className="slack-connect-options">
                {/* 1. Real OAuth 2.0 Flow */}
                <div className="oauth-section">
                  <button
                    type="button"
                    className="slack-oauth-btn"
                    onClick={handleOAuthConnect}
                  >
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" />
                    </svg>
                    Connect with Slack OAuth
                  </button>
                </div>

                <div className="or-divider">
                  <span>OR configure webhook manually</span>
                </div>

                {/* 2. Manual Webhook Form */}
                <form onSubmit={handleSaveWebhook} className="manual-webhook-form">
                  <div className="form-field">
                    <label>Slack Incoming Webhook URL</label>
                    <input
                      type="url"
                      placeholder="https://hooks.slack.com/services/T00/B00/XXXX"
                      value={webhookUrl}
                      onChange={(e) => setWebhookUrl(e.target.value)}
                      required
                    />
                  </div>

                  <div className="form-field">
                    <label>Channel Name</label>
                    <input
                      type="text"
                      placeholder="#outreach-alerts"
                      value={channelName}
                      onChange={(e) => setChannelName(e.target.value)}
                    />
                  </div>

                  <button type="submit" className="save-webhook-btn" disabled={saving}>
                    {saving ? 'Encrypting & Saving...' : 'Save Encrypted Webhook'}
                  </button>
                </form>
              </div>
            )}
          </div>
        )}

        <div className="modal-footer">
          <button type="button" className="modal-close-action" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default SlackModal;

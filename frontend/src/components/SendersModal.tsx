import React, { useState } from 'react';
import { api } from '../services/api.js';
import type { Sender } from '../types.js';

interface SendersModalProps {
  senders: Sender[];
  onClose: () => void;
  onRefresh: () => void;
}

export const SendersModal: React.FC<SendersModalProps> = ({ senders, onClose, onRefresh }) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [hourlyLimit, setHourlyLimit] = useState(200);
  const [minDelaySeconds, setMinDelaySeconds] = useState(2);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !name) {
      setError('Email and name are required');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await api.createSender({
        email: email.trim().toLowerCase(),
        name: name.trim(),
        hourlyLimit,
        minDelaySeconds,
      });
      setShowAddForm(false);
      setEmail('');
      setName('');
      onRefresh();
    } catch (err: any) {
      setError(err.message || 'Failed to add sender');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">⚙️ Senders & Rate Limiting</h2>
          <button type="button" onClick={onClose} className="modal-close-btn">✕</button>
        </div>

        <p className="modal-description">
          Configure multi-sender accounts with distinct hourly quotas and pacing delays to protect domain reputation.
        </p>

        {error && <div className="modal-error">{error}</div>}

        {!showAddForm ? (
          <>
            <div className="senders-table-wrapper">
              <table className="senders-table">
                <thead>
                  <tr>
                    <th>Sender Email</th>
                    <th>Name</th>
                    <th>Hourly Limit</th>
                    <th>Pacing (Min Delay)</th>
                  </tr>
                </thead>
                <tbody>
                  {senders.map((s) => (
                    <tr key={s.id}>
                      <td className="sender-email-cell">
                        <strong>{s.email}</strong>
                      </td>
                      <td>{s.name}</td>
                      <td>
                        <span className="quota-tag">{s.hourlyLimit} emails/hr</span>
                      </td>
                      <td>
                        <span className="pacing-tag">{s.minDelaySeconds}s delay</span>
                      </td>
                    </tr>
                  ))}
                  {senders.length === 0 && (
                    <tr>
                      <td colSpan={4} className="no-senders-cell">
                        No custom senders configured. Using default system scheduler.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="modal-actions-bar">
              <button
                type="button"
                className="add-sender-btn"
                onClick={() => setShowAddForm(true)}
              >
                + Add New Sender
              </button>
              <button type="button" className="modal-done-btn" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={handleCreate} className="add-sender-form">
            <div className="form-field">
              <label>Sender Email Address</label>
              <input
                type="email"
                placeholder="sales@domain.io"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="form-field">
              <label>Sender Display Name</label>
              <input
                type="text"
                placeholder="Oliver Brown"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="form-row-2">
              <div className="form-field">
                <label>Hourly Rate Limit</label>
                <input
                  type="number"
                  min="1"
                  max="10000"
                  value={hourlyLimit}
                  onChange={(e) => setHourlyLimit(parseInt(e.target.value, 10) || 200)}
                />
              </div>

              <div className="form-field">
                <label>Minimum Pacing Delay (seconds)</label>
                <input
                  type="number"
                  min="0"
                  max="3600"
                  value={minDelaySeconds}
                  onChange={(e) => setMinDelaySeconds(parseInt(e.target.value, 10) || 2)}
                />
              </div>
            </div>

            <div className="form-actions">
              <button
                type="button"
                className="cancel-btn"
                onClick={() => setShowAddForm(false)}
                disabled={saving}
              >
                Cancel
              </button>
              <button type="submit" className="save-btn" disabled={saving}>
                {saving ? 'Saving...' : 'Save Sender'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default SendersModal;

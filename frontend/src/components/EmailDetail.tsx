import React from 'react';
import type { Email } from '../types.js';

interface EmailDetailProps {
  email: Email;
  onBack: () => void;
  onDeleteEmail?: (emailId: string) => void;
}

export const EmailDetail: React.FC<EmailDetailProps> = ({ email, onBack, onDeleteEmail }) => {
  // Format formatted date matching Figma: "Nov 3, 10:23 AM"
  const formatDate = (dateStr: string): string => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return dateStr;
    }
  };

  const senderInitial = email.senderEmail ? email.senderEmail.charAt(0).toUpperCase() : 'O';

  const [copied, setCopied] = React.useState(false);
  const [isStarred, setIsStarred] = React.useState(email.starred || false);

  const handleCopyId = () => {
    navigator.clipboard?.writeText(email.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isTennisDemoEmail =
    email.body?.toLowerCase().includes('exclusive') ||
    email.body?.toLowerCase().includes('fly out fix') ||
    email.subject?.toLowerCase().includes('mjwyt44');

  return (
    <div className="email-detail-container">
      {/* Top action bar matching Figma "← Subject | Code" */}
      <div className="detail-top-bar">
        <div className="detail-top-left">
          <button type="button" onClick={onBack} className="detail-back-btn" title="Back to list">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </button>
          <h2 className="detail-subject-title">
            {email.subject} <span className="detail-code-separator">|</span> <span className="detail-code">ID#{email.id.substring(0, 8).toUpperCase()}</span>
          </h2>
        </div>

        <div className="detail-top-actions">
          <button
            type="button"
            className="detail-icon-btn"
            title={isStarred ? 'Starred' : 'Star'}
            onClick={() => setIsStarred(!isStarred)}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill={isStarred ? '#f59e0b' : 'none'} stroke={isStarred ? '#f59e0b' : 'currentColor'} strokeWidth="1.5">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </button>
          <button
            type="button"
            className="detail-icon-btn"
            title={copied ? 'Copied ID!' : 'Copy Email ID'}
            onClick={handleCopyId}
          >
            {copied ? (
              <span className="copied-tag">✓</span>
            ) : (
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
          {onDeleteEmail && (
            <button
              type="button"
              className="detail-icon-btn detail-delete-btn"
              title="Delete Email"
              onClick={() => {
                if (window.confirm('Are you sure you want to delete this email?')) {
                  onDeleteEmail(email.id);
                  onBack();
                }
              }}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#ef4444" strokeWidth="1.5">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Email Sender Header matching Figma */}
      <div className="detail-header-card">
        <div className="detail-sender-avatar">{senderInitial}</div>
        <div className="detail-sender-info">
          <div className="detail-sender-row">
            <span className="detail-sender-name">
              {email.senderEmail.split('@')[0]} &lt;{email.senderEmail}&gt;
            </span>
            <span className="detail-date">{formatDate(email.sentAt || email.scheduledAt || email.createdAt)}</span>
          </div>
          <div className="detail-to-me">
            to {email.recipient}
          </div>
        </div>
      </div>

      {/* Email Body Area */}
      <div className="detail-body-area">
        {/* Render highlight callout banner if demo email matching Figma */}
        {isTennisDemoEmail && (
          <div className="detail-callout-banner">
            <div className="callout-line">
              ⚡ <strong>Extremely Exclusive—Only 4 Spots Worldwide Per Year | $25,000 investment</strong> ⚡
            </div>
            <div className="callout-subline">
              ⚡ To explore securing your private transformation, simply reply right now with "FLY OUT FIX".
            </div>
          </div>
        )}

        {/* Main email content */}
        <div className="detail-text-content">
          <div dangerouslySetInnerHTML={{ __html: email.body.replace(/\n/g, '<br/>') }} />
        </div>

        {/* Attachment Thumbnail Cards matching Figma */}
        {/* Dynamic Attachments Section */}
        {email.attachments && email.attachments.length > 0 && (
          <div className="detail-attachments-section">
            <div className="attachments-title">Attachments ({email.attachments.length})</div>
            <div className="attachments-grid">
              {email.attachments.map((att) => (
                <a
                  key={att.id}
                  href={`/api/emails/${email.id}/attachments/${att.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="attachment-card attachment-card-link"
                  title="Click to download attachment"
                >
                  <div className="attachment-thumb">
                    {att.mimetype?.startsWith('image/') ? (
                      <img
                        src={`/api/emails/${email.id}/attachments/${att.id}`}
                        alt={att.filename}
                        className="attachment-img"
                      />
                    ) : (
                      <div className="attachment-generic-icon">📎</div>
                    )}
                  </div>
                  <div className="attachment-info">
                    <span className="attachment-name">{att.filename}</span>
                    <span className="attachment-size">
                      {att.size
                        ? att.size > 1024 * 1024
                          ? `${(att.size / (1024 * 1024)).toFixed(1)} MB`
                          : `${(att.size / 1024).toFixed(0)} KB`
                        : ''}
                    </span>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Delivery Status & Transport Verification Banner */}
        <div className="detail-preview-banner">
          <div className="delivery-status-header">
            <span className={`status-badge-pill status-${email.status}`}>
              {email.status === 'sent' && '✓ SMTP Server Accepted (250 OK)'}
              {email.status === 'scheduled' && '⏳ Scheduled in Queue'}
              {email.status === 'processing' && '🔄 In Flight (Processing)'}
              {email.status === 'failed' && '❌ Delivery Failed'}
            </span>
          </div>

          {email.status === 'sent' && (
            <div className="delivery-details-box">
              <div className="preview-label">
                <span className="preview-label-title">🧪 <strong>Ethereal Sandbox Delivery</strong></span>
                <p className="preview-subtext">Captured in developer test webmail. Not delivered to external inbox.</p>
              </div>
              <a
                href={
                  email.etherealPreviewUrl && (email.etherealPreviewUrl.startsWith('http://') || email.etherealPreviewUrl.startsWith('https://'))
                    ? email.etherealPreviewUrl
                    : `/api/emails/${email.id}/preview`
                }
                target="_blank"
                rel="noopener noreferrer"
                className="preview-link-btn"
              >
                View in Ethereal Webmail ↗
              </a>
            </div>
          )}

          {email.status === 'scheduled' && (
            <div className="delivery-details-box">
              <div className="preview-label">
                <span className="preview-label-title">🕒 <strong>Awaiting Scheduled Dispatch</strong></span>
                <p className="preview-subtext">Persistent in PostgreSQL and enqueued in BullMQ Redis queue.</p>
              </div>
            </div>
          )}

          {email.status === 'processing' && (
            <div className="delivery-details-box">
              <div className="preview-label">
                <span className="preview-label-title">⚙️ <strong>Worker Active</strong></span>
                <p className="preview-subtext">Job lease acquired with active heartbeat; communicating with SMTP gateway.</p>
              </div>
            </div>
          )}

          {email.status === 'failed' && (
            <div className="delivery-details-box">
              <div className="preview-label">
                <span className="preview-label-title">⚠️ <strong>Error Reason</strong></span>
                <p className="preview-subtext">{email.errorMessage || 'Transmission failed after retries exhausted.'}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EmailDetail;

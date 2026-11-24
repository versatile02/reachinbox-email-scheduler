 import React from 'react';
import type { Email } from '../types.js';

interface EmailListProps {
  emails: Email[];
  activeTab: 'scheduled' | 'sent';
  loading: boolean;
  scheduledCount?: number;
  sentCount?: number;
  sendersCount?: number;
  onSelectEmail: (email: Email) => void;
  onToggleStar: (emailId: string) => void;
  onComposeClick: () => void;
  onTabChange?: (tab: 'scheduled' | 'sent') => void;
  onOpenSenders?: () => void;
}

export const EmailList: React.FC<EmailListProps> = ({
  emails,
  activeTab,
  loading,
  scheduledCount = 0,
  sentCount = 0,
  sendersCount = 0,
  onSelectEmail,
  onToggleStar,
  onComposeClick,
  onTabChange: _onTabChange,
  onOpenSenders,
}) => {
  // Format timestamp for scheduled badge: "Tue 9:15:12 AM" matching Figma
  const formatScheduledBadge = (dateStr: string): string => {
    try {
      const d = new Date(dateStr);
      if (Number.isNaN(d.getTime())) return dateStr;

      const day = d.toLocaleDateString('en-US', { weekday: 'short' });
      const time = d.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });
      return `${day} ${time}`;
    } catch {
      return dateStr;
    }
  };

  const getCleanSnippet = (body: string): string => {
    if (!body) return '';
    return body.replace(/<[^>]*>?/gm, '').substring(0, 100);
  };

  return (
    <div className="email-list-wrapper">
      {/* Clean View Header with Status Overview */}
      <div className="view-header-strip">
        <div className="view-header-left">
          <h2 className="view-title">
            {activeTab === 'scheduled' ? 'Scheduled Outreach' : 'Sent Emails'}
          </h2>
          <span className="view-subtitle">
            {activeTab === 'scheduled'
              ? `${scheduledCount} email${scheduledCount === 1 ? '' : 's'} queued for automated delivery`
              : `${sentCount} email${sentCount === 1 ? '' : 's'} successfully dispatched`}
          </span>
        </div>

        <div className="view-header-right">
          <div className="overview-stat-pill">
            <span className="stat-pill-dot orange"></span>
            <span className="stat-pill-label">Scheduled:</span>
            <strong className="stat-pill-val">{scheduledCount}</strong>
          </div>
          <div className="overview-stat-pill">
            <span className="stat-pill-dot green"></span>
            <span className="stat-pill-label">Sent:</span>
            <strong className="stat-pill-val">{sentCount}</strong>
          </div>
          <div className="overview-stat-pill" onClick={onOpenSenders} role="button" tabIndex={0} title="Manage Senders">
            <span className="stat-pill-dot purple"></span>
            <span className="stat-pill-label">Senders:</span>
            <strong className="stat-pill-val">{sendersCount}</strong>
          </div>
        </div>
      </div>

      {loading && emails.length === 0 ? (
        <div className="email-list-loading">
          <div className="loading-spinner"></div>
          <span>Loading outbox...</span>
        </div>
      ) : emails.length === 0 ? (
        <div className="email-list-empty">
          <div className="empty-icon">
            {activeTab === 'scheduled' ? (
              <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            )}
          </div>
          <h3 className="empty-title">
            No {activeTab === 'scheduled' ? 'scheduled' : 'sent'} emails found
          </h3>
          <p className="empty-subtitle">
            {activeTab === 'scheduled'
              ? 'Schedule your first cold outreach sequence or single email.'
              : 'Emails will appear here once delivered by the BullMQ worker.'}
          </p>
          {activeTab === 'scheduled' && (
            <button type="button" onClick={onComposeClick} className="empty-compose-btn">
              + Compose New Email
            </button>
          )}
        </div>
      ) : (
        <div className="email-list-container">
          {emails.map((email) => {
            const hasAttachments = Boolean(email.attachments && email.attachments.length > 0);

        return (
          <div
            key={email.id}
            className="email-row-card"
            onClick={() => onSelectEmail(email)}
          >
            {/* Recipient matching Figma "To: John Smith" */}
            <div className="email-row-recipient">
              To: {email.recipient.split('@')[0]}
            </div>

            {/* Status / Scheduled Badge matching Figma & supported states */}
            <div className="email-row-badge-wrapper">
              {email.status === 'scheduled' ? (
                <span className="badge-scheduled">
                  🕒 {formatScheduledBadge(email.scheduledAt)}
                </span>
              ) : email.status === 'processing' ? (
                <span className="badge-processing">🔄 In Flight</span>
              ) : email.status === 'failed' ? (
                <span className="badge-failed">Failed</span>
              ) : (
                <span className="badge-sent">Sent</span>
              )}
            </div>

            {/* Subject, attachment icon, and preview snippet */}
            <div className="email-row-content">
              {hasAttachments && (
                <span className="email-row-att-icon" title={`${email.attachments?.length} attachment(s)`}>
                  📎
                </span>
              )}
              <span className="email-row-subject">{email.subject}</span>
              <span className="email-row-snippet"> - {getCleanSnippet(email.body)}</span>
            </div>

            {/* Star icon matching Figma on far right */}
            <button
              type="button"
              className={`email-row-star ${email.starred ? 'starred' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggleStar(email.id);
              }}
              title={email.starred ? 'Unstar' : 'Star'}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill={email.starred ? '#f59e0b' : 'none'} stroke={email.starred ? '#f59e0b' : '#94a3b8'} strokeWidth="1.5">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </button>
          </div>
        );
      })}
        </div>
      )}
    </div>
  );
};

export default EmailList;

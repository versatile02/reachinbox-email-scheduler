import React from 'react';
import type { User } from '../types.js';

interface SidebarProps {
  user?: User | null;
  activeTab: 'scheduled' | 'sent';
  scheduledCount: number;
  sentCount: number;
  onTabChange: (tab: 'scheduled' | 'sent') => void;
  onOpenCompose: () => void;
  onOpenSenders: () => void;
  onOpenSlack: () => void;
  onLogout?: () => void;
  onClose?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  scheduledCount,
  sentCount,
  onTabChange,
  onOpenCompose,
  onOpenSenders,
  onOpenSlack,
  onClose,
}) => {
  return (
    <aside className="app-sidebar">
      {/* Mobile Drawer Close Header */}
      <div className="sidebar-mobile-header">
        <span className="sidebar-mobile-title">Navigation</span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="sidebar-mobile-close-btn"
            aria-label="Close navigation"
          >
            ✕
          </button>
        )}
      </div>

      {/* Primary Action Button: + Compose */}
      <div className="sidebar-action-header">
        <button type="button" onClick={onOpenCompose} className="sidebar-compose-btn">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>Compose</span>
        </button>
      </div>

      {/* CORE Section matching Figma */}
      <div className="sidebar-section">
        <div className="sidebar-section-title">CORE</div>
        <nav className="sidebar-nav">
          {/* Scheduled Nav Item */}
          <button
            type="button"
            className={`sidebar-nav-item ${activeTab === 'scheduled' ? 'active' : ''}`}
            onClick={() => onTabChange('scheduled')}
          >
            <div className="nav-item-left">
              <svg className="nav-svg-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span className="nav-label">Scheduled</span>
            </div>
            <span className="nav-badge">{scheduledCount}</span>
          </button>

          {/* Sent Nav Item */}
          <button
            type="button"
            className={`sidebar-nav-item ${activeTab === 'sent' ? 'active' : ''}`}
            onClick={() => onTabChange('sent')}
          >
            <div className="nav-item-left">
              <svg className="nav-svg-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
              <span className="nav-label">Sent</span>
            </div>
            <span className="nav-badge">{sentCount}</span>
          </button>
        </nav>
      </div>

      {/* Management Navigation Section */}
      <div className="sidebar-section">
        <div className="sidebar-section-title">SETTINGS & QUEUE</div>
        <nav className="sidebar-nav">
          <button type="button" className="sidebar-nav-item" onClick={onOpenSenders}>
            <div className="nav-item-left">
              <svg className="nav-svg-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              <span className="nav-label">Senders</span>
            </div>
          </button>

          <button type="button" className="sidebar-nav-item" onClick={onOpenSlack}>
            <div className="nav-item-left">
              <svg className="nav-svg-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span className="nav-label">Slack Integration</span>
            </div>
          </button>

          <a
            href="/admin/queues"
            target="_blank"
            rel="noopener noreferrer"
            className="sidebar-nav-item link-item"
          >
            <div className="nav-item-left">
              <svg className="nav-svg-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="9" />
                <rect x="14" y="3" width="7" height="5" />
                <rect x="14" y="12" width="7" height="9" />
                <rect x="3" y="16" width="7" height="5" />
              </svg>
              <span className="nav-label">Queue Board</span>
            </div>
            <span className="nav-external-arrow">↗</span>
          </a>
        </nav>
      </div>
    </aside>
  );
};

export default Sidebar;

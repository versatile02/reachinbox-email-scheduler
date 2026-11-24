import React, { useState, useRef, useEffect } from 'react';
import type { User, Sender } from '../types.js';

interface HeaderProps {
  user: User | null;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onRefresh: () => void;
  onLogout: () => void;
  onOpenSenders: () => void;
  onOpenSlack: () => void;
  senders?: Sender[];
  selectedSenderFilter?: string;
  onSelectSenderFilter?: (senderEmail: string) => void;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  user,
  searchQuery,
  onSearchChange,
  onRefresh,
  onLogout,
  onOpenSenders: _onOpenSenders,
  onOpenSlack: _onOpenSlack,
  senders = [],
  selectedSenderFilter = '',
  onSelectSenderFilter,
  isSidebarOpen = true,
  onToggleSidebar,
}) => {
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click or Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserDropdown(false);
      }
      if (filterMenuRef.current && !filterMenuRef.current.contains(e.target as Node)) {
        setShowFilterDropdown(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowUserDropdown(false);
        setShowFilterDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const hasActiveFilters = Boolean(searchQuery.trim() || selectedSenderFilter);

  return (
    <header className="app-header">
      {/* Brand logo with 3-lines sidebar toggle and ReachInbox lightning icon */}
      <div className="header-left">
        {onToggleSidebar && (
          <button
            type="button"
            className="sidebar-toggle-btn"
            onClick={onToggleSidebar}
            title={isSidebarOpen ? 'Hide sidebar (collapse)' : 'Show sidebar (expand)'}
            aria-label="Toggle sidebar"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6" strokeLinecap="round" />
              <line x1="3" y1="12" x2="21" y2="12" strokeLinecap="round" />
              <line x1="3" y1="18" x2="21" y2="18" strokeLinecap="round" />
            </svg>
          </button>
        )}
        <div className="header-brand-wrap">
          <svg className="reachinbox-brand-icon" viewBox="0 0 32 32" width="22" height="22" fill="none">
            <path d="M25.3789 0C29.0354 0 32 2.96459 32 6.62109V25.3789C32 29.0354 29.0354 32 25.3789 32H6.62109C2.96459 32 0 29.0354 0 25.3789V6.62109C0 2.96459 2.96459 0 6.62109 0H25.3789ZM9.8584 9.79688C9.34642 9.32887 8.6373 9.26874 8.08203 9.54395C7.52257 9.82124 7.17285 10.4001 7.17285 11.0293V21.7334C7.17285 22.6334 7.88612 23.3631 8.7666 23.3633C9.64721 23.3633 10.3613 22.6335 10.3613 21.7334V14.9473C10.6271 15.2322 10.8875 15.513 11.1484 15.7949C12.182 16.9113 13.231 18.0459 14.6787 19.4844L14.7109 19.5156C15.4031 20.1697 16.49 20.1631 17.1699 19.4541L21.4639 14.9756V21.7334C21.4639 22.6335 22.178 23.3633 23.0586 23.3633C23.939 23.3631 24.6523 22.6334 24.6523 21.7334V11.0303C24.6522 10.4167 24.317 9.83423 23.7529 9.5498C23.18 9.26098 22.4491 9.33468 21.9375 9.82617L21.8887 9.875L15.8926 16.1289C14.9844 15.197 14.2313 14.3825 13.4648 13.5547C12.4946 12.5067 11.504 11.438 10.1768 10.1123L9.90723 9.84375L9.8584 9.79688Z" fill="#111827"/>
          </svg>
          <span className="logo-onb">ReachInbox</span>
          <span className="logo-badge-outbox">Outbox Labs</span>
        </div>
      </div>

      {/* Centered Search Bar with Filter and Refresh icons matching Figma */}
      <div className="header-center">
        <div className="search-bar-container">
          <svg className="search-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search by recipient, sender, subject, or body..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="search-input"
          />
          <div className="search-actions">
            {/* Filter icon & dropdown */}
            <div className="header-filter-wrapper" ref={filterMenuRef}>
              <button
                type="button"
                className={`search-action-btn ${hasActiveFilters || showFilterDropdown ? 'active' : ''}`}
                title="Filter emails"
                onClick={() => setShowFilterDropdown(!showFilterDropdown)}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                </svg>
                {hasActiveFilters && <span className="filter-active-dot"></span>}
              </button>

              {showFilterDropdown && (
                <div className="filter-popover-menu">
                  <div className="filter-popover-title">Filter Outbox</div>

                  <div className="filter-popover-group">
                    <label className="filter-group-label">Filter by Sender</label>
                    <select
                      className="filter-select-input"
                      value={selectedSenderFilter}
                      onChange={(e) => {
                        onSelectSenderFilter?.(e.target.value);
                      }}
                    >
                      <option value="">All Senders</option>
                      {senders.map((s) => (
                        <option key={s.id} value={s.email}>
                          {s.name} ({s.email})
                        </option>
                      ))}
                    </select>
                  </div>

                  {hasActiveFilters && (
                    <div className="filter-popover-actions">
                      <button
                        type="button"
                        className="filter-reset-btn"
                        onClick={() => {
                          onSearchChange('');
                          onSelectSenderFilter?.('');
                          setShowFilterDropdown(false);
                        }}
                      >
                        Reset All Filters
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Refresh icon matching Figma */}
            <button
              type="button"
              className="search-action-btn"
              title="Refresh list (Auto-refreshes every 10s)"
              onClick={onRefresh}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Header Right Actions */}
      <div className="header-right">
        <a
          href="/admin/queues"
          target="_blank"
          rel="noopener noreferrer"
          className="queue-dashboard-pill"
          title="Open Bull Board Live Queue Dashboard in a new tab"
        >
          <span className="live-dot"></span>
          Bull Board
        </a>

        {user && (
          <div className="user-menu-wrapper" ref={userMenuRef}>
            <div
              className="header-user-badge"
              onClick={() => setShowUserDropdown(!showUserDropdown)}
              title="Account options"
              role="button"
              tabIndex={0}
            >
              <div className="header-avatar-container">
                <img
                  src={
                    user.avatarUrl ||
                    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop&crop=face'
                  }
                  alt={user.name}
                  className="header-avatar-img"
                />
              </div>
              <span className="header-user-display-name">{user.name}</span>
              <svg className="header-chevron-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>

            <button
              type="button"
              className="header-logout-action-btn"
              onClick={onLogout}
              title="Logout from ReachInbox"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span>Logout</span>
            </button>

            {showUserDropdown && (
              <div className="user-dropdown-menu">
                <div className="dropdown-user-info">
                  <div className="dropdown-user-name">{user.name}</div>
                  <div className="dropdown-user-email">{user.email}</div>
                </div>
                <div className="dropdown-divider"></div>
                <button
                  type="button"
                  className="dropdown-item logout-item"
                  onClick={() => {
                    setShowUserDropdown(false);
                    onLogout();
                  }}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  <span>Log Out</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;

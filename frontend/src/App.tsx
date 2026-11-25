import React, { useState, useEffect, useCallback } from 'react';
import { api } from './services/api.js';
import type { User, Email, Sender } from './types.js';
import { Header } from './components/Header.js';
import { Sidebar } from './components/Sidebar.js';
import { EmailList } from './components/EmailList.js';
import { EmailDetail } from './components/EmailDetail.js';
import { ComposeView } from './components/ComposeView.js';
import { LoginView } from './components/LoginView.js';
import { SendersModal } from './components/SendersModal.js';
import { SlackModal } from './components/SlackModal.js';
import './App.css';

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Navigation and view state (default collapsed on mobile screens <= 768px)
  const [isSidebarOpen, setIsSidebarOpen] = useState(
    () => typeof window !== 'undefined' && window.innerWidth > 768
  );

  const closeSidebarOnMobile = () => {
    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
      setIsSidebarOpen(false);
    }
  };
  const [activeTab, setActiveTab] = useState<'scheduled' | 'sent'>('scheduled');
  const [currentView, setCurrentView] = useState<'list' | 'detail' | 'compose'>('list');
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);

  // Modals state
  const [showSendersModal, setShowSendersModal] = useState(false);
  const [showSlackModal, setShowSlackModal] = useState(
    () =>
      typeof window !== 'undefined' &&
      (new URLSearchParams(window.location.search).get('slack_connected') === 'true' ||
        new URLSearchParams(window.location.search).has('slack_error'))
  );

  // Data state
  const [emails, setEmails] = useState<Email[]>([]);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSenderFilter, setSelectedSenderFilter] = useState('');

  // Counts for sidebar badges
  const [scheduledCount, setScheduledCount] = useState(0);
  const [sentCount, setSentCount] = useState(0);

  // 1. Check user session and query parameters on initial load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('slack_connected') || params.has('slack_error') || params.has('auth_error')) {
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);
    }

    const initAuth = async () => {
      try {
        const user = await api.getCurrentUser();
        setCurrentUser(user);
      } catch {
        setCurrentUser(null);
      } finally {
        setAuthChecked(true);
      }
    };
    initAuth();
  }, []);

  // 2. Fetch senders
  const loadSenders = useCallback(async () => {
    try {
      const data = await api.listSenders();
      setSenders(data);
    } catch {
      // Ignore background error
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    if (currentUser) {
      api.listSenders().then((data) => {
        if (isMounted) setSenders(data);
      }).catch(() => {});
    }
    return () => {
      isMounted = false;
    };
  }, [currentUser]);

  // 3. Fetch emails for active tab or search query
  const loadEmails = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);

    try {
      if (searchQuery.trim()) {
        const result = await api.searchEmails(searchQuery.trim(), activeTab);
        let filtered = result.data;
        if (selectedSenderFilter) {
          filtered = filtered.filter(
            (e) => e.senderEmail.toLowerCase() === selectedSenderFilter.toLowerCase()
          );
        }
        setEmails(filtered);
      } else {
        const result = await api.listEmails({
          status: activeTab,
          senderEmail: selectedSenderFilter || undefined,
          limit: 100,
        });
        setEmails(result.data);
      }

      // Refresh both counts in background
      api.listEmails({ status: 'scheduled', limit: 1 }).then((r) => setScheduledCount(r.pagination.total));
      api.listEmails({ status: 'sent', limit: 1 }).then((r) => setSentCount(r.pagination.total));
    } catch (err: any) {
      console.error('Failed to load emails:', err.message);
    } finally {
      setLoading(false);
    }
  }, [currentUser, activeTab, searchQuery, selectedSenderFilter]);

  // Initial fetch when tab, search, or sender filter changes
  useEffect(() => {
    let isMounted = true;
    if (!currentUser) return;

    const run = async () => {
      try {
        if (searchQuery.trim()) {
          const result = await api.searchEmails(searchQuery.trim(), activeTab);
          let filtered = result.data;
          if (selectedSenderFilter) {
            filtered = filtered.filter(
              (e) => e.senderEmail.toLowerCase() === selectedSenderFilter.toLowerCase()
            );
          }
          if (isMounted) setEmails(filtered);
        } else {
          const result = await api.listEmails({
            status: activeTab,
            senderEmail: selectedSenderFilter || undefined,
            limit: 100,
          });
          if (isMounted) setEmails(result.data);
        }
        api.listEmails({ status: 'scheduled', limit: 1 }).then((r) => isMounted && setScheduledCount(r.pagination.total));
        api.listEmails({ status: 'sent', limit: 1 }).then((r) => isMounted && setSentCount(r.pagination.total));
      } catch (err: any) {
        console.error('Failed to load emails:', err.message);
      }
    };

    run();
    return () => {
      isMounted = false;
    };
  }, [currentUser, activeTab, searchQuery, selectedSenderFilter]);

  // 4. Mandatory 10-Second Auto-Refresh Interval
  useEffect(() => {
    if (!currentUser || currentView !== 'list') return;

    const intervalTimer = setInterval(() => {
      loadEmails();
    }, 10000); // 10 seconds auto-refresh interval

    return () => clearInterval(intervalTimer);
  }, [currentUser, currentView, loadEmails]);

  // Logout handler
  const handleLogout = async () => {
    await api.logout();
    setCurrentUser(null);
    setCurrentView('list');
    setSelectedEmail(null);
  };

  // Toggle star handler
  const handleToggleStar = (emailId: string) => {
    setEmails((prev) =>
      prev.map((e) => (e.id === emailId ? { ...e, starred: !e.starred } : e))
    );
  };

  // Delete / cancel email handler
  const handleDeleteEmail = async (emailId: string) => {
    try {
      await api.deleteEmail(emailId);
      setEmails((prev) => prev.filter((e) => e.id !== emailId));
      if (activeTab === 'scheduled') {
        setScheduledCount((c) => Math.max(0, c - 1));
      } else {
        setSentCount((c) => Math.max(0, c - 1));
      }
      if (selectedEmail?.id === emailId) {
        setSelectedEmail(null);
        setCurrentView('list');
      }
    } catch (err: any) {
      console.error('Failed to delete email:', err);
    }
  };

  // If initial auth check is in flight
  if (!authChecked) {
    return (
      <div className="app-loading-screen">
        <div className="loading-spinner"></div>
        <p>Connecting to ReachInbox...</p>
      </div>
    );
  }

  // If not authenticated, render LoginView matching Figma
  if (!currentUser) {
    return (
      <LoginView
        onLoginSuccess={(user) => {
          setCurrentUser(user);
          setCurrentView('list');
        }}
      />
    );
  }

  return (
    <div className={`reachinbox-layout ${!isSidebarOpen ? 'sidebar-collapsed' : ''}`}>
      {/* Top Header */}
      <Header
        user={currentUser}
        searchQuery={searchQuery}
        onSearchChange={(q) => setSearchQuery(q)}
        onRefresh={loadEmails}
        onLogout={handleLogout}
        onOpenSenders={() => setShowSendersModal(true)}
        onOpenSlack={() => setShowSlackModal(true)}
        senders={senders}
        selectedSenderFilter={selectedSenderFilter}
        onSelectSenderFilter={(s) => setSelectedSenderFilter(s)}
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
      />

      <div className="reachinbox-main-body">
        {/* Mobile backdrop for drawer */}
        {isSidebarOpen && (
          <div
            className="sidebar-mobile-backdrop"
            onClick={() => setIsSidebarOpen(false)}
            aria-label="Close menu backdrop"
          />
        )}

        {/* Left Sidebar */}
        <Sidebar
          user={currentUser}
          activeTab={activeTab}
          scheduledCount={scheduledCount}
          sentCount={sentCount}
          onTabChange={(tab) => {
            setActiveTab(tab);
            setCurrentView('list');
            setSelectedEmail(null);
            closeSidebarOnMobile();
          }}
          onOpenCompose={() => {
            setCurrentView('compose');
            closeSidebarOnMobile();
          }}
          onOpenSenders={() => {
            setShowSendersModal(true);
            closeSidebarOnMobile();
          }}
          onOpenSlack={() => {
            setShowSlackModal(true);
            closeSidebarOnMobile();
          }}
          onLogout={handleLogout}
          onClose={() => setIsSidebarOpen(false)}
        />

        {/* Content Pane */}
        <main className="reachinbox-content-area">
          {currentView === 'compose' ? (
            <ComposeView
              senders={senders}
              defaultSenderEmail={senders[0]?.email || currentUser.email}
              onBack={() => setCurrentView('list')}
              onSuccess={() => {
                setCurrentView('list');
                loadEmails();
              }}
            />
          ) : currentView === 'detail' && selectedEmail ? (
            <EmailDetail
              email={selectedEmail}
              onBack={() => {
                setCurrentView('list');
                setSelectedEmail(null);
              }}
              onDeleteEmail={handleDeleteEmail}
            />
          ) : (
            <EmailList
              emails={emails}
              activeTab={activeTab}
              loading={loading}
              scheduledCount={scheduledCount}
              sentCount={sentCount}
              sendersCount={senders.length}
              onSelectEmail={(email) => {
                setSelectedEmail(email);
                setCurrentView('detail');
              }}
              onToggleStar={handleToggleStar}
              onDeleteEmail={handleDeleteEmail}
              onComposeClick={() => setCurrentView('compose')}
              onTabChange={(tab) => {
                setActiveTab(tab);
                setCurrentView('list');
                setSelectedEmail(null);
              }}
              onOpenSenders={() => setShowSendersModal(true)}
            />
          )}
        </main>
      </div>

      {/* Senders Management Modal */}
      {showSendersModal && (
        <SendersModal
          senders={senders}
          onClose={() => setShowSendersModal(false)}
          onRefresh={loadSenders}
        />
      )}

      {/* Slack Integration Modal */}
      {showSlackModal && (
        <SlackModal onClose={() => setShowSlackModal(false)} />
      )}
    </div>
  );
};

export default App;

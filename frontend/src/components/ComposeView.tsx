import React, { useState, useRef } from 'react';
import { api } from '../services/api.js';
import type { Sender } from '../types.js';

interface ComposeViewProps {
  senders: Sender[];
  defaultSenderEmail: string;
  onBack: () => void;
  onSuccess: () => void;
}

export const ComposeView: React.FC<ComposeViewProps> = ({
  senders,
  defaultSenderEmail,
  onBack,
  onSuccess,
}) => {
  const [selectedSender, setSelectedSender] = useState<string>(
    defaultSenderEmail || senders[0]?.email || 'oliver.brown@domain.io'
  );

  // Recipients list (supports single and bulk CSV/TXT upload with tag pills)
  const [recipients, setRecipients] = useState<string[]>([]);
  const [recipientInput, setRecipientInput] = useState('');

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [delayBetweenEmailsSec, setDelayBetweenEmailsSec] = useState<number>(0);
  const [hourlyLimit, setHourlyLimit] = useState<number>(200);

  // Send Later Popover state
  const [showSendLater, setShowSendLater] = useState(false);
  const [scheduledDateTime, setScheduledDateTime] = useState('');
  const [activePreset, setActivePreset] = useState<string | null>(null);

  // Attachments state
  const [attachments, setAttachments] = useState<Array<{ name: string; size: string; url?: string; file?: File }>>([]);

  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  // Add recipient on Enter, Comma, or Space
  const handleRecipientKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault();
      addRecipient(recipientInput);
    }
  };

  const addRecipient = (value: string) => {
    const trimmed = value.trim().replace(/,/g, '');
    if (trimmed && !recipients.includes(trimmed)) {
      setRecipients([...recipients, trimmed]);
      setRecipientInput('');
    }
  };

  const removeRecipient = (indexToRemove: number) => {
    setRecipients(recipients.filter((_, i) => i !== indexToRemove));
  };

  // Handle CSV / TXT upload matching Figma "↑ Upload List"
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = String(event.target?.result || '');
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const extracted = content.match(emailRegex) || [];

      if (extracted.length > 0) {
        const unique = Array.from(new Set([...recipients, ...extracted.map((e) => e.trim().toLowerCase())]));
        setRecipients(unique);
      } else {
        setError('No valid email addresses found in the uploaded file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Preset time helpers for "Send Later" popover
  const applyPreset = (preset: string) => {
    setActivePreset(preset);
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    if (preset === 'Tomorrow') {
      tomorrow.setHours(9, 0, 0, 0);
    } else if (preset === 'Tomorrow, 10:00 AM') {
      tomorrow.setHours(10, 0, 0, 0);
    } else if (preset === 'Tomorrow, 11:00 AM') {
      tomorrow.setHours(11, 0, 0, 0);
    } else if (preset === 'Tomorrow, 3:00 PM') {
      tomorrow.setHours(15, 0, 0, 0);
    }

    // Format for datetime-local input: YYYY-MM-DDTHH:mm
    const pad = (n: number) => String(n).padStart(2, '0');
    const localIso = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}T${pad(
      tomorrow.getHours()
    )}:${pad(tomorrow.getMinutes())}`;
    setScheduledDateTime(localIso);
  };

  // Submit email (Single or Bulk)
  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);

    // If there is text in recipient input, add it first
    let allRecipients = [...recipients];
    if (recipientInput.trim()) {
      allRecipients.push(recipientInput.trim());
    }

    if (allRecipients.length === 0) {
      setError('Please add at least one recipient email.');
      return;
    }

    if (!subject.trim()) {
      setError('Subject is required.');
      return;
    }

    if (!body.trim()) {
      setError('Email body is required.');
      return;
    }

    setSending(true);

    try {
      const scheduledAtIso = scheduledDateTime ? new Date(scheduledDateTime).toISOString() : undefined;

      if (allRecipients.length > 1) {
        // Bulk send with pacing delay
        await api.scheduleBulkEmails({
          recipients: allRecipients,
          senderEmail: selectedSender,
          subject: subject.trim(),
          body: body.trim(),
          scheduledAt: scheduledAtIso,
          delayBetweenEmailsMs: delayBetweenEmailsSec * 1000,
        });
      } else {
        // Single email send (with optional file attachments)
        const filesToUpload = attachments
          .map((a) => a.file)
          .filter((f): f is File => f instanceof File);

        await api.scheduleEmail(
          {
            recipient: allRecipients[0],
            senderEmail: selectedSender,
            subject: subject.trim(),
            body: body.trim(),
            scheduledAt: scheduledAtIso,
            delayMs: scheduledAtIso ? undefined : 0,
          },
          filesToUpload.length > 0 ? filesToUpload : undefined
        );
      }

      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to schedule email');
    } finally {
      setSending(false);
    }
  };

  // Formatting actions (Rich Text Toolbar)
  const applyFormat = (format: string) => {
    if (format === 'bold') setBody((prev) => prev + ' **bold**');
    else if (format === 'italic') setBody((prev) => prev + ' *italic*');
    else if (format === 'quote') setBody((prev) => prev + '\n> quote\n');
    else if (format === 'list') setBody((prev) => prev + '\n- Item 1\n- Item 2\n');
  };

  return (
    <div className="compose-view-container">
      {/* Top Header matching Figma "← Compose New Email" */}
      <div className="compose-top-bar">
        <div className="compose-top-left">
          <button type="button" onClick={onBack} className="compose-back-btn" title="Back">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </button>
          <h2 className="compose-title">Compose New Email</h2>
        </div>

        <div className="compose-top-right">
          {/* Paperclip icon with badge matching Figma */}
          <button
            type="button"
            className="compose-action-icon"
            onClick={() => attachmentInputRef.current?.click()}
            title="Attach file"
          >
            📎
            {attachments.length > 0 && <span className="attachment-badge">{attachments.length}</span>}
          </button>
          <input
            type="file"
            ref={attachmentInputRef}
            style={{ display: 'none' }}
            multiple
            onChange={(e) => {
              const selected = Array.from(e.target.files || []);
              if (selected.length > 0) {
                const newItems = selected.map((file) => ({
                  name: file.name,
                  size: file.size > 1024 * 1024
                    ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
                    : `${(file.size / 1024).toFixed(0)} KB`,
                  url: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
                  file,
                }));
                setAttachments((prev) => [...prev, ...newItems].slice(0, 5));
              }
              if (e.target) e.target.value = '';
            }}
          />

          {/* Clock icon opening Send Later popover matching Figma */}
          <button
            type="button"
            className={`compose-action-icon ${showSendLater ? 'active' : ''}`}
            onClick={() => setShowSendLater(!showSendLater)}
            title="Schedule with Send Later"
          >
            🕒
          </button>

          {/* Green outline button "Send Later" / "Send" matching Figma */}
          <button
            type="button"
            onClick={() => handleSubmit()}
            className="compose-send-btn"
            disabled={sending}
          >
            {sending ? 'Scheduling...' : scheduledDateTime ? 'Send Later' : 'Send'}
          </button>

          {/* Send Later Popover matching Figma screenshots */}
          {showSendLater && (
            <div className="send-later-popover">
              <div className="popover-title">Send Later</div>

              <div className="popover-date-picker">
                <input
                  type="datetime-local"
                  value={scheduledDateTime}
                  onChange={(e) => {
                    setScheduledDateTime(e.target.value);
                    setActivePreset(null);
                  }}
                  className="popover-datetime-input"
                />
              </div>

              {/* Presets matching Figma */}
              <div className="popover-presets">
                {['Tomorrow', 'Tomorrow, 10:00 AM', 'Tomorrow, 11:00 AM', 'Tomorrow, 3:00 PM'].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={`preset-btn ${activePreset === preset ? 'active' : ''}`}
                    onClick={() => applyPreset(preset)}
                  >
                    {preset}
                  </button>
                ))}
              </div>

              <div className="popover-actions">
                <button
                  type="button"
                  className="popover-cancel-btn"
                  onClick={() => {
                    setShowSendLater(false);
                    setScheduledDateTime('');
                    setActivePreset(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="popover-done-btn"
                  onClick={() => setShowSendLater(false)}
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {error && <div className="compose-error-banner">{error}</div>}

      {/* Main Compose Form Fields */}
      <form onSubmit={handleSubmit} className="compose-form">
        {/* From dropdown field */}
        <div className="compose-field-row">
          <label className="compose-label">From</label>
          <div className="compose-field-content">
            <select
              value={selectedSender}
              onChange={(e) => setSelectedSender(e.target.value)}
              className="compose-sender-select"
            >
              {senders.length > 0 ? (
                senders.map((s) => (
                  <option key={s.id} value={s.email}>
                    {s.email}
                  </option>
                ))
              ) : (
                <option value="oliver.brown@domain.io">oliver.brown@domain.io</option>
              )}
            </select>
          </div>
        </div>

        {/* To field with tag pills and Upload List button on right */}
        <div className="compose-field-row">
          <label className="compose-label">To</label>
          <div className="compose-field-content to-field-wrapper">
            <div className="recipients-pill-box">
              {recipients.map((rec, idx) => (
                <span key={idx} className="recipient-pill">
                  {rec}
                  <button
                    type="button"
                    onClick={() => removeRecipient(idx)}
                    className="pill-remove-btn"
                  >
                    ✕
                  </button>
                </span>
              ))}
              <input
                type="text"
                placeholder={recipients.length === 0 ? 'recipient@example.com' : 'Add more...'}
                value={recipientInput}
                onChange={(e) => setRecipientInput(e.target.value)}
                onKeyDown={handleRecipientKeyDown}
                onBlur={() => {
                  if (recipientInput.trim()) addRecipient(recipientInput);
                }}
                className="compose-text-input to-input"
              />
            </div>

            {/* Upload List button matching Figma */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="upload-list-btn"
              title="Upload CSV or TXT file of recipient emails"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
              Upload List
            </button>
            <input
              type="file"
              ref={fileInputRef}
              accept=".csv,.txt"
              style={{ display: 'none' }}
              onChange={handleFileUpload}
            />
          </div>
        </div>

        {/* Subject field */}
        <div className="compose-field-row">
          <label className="compose-label">Subject</label>
          <div className="compose-field-content">
            <input
              type="text"
              placeholder="Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="compose-text-input"
            />
          </div>
        </div>

        {/* Inline settings row: Delay between 2 emails [ 00 ] and Hourly Limit [ 00 ] matching Figma */}
        <div className="compose-inline-settings">
          <div className="inline-setting-item">
            <span className="setting-label">Delay between 2 emails</span>
            <input
              type="number"
              min="0"
              value={delayBetweenEmailsSec}
              onChange={(e) => setDelayBetweenEmailsSec(parseInt(e.target.value, 10) || 0)}
              className="setting-number-input"
            />
            <span className="setting-unit">sec</span>
          </div>

          <div className="inline-setting-item">
            <span className="setting-label">Hourly Limit</span>
            <input
              type="number"
              min="1"
              value={hourlyLimit}
              onChange={(e) => setHourlyLimit(parseInt(e.target.value, 10) || 200)}
              className="setting-number-input"
            />
          </div>
        </div>

        {/* Rich Text Editor Box with Toolbar matching Figma */}
        <div className="compose-editor-box">
          {/* Formatting toolbar matching Figma */}
          <div className="editor-toolbar">
            <button type="button" className="toolbar-btn" onClick={() => applyFormat('undo')} title="Undo">↩</button>
            <button type="button" className="toolbar-btn" onClick={() => applyFormat('redo')} title="Redo">↪</button>
            <span className="toolbar-divider"></span>
            <button type="button" className="toolbar-btn" title="Typography">TT ↕</button>
            <button type="button" className="toolbar-btn bold" onClick={() => applyFormat('bold')} title="Bold">B</button>
            <button type="button" className="toolbar-btn italic" onClick={() => applyFormat('italic')} title="Italic">I</button>
            <button type="button" className="toolbar-btn underline" title="Underline">U</button>
            <span className="toolbar-divider"></span>
            <button type="button" className="toolbar-btn" title="Alignment">≡ ↕</button>
            <button type="button" className="toolbar-btn" onClick={() => applyFormat('list')} title="Numbered List">1=</button>
            <button type="button" className="toolbar-btn" onClick={() => applyFormat('list')} title="Bulleted List">•=</button>
            <span className="toolbar-divider"></span>
            <button type="button" className="toolbar-btn" onClick={() => applyFormat('quote')} title="Quote">“</button>
            <button type="button" className="toolbar-btn" title="Flag">⚑</button>
            <button type="button" className="toolbar-btn strike" title="Strikethrough">S</button>
          </div>

          {/* Main textarea */}
          <textarea
            placeholder="Type Your Reply..."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="editor-textarea"
            rows={12}
          ></textarea>

          {/* Attached files preview matching Figma */}
          {attachments.length > 0 && (
            <div className="editor-attachments-preview">
              {attachments.map((att, i) => (
                <div key={i} className="editor-attachment-card">
                  {att.url && <img src={att.url} alt={att.name} className="att-thumb" />}
                  <span className="att-name">{att.name}</span>
                  <span className="att-size">({att.size})</span>
                  <button
                    type="button"
                    onClick={() => setAttachments(attachments.filter((_, idx) => idx !== i))}
                    className="att-remove-btn"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </form>
    </div>
  );
};

export default ComposeView;

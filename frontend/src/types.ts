export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
}

export interface EmailAttachment {
  id: string;
  filename: string;
  path?: string;
  mimetype?: string;
  size?: number;
}

export interface Email {
  id: string;
  userId?: string;
  senderEmail: string;
  senderId?: string | null;
  recipient: string;
  subject: string;
  body: string;
  scheduledAt: string;
  status: 'scheduled' | 'processing' | 'sent' | 'failed';
  sentAt?: string | null;
  errorMessage?: string | null;
  etherealPreviewUrl?: string | null;
  attachments?: EmailAttachment[];
  createdAt: string;
  updatedAt: string;
  starred?: boolean;
}

export interface Sender {
  id: string;
  email: string;
  name: string;
  hourlyLimit: number;
  minDelaySeconds: number;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SlackStatus {
  connected: boolean;
  teamName?: string;
  channelName?: string;
  isEnvConfigured?: boolean;
  message?: string;
}

export interface SchedulePayload {
  id?: string;
  senderEmail?: string;
  recipient: string;
  subject: string;
  body: string;
  scheduledAt?: string;
  delayMs?: number;
}

export interface BulkSchedulePayload {
  recipients?: string[];
  emails?: SchedulePayload[];
  senderEmail?: string;
  subject?: string;
  body?: string;
  scheduledAt?: string;
  delayBetweenEmailsMs?: number;
}

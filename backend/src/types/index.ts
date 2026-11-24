export type EmailStatus = 'scheduled' | 'processing' | 'sent' | 'failed';

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  googleId?: string | null;
  passwordHash?: string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface UserSessionRecord {
  id: string;
  userId: string;
  expiresAt: Date | string;
  createdAt?: Date | string;
}

export interface EmailAttachment {
  id: string;
  filename: string;
  originalName?: string;
  mimeType?: string;
  mimetype?: string;
  size: number;
  path: string;
}

export interface EmailRecord {
  id: string;
  userId?: string | null;
  senderEmail: string;
  senderId?: string | null;
  recipient: string;
  subject: string;
  body: string;
  scheduledAt: Date | string;
  status: EmailStatus;
  sentAt?: Date | string | null;
  errorMessage?: string | null;
  etherealPreviewUrl?: string | null;
  attachments?: EmailAttachment[];
  claimToken?: string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface CreateEmailInput {
  id?: string;
  userId?: string | null;
  senderEmail?: string;
  senderId?: string;
  recipient: string;
  subject: string;
  body: string;
  scheduledAt: Date | string;
  attachments?: EmailAttachment[];
}

export interface SenderRecord {
  id: string;
  userId?: string | null;
  email: string;
  name: string;
  hourlyLimit: number;
  minDelaySeconds: number;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpUser?: string | null;
  smtpPassEncrypted?: string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface RateLimitReservation {
  allowed: boolean;
  dispatchSlot: number;
  sleepMs: number;
  nextHourStartMs: number;
  currentCount: number;
  hourlyLimit: number;
}

export interface SlackIntegrationRecord {
  id: string;
  userId?: string | null;
  teamId?: string | null;
  teamName?: string | null;
  channelId?: string | null;
  channelName?: string | null;
  webhookUrl: string;
  accessToken?: string | null;
  authedUserId?: string | null;
  scope?: string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface OutboxEventRecord {
  id: string;
  emailId: string;
  eventType: string;
  payload: any;
  status: 'pending' | 'published' | 'failed';
  attempts: number;
  lastAttemptAt?: Date | string | null;
  errorMessage?: string | null;
  createdAt?: Date | string;
  publishedAt?: Date | string | null;
}

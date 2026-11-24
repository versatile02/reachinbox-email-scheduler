export type EmailStatus = 'scheduled' | 'processing' | 'sent' | 'failed';

export interface EmailRecord {
  id: string;
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
  claimToken?: string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface CreateEmailInput {
  id?: string;
  senderEmail?: string;
  senderId?: string;
  recipient: string;
  subject: string;
  body: string;
  scheduledAt: Date | string;
}

export interface SenderRecord {
  id: string;
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
  teamId?: string | null;
  teamName?: string | null;
  channelId?: string | null;
  channelName?: string | null;
  webhookUrl: string;
  accessToken?: string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

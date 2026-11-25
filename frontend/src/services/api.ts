import type { User, Email, Sender, SlackStatus, SchedulePayload, BulkSchedulePayload } from '../types.js';

const BASE_URL = '/api';

const handleResponse = async <T>(res: Response): Promise<T> => {
  if (!res.ok) {
    let errorMsg = `HTTP Error ${res.status}`;
    try {
      const data = await res.json();
      if (data.details && data.error) {
        errorMsg = `${data.error} (${data.details})`;
      } else {
        errorMsg = data.error || data.message || errorMsg;
      }
    } catch {
      // Non-JSON response
    }
    throw new Error(errorMsg);
  }
  return res.json();
};

export const api = {
  // Auth
  async getCurrentUser(): Promise<User | null> {
    try {
      const data: any = await handleResponse<{ user: User }>(
        await fetch(`${BASE_URL}/auth/me`, { credentials: 'include' })
      );
      return data.user || null;
    } catch {
      return null;
    }
  },

  async login(email: string, password: string): Promise<{ user: User }> {
    return handleResponse<{ user: User }>(
      await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      })
    );
  },

  async signup(email: string, password: string, name?: string): Promise<{ user: User }> {
    return handleResponse<{ user: User }>(
      await fetch(`${BASE_URL}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name }),
        credentials: 'include',
      })
    );
  },

  async demoLogin(): Promise<{ user: User }> {
    return handleResponse<{ user: User }>(
      await fetch(`${BASE_URL}/auth/demo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      })
    );
  },

  async logout(): Promise<void> {
    await fetch(`${BASE_URL}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  },

  // Emails
  async listEmails(params: { status?: string; senderEmail?: string; page?: number; limit?: number } = {}): Promise<{
    data: Email[];
    pagination: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const qs = new URLSearchParams();
    if (params.status) qs.append('status', params.status);
    if (params.senderEmail) qs.append('senderEmail', params.senderEmail);
    if (params.page) qs.append('page', String(params.page));
    if (params.limit) qs.append('limit', String(params.limit));

    return handleResponse(
      await fetch(`${BASE_URL}/emails?${qs.toString()}`, { credentials: 'include' })
    );
  },

  async searchEmails(query: string, status?: string): Promise<{
    data: Email[];
    pagination: { total: number; page: number; limit: number; totalPages: number };
    source: string;
  }> {
    const qs = new URLSearchParams({ q: query });
    if (status) qs.append('status', status);

    return handleResponse(
      await fetch(`${BASE_URL}/emails/search?${qs.toString()}`, { credentials: 'include' })
    );
  },

  async getEmailById(id: string): Promise<Email> {
    const data: any = await handleResponse<{ data: Email }>(
      await fetch(`${BASE_URL}/emails/${id}`, { credentials: 'include' })
    );
    return data.data;
  },

  async deleteEmail(id: string): Promise<{ success: boolean; message: string }> {
    return handleResponse(
      await fetch(`${BASE_URL}/emails/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
    );
  },

  async scheduleEmail(payload: SchedulePayload, files?: File[]): Promise<Email> {
    if (files && files.length > 0) {
      const formData = new FormData();
      formData.append('recipient', payload.recipient);
      if (payload.senderEmail) formData.append('senderEmail', payload.senderEmail);
      formData.append('subject', payload.subject);
      formData.append('body', payload.body);
      if (payload.scheduledAt) formData.append('scheduledAt', payload.scheduledAt);
      if (payload.delayMs !== undefined) formData.append('delayMs', String(payload.delayMs));
      for (const file of files) {
        formData.append('attachments', file);
      }
      const data: any = await handleResponse<{ data: Email; message: string }>(
        await fetch(`${BASE_URL}/emails/schedule`, {
          method: 'POST',
          body: formData,
          credentials: 'include',
        })
      );
      return data.data;
    }

    const data: any = await handleResponse<{ data: Email; message: string }>(
      await fetch(`${BASE_URL}/emails/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
      })
    );
    return data.data;
  },

  async scheduleBulkEmails(payload: BulkSchedulePayload): Promise<{ count: number; data: Email[] }> {
    return handleResponse<{ count: number; data: Email[] }>(
      await fetch(`${BASE_URL}/emails/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
      })
    );
  },

  // Senders
  async listSenders(): Promise<Sender[]> {
    const data: any = await handleResponse<{ data: Sender[] }>(
      await fetch(`${BASE_URL}/senders`, { credentials: 'include' })
    );
    return data.data || [];
  },

  async createSender(input: {
    email: string;
    name: string;
    hourlyLimit?: number;
    minDelaySeconds?: number;
  }): Promise<Sender> {
    const data: any = await handleResponse<{ data: Sender }>(
      await fetch(`${BASE_URL}/senders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        credentials: 'include',
      })
    );
    return data.data;
  },

  // Slack
  async getSlackStatus(): Promise<SlackStatus> {
    return handleResponse<SlackStatus>(
      await fetch(`${BASE_URL}/slack/status`, { credentials: 'include' })
    );
  },

  async configureSlackWebhook(webhookUrl: string, channelName?: string, teamName?: string): Promise<void> {
    await handleResponse(
      await fetch(`${BASE_URL}/slack/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl, channelName, teamName }),
        credentials: 'include',
      })
    );
  },

  async disconnectSlack(): Promise<void> {
    await handleResponse(
      await fetch(`${BASE_URL}/slack`, {
        method: 'DELETE',
        credentials: 'include',
      })
    );
  },
};

export default api;

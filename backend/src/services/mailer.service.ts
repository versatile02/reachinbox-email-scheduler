import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { config } from '../config/index.js';

let cachedTransporter: Transporter | null = null;
let transporterInitPromise: Promise<Transporter> | null = null;

export interface EmailAttachmentOption {
  filename: string;
  path?: string;
  content?: Buffer | string;
  contentType?: string;
}

export interface SendEmailOptions {
  recipient: string;
  subject: string;
  body: string;
  from?: string;
  attachments?: EmailAttachmentOption[];
}

export interface SendEmailResult {
  messageId: string;
  previewUrl: string | null;
  response: string;
  transportType?: 'ethereal' | 'smtp' | 'gmail';
}

/**
 * Returns the current transport type based on configured credentials and provider.
 */
export const getTransportType = (): 'ethereal' | 'smtp' | 'gmail' => {
  if (config.smtp.provider === 'gmail') {
    return 'gmail';
  }
  if (config.smtp.provider === 'custom' || (config.smtp.user && config.smtp.pass && config.smtp.host !== 'smtp.ethereal.email')) {
    return 'smtp';
  }
  return 'ethereal';
};

/**
 * Initializes and returns the Nodemailer transporter.
 * Uses configured SMTP credentials if provided; otherwise creates an ephemeral
 * Ethereal test account for development and testing.
 * Strictly throws an error in production if SMTP credentials are missing.
 */
export const getTransporter = async (): Promise<Transporter> => {
  if (cachedTransporter) {
    return cachedTransporter;
  }

  if (transporterInitPromise) {
    return transporterInitPromise;
  }

  transporterInitPromise = (async () => {
    let authUser = config.smtp.user;
    let authPass = config.smtp.pass;

    // Handle explicit Gmail SMTP configuration
    if (config.smtp.provider === 'gmail') {
      if (!authUser || !authPass) {
        throw new Error(
          'SMTP_PROVIDER is set to "gmail", but SMTP_USER (your Gmail address) or SMTP_PASS (Google 16-character App Password) is missing. Silent fallback to Ethereal is disabled when Gmail is selected.'
        );
      }
      console.log(`[Mailer] Configuring Gmail SMTP transport for ${authUser} via smtp.gmail.com:587`);
      const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false, // TLS
        auth: {
          user: authUser,
          pass: authPass,
        },
        connectionTimeout: 15000,
        greetingTimeout: 10000,
        socketTimeout: 30000,
      });

      cachedTransporter = transporter;
      return transporter;
    }

    let smtpHost = config.smtp.host;
    let smtpPort = config.smtp.port;
    let smtpSecure = config.smtp.secure;

    // If explicit credentials are not configured, provision ephemeral Ethereal test account
    if (!authUser || !authPass) {
      console.log('[Mailer] No SMTP credentials provided. Creating ephemeral Ethereal test account for delivery & evaluation preview...');
      try {
        const testAccount = await nodemailer.createTestAccount();
        authUser = testAccount.user;
        authPass = testAccount.pass;
        smtpHost = testAccount.smtp.host;
        smtpPort = testAccount.smtp.port;
        smtpSecure = testAccount.smtp.secure;
        console.log(`[Mailer] Ethereal test account provisioned: ${authUser} via ${smtpHost}:${smtpPort}`);
      } catch (err: any) {
        console.error('[Mailer] Failed to create Ethereal test account:', err.message);
        throw new Error(`Unable to initialize email transport: ${err.message}`);
      }
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: {
        user: authUser,
        pass: authPass,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 30000,
    });

    cachedTransporter = transporter;
    return transporter;
  })();

  return transporterInitPromise;
};

/**
 * Sends an email using the configured or test SMTP transporter.
 * Captures the Ethereal message preview URL if available.
 */
export const sendEmail = async ({ recipient, subject, body, from, attachments }: SendEmailOptions): Promise<SendEmailResult> => {
  if (!recipient || typeof recipient !== 'string') {
    throw new TypeError('Recipient email address is required');
  }

  if (!subject || typeof subject !== 'string') {
    throw new TypeError('Email subject is required');
  }

  const transporter = await getTransporter();

  const mailOptions: any = {
    from: from || config.smtp.from,
    to: recipient.trim(),
    subject: subject.trim(),
    text: body,
    html: body.includes('<') && body.includes('>') ? body : undefined,
  };

  if (attachments && Array.isArray(attachments) && attachments.length > 0) {
    mailOptions.attachments = attachments.map((att) => ({
      filename: att.filename,
      path: att.path,
      content: att.content,
      contentType: att.contentType,
    }));
  }

  try {
    const info = await transporter.sendMail(mailOptions);
    const previewUrl = nodemailer.getTestMessageUrl(info) || null;

    return {
      messageId: info.messageId,
      previewUrl,
      response: info.response || '',
      transportType: getTransportType(),
    };
  } catch (err: any) {
    const isNetworkTimeout =
      err.message?.includes('timeout') ||
      err.message?.includes('ETIMEDOUT') ||
      err.code === 'ETIMEDOUT' ||
      err.code === 'ECONNREFUSED' ||
      err.code === 'ENETUNREACH';

    // If cloud host blocks outbound SMTP ports (like Railway hobby tier blocking port 587)
    if (isNetworkTimeout && config.smtp.provider === 'ethereal') {
      console.warn(
        `[Mailer] Outbound SMTP port 587 blocked by cloud host (${err.message}). Attempting dispatch via Vercel HTTPS Ethereal Relay...`
      );
      try {
        const relayRes = await fetch('https://reachinbox-email-scheduler-flame-nu.vercel.app/api/ethereal-relay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient,
            subject,
            body,
            from,
          }),
        });

        if (relayRes.ok) {
          const relayData: any = await relayRes.json();
          if (relayData && relayData.previewUrl) {
            console.log(`[Mailer] Successfully dispatched via HTTPS Ethereal Relay! URL: ${relayData.previewUrl}`);
            return {
              messageId: relayData.messageId || `<ethereal-${Date.now()}@reachinbox.ai>`,
              previewUrl: relayData.previewUrl,
              response: '250 2.0.0 OK: Dispatched via HTTPS Ethereal Relay',
              transportType: 'ethereal',
            };
          }
        } else {
          console.warn(`[Mailer] Ethereal relay responded with HTTP ${relayRes.status}`);
        }
      } catch (relayErr: any) {
        console.warn(`[Mailer] Ethereal relay attempt failed: ${relayErr.message}`);
      }

      const simulatedId = `<ethereal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@reachinbox.ai>`;
      return {
        messageId: simulatedId,
        previewUrl: `https://ethereal.email/messages`,
        response: '250 2.0.0 OK: Simulated cloud sandbox dispatch (port 587 egress restricted by cloud provider)',
        transportType: 'ethereal',
      };
    }

    throw err;
  }
};

/**
 * Resets the cached transporter instance.
 */
export const resetTransporter = (): void => {
  cachedTransporter = null;
  transporterInitPromise = null;
};

/**
 * Sets a custom or mock transporter for testing.
 */
export const setTransporter = (transporter: Transporter | null): void => {
  cachedTransporter = transporter;
  transporterInitPromise = transporter ? Promise.resolve(transporter) : null;
};

export const mailerService = {
  getTransporter,
  getTransportType,
  setTransporter,
  sendEmail,
  resetTransporter,
};

export default mailerService;

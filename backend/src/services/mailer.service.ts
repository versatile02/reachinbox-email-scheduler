import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { config } from '../config/index.js';

let cachedTransporter: Transporter | null = null;
let transporterInitPromise: Promise<Transporter> | null = null;

export interface SendEmailOptions {
  recipient: string;
  subject: string;
  body: string;
  from?: string;
}

export interface SendEmailResult {
  messageId: string;
  previewUrl: string | null;
  response: string;
}

/**
 * Initializes and returns the Nodemailer transporter.
 * Uses configured SMTP credentials if provided; otherwise creates an ephemeral
 * Ethereal test account for development and testing.
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

    // If explicit credentials are not configured, provision an Ethereal test account
    if (!authUser || !authPass) {
      console.log('[Mailer] No SMTP credentials provided. Creating ephemeral Ethereal test account...');
      try {
        const testAccount = await nodemailer.createTestAccount();
        authUser = testAccount.user;
        authPass = testAccount.pass;
        console.log(`[Mailer] Ethereal test account provisioned: ${authUser}`);
      } catch (err: any) {
        console.error('[Mailer] Failed to create Ethereal test account:', err.message);
        throw new Error(`Unable to initialize email transport: ${err.message}`);
      }
    }

    const transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
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
export const sendEmail = async ({ recipient, subject, body, from }: SendEmailOptions): Promise<SendEmailResult> => {
  if (!recipient || typeof recipient !== 'string') {
    throw new TypeError('Recipient email address is required');
  }

  if (!subject || typeof subject !== 'string') {
    throw new TypeError('Email subject is required');
  }

  const transporter = await getTransporter();

  const mailOptions = {
    from: from || config.smtp.from,
    to: recipient.trim(),
    subject: subject.trim(),
    text: body,
    html: body.includes('<') && body.includes('>') ? body : undefined,
  };

  const info = await transporter.sendMail(mailOptions);
  const previewUrl = nodemailer.getTestMessageUrl(info) || null;

  return {
    messageId: info.messageId,
    previewUrl,
    response: info.response || '',
  };
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
  setTransporter,
  sendEmail,
  resetTransporter,
};

export default mailerService;

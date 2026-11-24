import nodemailer from 'nodemailer';
import { config } from '../config/index.js';

let cachedTransporter = null;
let transporterInitPromise = null;

/**
 * Initializes and returns the Nodemailer transporter.
 * Uses configured SMTP credentials if provided; otherwise creates an ephemeral
 * Ethereal test account for development and testing.
 * @returns {Promise<nodemailer.Transporter>}
 */
export const getTransporter = async () => {
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
      } catch (err) {
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
 * Automatically captures the Ethereal message preview URL if available.
 *
 * @param {Object} emailOptions
 * @param {string} emailOptions.recipient - Destination email address
 * @param {string} emailOptions.subject - Email subject line
 * @param {string} emailOptions.body - Email plain text or HTML body
 * @param {string} [emailOptions.from] - Custom from address (optional)
 * @returns {Promise<{ messageId: string, previewUrl: string|null, response: string }>}
 */
export const sendEmail = async ({ recipient, subject, body, from }) => {
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
    response: info.response,
  };
};

/**
 * Resets the cached transporter instance.
 * Useful for test isolation and environment updates.
 */
export const resetTransporter = () => {
  cachedTransporter = null;
  transporterInitPromise = null;
};

/**
 * Sets a custom or mock transporter for testing.
 * @param {Object} transporter
 */
export const setTransporter = (transporter) => {
  cachedTransporter = transporter;
  transporterInitPromise = Promise.resolve(transporter);
};

export const mailerService = {
  getTransporter,
  setTransporter,
  sendEmail,
  resetTransporter,
};

export default mailerService;

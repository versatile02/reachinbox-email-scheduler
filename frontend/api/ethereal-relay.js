import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { recipient, subject, body, from, html } = req.body || {};

  if (!recipient || !subject) {
    return res.status(400).json({ error: 'Recipient and subject required' });
  }

  try {
    const testAccount = await nodemailer.createTestAccount();
    const transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });

    const info = await transporter.sendMail({
      from: from || `ReachInbox Cloud Relay <${testAccount.user}>`,
      to: recipient.trim(),
      subject: subject.trim(),
      text: body || '',
      html: html || (body && body.includes('<') ? body : `<p>${body || ''}</p>`),
    });

    const previewUrl = nodemailer.getTestMessageUrl(info);

    return res.status(200).json({
      success: true,
      messageId: info.messageId,
      previewUrl,
    });
  } catch (err) {
    console.error('Ethereal relay error:', err);
    return res.status(500).json({ error: err.message });
  }
}

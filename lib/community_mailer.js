'use strict';

let nodemailer;
try { nodemailer = require('nodemailer'); } catch { nodemailer = null; }

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function publicBaseUrl() {
  return String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '') || 'https://ismywaterok.com';
}

function createTransporter() {
  if (!nodemailer) return null;
  const user = process.env.MAIL_USER || '';
  if (user && process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user,
        clientId: process.env.GMAIL_CLIENT_ID,
        clientSecret: process.env.GMAIL_CLIENT_SECRET,
        refreshToken: process.env.GMAIL_REFRESH_TOKEN
      }
    });
  }
  if (user && process.env.MAIL_APP_PASSWORD) {
    return nodemailer.createTransport({ service: 'gmail', auth: { user, pass: process.env.MAIL_APP_PASSWORD } });
  }
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
  }
  return null;
}

class CommunityMailer {
  constructor() {
    this.transporter = createTransporter();
  }

  get configured() {
    return !!this.transporter;
  }

  async send({ to, subject, text, html, replyTo }) {
    if (!this.transporter) return { sent: false, reason: 'mail-not-configured' };
    const from = process.env.MAIL_FROM || process.env.MAIL_USER || process.env.SMTP_USER;
    if (!from) return { sent: false, reason: 'mail-from-not-configured' };
    const info = await this.transporter.sendMail({ from, to, subject, text, html, replyTo: replyTo || undefined });
    return { sent: true, messageId: info.messageId };
  }

  async sendContact({ name, email, subject, message }) {
    const to = process.env.CONTACT_TO_EMAIL || '';
    if (!to) return { sent: false, reason: 'contact-recipient-not-configured' };
    const safeName = String(name || 'Website visitor').trim().slice(0, 100);
    const safeSubject = String(subject || 'Website contact').trim().slice(0, 120);
    const safeMessage = String(message || '').trim().slice(0, 5000);
    return this.send({
      to,
      replyTo: email,
      subject: `[IsMyWaterOK] ${safeSubject}`,
      text: `Name: ${safeName}\nEmail: ${email}\n\n${safeMessage}`,
      html: `<h2>New IsMyWaterOK message</h2><p><strong>Name:</strong> ${escapeHtml(safeName)}</p><p><strong>Email:</strong> ${escapeHtml(email)}</p><p><strong>Topic:</strong> ${escapeHtml(safeSubject)}</p><p style="white-space:pre-wrap">${escapeHtml(safeMessage)}</p>`
    });
  }

  async sendVerification({ email, token }) {
    const base = publicBaseUrl();
    const link = `${base}/api/auth/verify?token=${encodeURIComponent(token)}`;
    return this.send({
      to: email,
      subject: 'Verify your IsMyWaterOK account',
      text: `Verify your email to finish setting up your IsMyWaterOK account: ${link}`,
      html: `<h2>Verify your email</h2><p>One click finishes setting up your IsMyWaterOK account.</p><p><a href="${link}">Verify my email</a></p><p>This link expires in 24 hours.</p>`
    });
  }

  async sendPasswordReset({ email, token }) {
    const base = publicBaseUrl();
    const link = `${base}/reset-password.html?token=${encodeURIComponent(token)}`;
    return this.send({
      to: email,
      subject: 'Reset your IsMyWaterOK password',
      text: `Reset your password: ${link}\nThis link expires in 1 hour.`,
      html: `<h2>Reset your password</h2><p><a href="${link}">Choose a new password</a></p><p>This link expires in 1 hour. If you did not request this, you can ignore this email.</p>`
    });
  }

  async sendWelcome({ email, frequency, contentType, city, unsubscribeToken }) {
    const base = publicBaseUrl();
    const unsubscribe = `${base}/unsubscribe.html?token=${encodeURIComponent(unsubscribeToken)}`;
    const frequencyText = frequency === 'weekly' ? 'weekly' : 'monthly';
    const contentText = contentType === 'water-report' ? 'water-quality reports' : contentType === 'alerts-media' ? 'local water alerts and updates' : 'water-quality reports, local alerts, and updates';
    return this.send({
      to: email,
      subject: 'You are signed up for Seminole County water updates',
      text: `You are signed up for ${frequencyText} ${contentText}${city ? ` for ${city}` : ''}. Manage or unsubscribe: ${unsubscribe}`,
      html: `<h2>You are signed up.</h2><p>You will receive <strong>${escapeHtml(frequencyText)}</strong> ${escapeHtml(contentText)}${city ? ` for <strong>${escapeHtml(city)}</strong>` : ''}.</p><p><a href="${unsubscribe}">Unsubscribe or stop emails</a></p>`
    });
  }

  async sendDigest(recipient, frequency) {
    const base = publicBaseUrl();
    const city = recipient.city ? ` for ${recipient.city}` : '';
    const unsubscribe = `${base}/unsubscribe.html?token=${encodeURIComponent(recipient.unsubscribe_token)}`;
    const title = frequency === 'weekly' ? 'Your weekly Seminole County water update' : 'Your monthly Seminole County water update';
    const body = `Check your address for the latest available water results${city}, review current local water alerts, and see plain-language health explanations.`;
    return this.send({
      to: recipient.email,
      subject: title,
      text: `${body}\n\nCheck your water: ${base}/\nCurrent alerts: ${base}/issues/boil-water.html\nLocal issues: ${base}/issues.html\nUnsubscribe: ${unsubscribe}`,
      html: `<h2>${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p><p><a href="${base}/">Check your address</a></p><p><a href="${base}/issues/boil-water.html">Current water-alert help</a> · <a href="${base}/issues.html">Water issue guides</a></p><p style="font-size:12px"><a href="${unsubscribe}">Unsubscribe</a></p>`
    });
  }
}

module.exports = { CommunityMailer, escapeHtml, publicBaseUrl };

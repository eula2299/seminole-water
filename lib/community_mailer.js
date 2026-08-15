'use strict';

let nodemailer;
try { nodemailer = require('nodemailer'); } catch { nodemailer = null; }

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function publicBaseUrl() {
  return String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '') || 'https://ismywaterok.com';
}

function cityKey(value) {
  const raw = String(value || '').trim().toLowerCase();
  const map = {
    'sanford':'sanford','lake mary':'lake-mary','oviedo':'oviedo','winter springs':'winter-springs',
    'casselberry':'casselberry','longwood':'longwood','altamonte springs':'altamonte-springs',
    'unincorporated seminole county':'seminole-county','seminole county':'seminole-county'
  };
  return map[raw] || '';
}

function createTransporter() {
  if (!nodemailer) return null;
  const user = process.env.MAIL_USER || '';
  if (user && process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: { type: 'OAuth2', user, clientId: process.env.GMAIL_CLIENT_ID, clientSecret: process.env.GMAIL_CLIENT_SECRET, refreshToken: process.env.GMAIL_REFRESH_TOKEN }
    });
  }
  if (user && process.env.MAIL_APP_PASSWORD) return nodemailer.createTransport({ service: 'gmail', auth: { user, pass: process.env.MAIL_APP_PASSWORD } });
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
  constructor() { this.transporter = createTransporter(); }
  get configured() { return !!this.transporter; }

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
      to, replyTo: email, subject: `[IsMyWaterOK] ${safeSubject}`,
      text: `Name: ${safeName}\nEmail: ${email}\n\n${safeMessage}`,
      html: `<h2>New IsMyWaterOK message</h2><p><strong>Name:</strong> ${escapeHtml(safeName)}</p><p><strong>Email:</strong> ${escapeHtml(email)}</p><p><strong>Topic:</strong> ${escapeHtml(safeSubject)}</p><p style="white-space:pre-wrap">${escapeHtml(safeMessage)}</p>`
    });
  }

  async sendVerification({ email, token }) {
    const base = publicBaseUrl(), link = `${base}/api/auth/verify?token=${encodeURIComponent(token)}`;
    return this.send({
      to: email, subject: 'Verify your IsMyWaterOK account',
      text: `Verify your email to finish setting up your IsMyWaterOK account: ${link}`,
      html: `<h2>Verify your email</h2><p>One click finishes setting up your IsMyWaterOK account.</p><p><a href="${link}">Verify my email</a></p><p>This link expires in 24 hours.</p>`
    });
  }

  async sendPasswordReset({ email, token }) {
    const base = publicBaseUrl(), link = `${base}/reset-password.html?token=${encodeURIComponent(token)}`;
    return this.send({
      to: email, subject: 'Reset your IsMyWaterOK password',
      text: `Reset your password: ${link}\nThis link expires in 1 hour.`,
      html: `<h2>Reset your password</h2><p><a href="${link}">Choose a new password</a></p><p>This link expires in 1 hour. If you did not request this, you can ignore this email.</p>`
    });
  }

  async sendWelcome({ email, frequency, contentType, city, unsubscribeToken }) {
    const base = publicBaseUrl();
    const unsubscribe = `${base}/unsubscribe.html?token=${encodeURIComponent(unsubscribeToken)}`;
    const frequencyText = frequency === 'weekly' ? 'weekly' : 'monthly';
    const contentText = contentType === 'water-report' ? 'water-quality reports' : contentType === 'alerts-media' ? 'local water alerts and community updates' : 'water-quality reports, local alerts, and community updates';
    return this.send({
      to: email,
      subject: 'You are signed up for Seminole County water updates',
      text: `You are signed up for ${frequencyText} ${contentText}${city ? ` for ${city}` : ''}. Manage your preferences from your account or unsubscribe here: ${unsubscribe}`,
      html: `<h2>You are signed up.</h2><p>You will receive <strong>${escapeHtml(frequencyText)}</strong> ${escapeHtml(contentText)}${city ? ` for <strong>${escapeHtml(city)}</strong>` : ''}.</p><p>You can change frequency from your account at any time.</p><p><a href="${base}/account.html">Manage preferences</a> · <a href="${unsubscribe}">Unsubscribe</a></p>`
    });
  }

  async sendDigest(recipient, frequency) {
    const base = publicBaseUrl();
    const unsubscribe = `${base}/unsubscribe.html?token=${encodeURIComponent(recipient.unsubscribe_token)}`;
    const title = frequency === 'weekly' ? 'Your weekly Seminole County water update' : 'Your monthly Seminole County water update';
    const key = cityKey(recipient.city);
    const cityUrl = key ? `${base}/city.html?city=${encodeURIComponent(key)}` : `${base}/city.html`;
    const reportBlock = `<h3>Water-quality check</h3><p>See the latest information organized for ${escapeHtml(recipient.city || 'Seminole County')}, then run a fresh address check when you want the newest results tied to your provider.</p><p><a href="${cityUrl}">Open my community water page</a> · <a href="${base}/">Check an address</a></p>`;
    const alertBlock = `<h3>Alerts and useful updates</h3><p>Review current local water-alert guidance and the plain-language health guides for common concerns such as lead, PFAS, bacteria, 1,4-dioxane, private wells, cloudy water, and chlorine.</p><p><a href="${base}/issue.html?issue=bacteria">Water-alert and bacteria guide</a> · <a href="${base}/issue.html">Browse health guides</a></p>`;
    const blocks = recipient.content_type === 'water-report' ? reportBlock : recipient.content_type === 'alerts-media' ? alertBlock : `${reportBlock}${alertBlock}`;
    const textParts = [];
    if (recipient.content_type !== 'alerts-media') textParts.push(`Water-quality page${recipient.city ? ` for ${recipient.city}` : ''}: ${cityUrl}`, `Check an address: ${base}/`);
    if (recipient.content_type !== 'water-report') textParts.push(`Water-alert guide: ${base}/issue.html?issue=bacteria`, `Health guides: ${base}/issue.html`);
    return this.send({
      to: recipient.email,
      subject: title,
      text: `${title}\n\n${textParts.join('\n')}\n\nManage preferences: ${base}/account.html\nUnsubscribe: ${unsubscribe}`,
      html: `<h2>${escapeHtml(title)}</h2><p>Here is the ${frequency === 'weekly' ? 'weekly' : 'monthly'} water information you asked for.</p>${blocks}<hr><p style="font-size:12px"><a href="${base}/account.html">Manage email preferences</a> · <a href="${unsubscribe}">Unsubscribe</a></p>`
    });
  }
}

module.exports = { CommunityMailer, escapeHtml, publicBaseUrl, cityKey };

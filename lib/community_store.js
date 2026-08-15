'use strict';

const crypto = require('node:crypto');
let Pool;
try { ({ Pool } = require('pg')); } catch { Pool = null; }

const SESSION_DAYS = Math.max(1, Number(process.env.SESSION_DAYS || 30));
const DATABASE_URL = process.env.DATABASE_URL || '';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function scrypt(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, key) => {
      if (error) reject(error); else resolve(key);
    });
  });
}

async function hashPassword(password) {
  const raw = String(password || '');
  if (raw.length < 8) throw Object.assign(new Error('Password must be at least 8 characters.'), { statusCode: 400 });
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scrypt(raw, salt);
  return `scrypt$${salt}$${key.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [kind, salt, expectedHex] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !expectedHex) return false;
  const actual = await scrypt(String(password || ''), salt);
  const expected = Buffer.from(expectedHex, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

class CommunityStore {
  constructor() {
    this.pool = null;
    this.available = false;
    this.ready = this.init();
  }

  async init() {
    if (!DATABASE_URL || !Pool) return false;
    const useSsl = String(process.env.PGSSLMODE || '').toLowerCase() === 'require';
    this.pool = new Pool({ connectionString: DATABASE_URL, ssl: useSsl ? { rejectUnauthorized: false } : undefined, max: 8 });
    try {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS community_users (
          id BIGSERIAL PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL DEFAULT '',
          password_hash TEXT,
          google_sub TEXT UNIQUE,
          picture_url TEXT,
          email_verified BOOLEAN NOT NULL DEFAULT FALSE,
          verification_token_hash TEXT,
          verification_expires_at TIMESTAMPTZ,
          reset_token_hash TEXT,
          reset_expires_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        ALTER TABLE community_users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
        ALTER TABLE community_users ADD COLUMN IF NOT EXISTS verification_token_hash TEXT;
        ALTER TABLE community_users ADD COLUMN IF NOT EXISTS verification_expires_at TIMESTAMPTZ;
        ALTER TABLE community_users ADD COLUMN IF NOT EXISTS reset_token_hash TEXT;
        ALTER TABLE community_users ADD COLUMN IF NOT EXISTS reset_expires_at TIMESTAMPTZ;
        CREATE TABLE IF NOT EXISTS community_sessions (
          token_hash TEXT PRIMARY KEY,
          user_id BIGINT NOT NULL REFERENCES community_users(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMPTZ NOT NULL
        );
        CREATE INDEX IF NOT EXISTS community_sessions_user_idx ON community_sessions(user_id);
        CREATE INDEX IF NOT EXISTS community_sessions_exp_idx ON community_sessions(expires_at);
        CREATE TABLE IF NOT EXISTS community_subscriptions (
          id BIGSERIAL PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          user_id BIGINT REFERENCES community_users(id) ON DELETE SET NULL,
          frequency TEXT NOT NULL DEFAULT 'monthly',
          content_type TEXT NOT NULL DEFAULT 'both',
          city TEXT NOT NULL DEFAULT '',
          active BOOLEAN NOT NULL DEFAULT TRUE,
          unsubscribe_token TEXT NOT NULL UNIQUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS community_contacts (
          id BIGSERIAL PRIMARY KEY,
          name TEXT NOT NULL DEFAULT '',
          email TEXT NOT NULL,
          subject TEXT NOT NULL DEFAULT 'General question',
          message TEXT NOT NULL,
          delivered BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS community_feedback (
          id BIGSERIAL PRIMARY KEY,
          helpful BOOLEAN NOT NULL,
          city TEXT NOT NULL DEFAULT '',
          issue TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS community_issue_reports (
          id BIGSERIAL PRIMARY KEY,
          issue_type TEXT NOT NULL,
          city TEXT NOT NULL DEFAULT '',
          neighborhood TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      this.available = true;
      return true;
    } catch (error) {
      console.error('Community database unavailable:', error.message);
      this.available = false;
      return false;
    }
  }

  async ensure() {
    await this.ready;
    if (!this.available || !this.pool) {
      const error = new Error('Accounts are being configured. Please try again later.');
      error.statusCode = 503;
      throw error;
    }
  }

  async query(text, params = []) {
    await this.ensure();
    return this.pool.query(text, params);
  }

  publicUser(row) {
    if (!row) return null;
    return {
      id: String(row.id),
      email: row.email,
      name: row.name || '',
      picture: row.picture_url || '',
      email_verified: !!row.email_verified,
      created_at: row.created_at,
      sign_in_methods: [row.google_sub ? 'google' : null, row.password_hash ? 'email' : null].filter(Boolean)
    };
  }

  async createPasswordUser({ name, email, password }) {
    email = normalizeEmail(email);
    if (!validEmail(email)) throw Object.assign(new Error('Enter a valid email address.'), { statusCode: 400 });
    const passwordHash = await hashPassword(password);
    try {
      const result = await this.query(
        `INSERT INTO community_users(email,name,password_hash,email_verified) VALUES($1,$2,$3,FALSE) RETURNING *`,
        [email, String(name || '').trim().slice(0, 100), passwordHash]
      );
      return result.rows[0];
    } catch (error) {
      if (error.code === '23505') throw Object.assign(new Error('An account already exists for this email.'), { statusCode: 409 });
      throw error;
    }
  }

  async loginPassword({ email, password }) {
    email = normalizeEmail(email);
    const result = await this.query(`SELECT * FROM community_users WHERE email=$1`, [email]);
    const user = result.rows[0];
    if (!user || !user.password_hash || !(await verifyPassword(password, user.password_hash))) {
      throw Object.assign(new Error('Email or password is incorrect.'), { statusCode: 401 });
    }
    await this.query(`UPDATE community_users SET last_login_at=NOW() WHERE id=$1`, [user.id]);
    return user;
  }

  async upsertGoogleUser({ sub, email, name, picture }) {
    email = normalizeEmail(email);
    if (!sub || !validEmail(email)) throw Object.assign(new Error('Google account information was incomplete.'), { statusCode: 400 });
    const existing = await this.query(`SELECT * FROM community_users WHERE email=$1 OR google_sub=$2 LIMIT 1`, [email, sub]);
    if (existing.rows[0]) {
      const row = existing.rows[0];
      const updated = await this.query(
        `UPDATE community_users SET google_sub=COALESCE(google_sub,$2), name=CASE WHEN name='' THEN $3 ELSE name END,
         picture_url=COALESCE(NULLIF($4,''),picture_url), email_verified=TRUE, verification_token_hash=NULL,
         verification_expires_at=NULL,last_login_at=NOW() WHERE id=$1 RETURNING *`,
        [row.id, sub, String(name || '').trim().slice(0, 100), String(picture || '').slice(0, 500)]
      );
      return updated.rows[0];
    }
    const created = await this.query(
      `INSERT INTO community_users(email,name,google_sub,picture_url,email_verified) VALUES($1,$2,$3,$4,TRUE) RETURNING *`,
      [email, String(name || '').trim().slice(0, 100), sub, String(picture || '').slice(0, 500)]
    );
    return created.rows[0];
  }

  async issueVerification(userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await this.query(`UPDATE community_users SET verification_token_hash=$2,verification_expires_at=$3 WHERE id=$1`, [userId, hashToken(token), expires]);
    return { token, expires };
  }

  async verifyEmail(token) {
    const result = await this.query(
      `UPDATE community_users SET email_verified=TRUE,verification_token_hash=NULL,verification_expires_at=NULL
       WHERE verification_token_hash=$1 AND verification_expires_at>NOW() RETURNING *`,
      [hashToken(token)]
    );
    return result.rows[0] || null;
  }

  async issuePasswordReset(email) {
    email = normalizeEmail(email);
    const found = await this.query(`SELECT id,email FROM community_users WHERE email=$1 LIMIT 1`, [email]);
    if (!found.rows[0]) return null;
    const token = crypto.randomBytes(32).toString('base64url');
    const expires = new Date(Date.now() + 60 * 60 * 1000);
    await this.query(`UPDATE community_users SET reset_token_hash=$2,reset_expires_at=$3 WHERE id=$1`, [found.rows[0].id, hashToken(token), expires]);
    return { ...found.rows[0], token, expires };
  }

  async resetPassword(token, password) {
    const passwordHash = await hashPassword(password);
    const result = await this.query(
      `UPDATE community_users SET password_hash=$2,reset_token_hash=NULL,reset_expires_at=NULL
       WHERE reset_token_hash=$1 AND reset_expires_at>NOW() RETURNING *`,
      [hashToken(token), passwordHash]
    );
    if (!result.rows[0]) throw Object.assign(new Error('This reset link is invalid or expired.'), { statusCode: 400 });
    await this.query(`DELETE FROM community_sessions WHERE user_id=$1`, [result.rows[0].id]);
    return result.rows[0];
  }

  async createSession(userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
    await this.query(`DELETE FROM community_sessions WHERE expires_at < NOW()`);
    await this.query(`INSERT INTO community_sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)`, [hashToken(token), userId, expires]);
    return { token, expires };
  }

  async userFromSession(token) {
    if (!token) return null;
    try {
      const result = await this.query(
        `SELECT u.* FROM community_sessions s JOIN community_users u ON u.id=s.user_id
         WHERE s.token_hash=$1 AND s.expires_at>NOW() LIMIT 1`,
        [hashToken(token)]
      );
      return result.rows[0] || null;
    } catch { return null; }
  }

  async logout(token) {
    if (!token) return;
    await this.query(`DELETE FROM community_sessions WHERE token_hash=$1`, [hashToken(token)]);
  }

  async deleteUser(userId) {
    await this.query(`DELETE FROM community_users WHERE id=$1`, [userId]);
  }

  async upsertSubscription({ email, userId = null, frequency = 'monthly', contentType = 'both', city = '' }) {
    email = normalizeEmail(email);
    if (!validEmail(email)) throw Object.assign(new Error('Enter a valid email address.'), { statusCode: 400 });
    frequency = ['weekly', 'monthly'].includes(frequency) ? frequency : 'monthly';
    contentType = ['water-report', 'alerts-media', 'both'].includes(contentType) ? contentType : 'both';
    const token = crypto.randomBytes(24).toString('base64url');
    const result = await this.query(
      `INSERT INTO community_subscriptions(email,user_id,frequency,content_type,city,active,unsubscribe_token)
       VALUES($1,$2,$3,$4,$5,TRUE,$6)
       ON CONFLICT(email) DO UPDATE SET user_id=COALESCE(EXCLUDED.user_id,community_subscriptions.user_id),
       frequency=EXCLUDED.frequency,content_type=EXCLUDED.content_type,city=EXCLUDED.city,active=TRUE,updated_at=NOW()
       RETURNING *`,
      [email, userId, frequency, contentType, String(city || '').trim().slice(0, 80), token]
    );
    return result.rows[0];
  }

  async subscriptionForEmail(email) {
    const result = await this.query(`SELECT * FROM community_subscriptions WHERE email=$1 LIMIT 1`, [normalizeEmail(email)]);
    return result.rows[0] || null;
  }

  async unsubscribe(token) {
    const result = await this.query(`UPDATE community_subscriptions SET active=FALSE,updated_at=NOW() WHERE unsubscribe_token=$1 RETURNING id`, [String(token || '')]);
    return !!result.rows[0];
  }

  async addContact({ name, email, subject, message }) {
    const result = await this.query(
      `INSERT INTO community_contacts(name,email,subject,message) VALUES($1,$2,$3,$4) RETURNING id`,
      [String(name || '').trim().slice(0,100), normalizeEmail(email), String(subject || 'General question').slice(0,120), String(message || '').trim().slice(0,5000)]
    );
    return result.rows[0].id;
  }

  async markContactDelivered(id) {
    await this.query(`UPDATE community_contacts SET delivered=TRUE WHERE id=$1`, [id]);
  }

  async addFeedback({ helpful, city = '', issue = '' }) {
    await this.query(`INSERT INTO community_feedback(helpful,city,issue) VALUES($1,$2,$3)`, [!!helpful, String(city).slice(0,80), String(issue).slice(0,80)]);
  }

  async addIssueReport({ issueType, city = '', neighborhood = '', notes = '' }) {
    await this.query(`INSERT INTO community_issue_reports(issue_type,city,neighborhood,notes) VALUES($1,$2,$3,$4)`, [String(issueType || '').slice(0,80), String(city).slice(0,80), String(neighborhood).slice(0,120), String(notes).slice(0,1000)]);
  }

  async stats() {
    await this.ensure();
    const result = await this.pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM community_users) AS accounts,
        (SELECT COUNT(*)::int FROM community_users WHERE email_verified=TRUE) AS verified_accounts,
        (SELECT COUNT(*)::int FROM community_subscriptions WHERE active=TRUE) AS subscribers,
        (SELECT COUNT(*)::int FROM community_contacts) AS contact_messages,
        (SELECT COUNT(*)::int FROM community_issue_reports) AS issue_reports,
        (SELECT COUNT(*)::int FROM community_feedback) AS feedback_total,
        (SELECT COUNT(*)::int FROM community_feedback WHERE helpful=TRUE) AS feedback_helpful
    `);
    return result.rows[0];
  }

  async digestRecipients(frequency) {
    const result = await this.query(`SELECT email,frequency,content_type,city,unsubscribe_token FROM community_subscriptions WHERE active=TRUE AND frequency=$1 ORDER BY id`, [frequency]);
    return result.rows;
  }
}

module.exports = { CommunityStore, normalizeEmail, validEmail, hashPassword, verifyPassword };

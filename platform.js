'use strict';

const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { fork } = require('node:child_process');
const { CommunityStore, normalizeEmail, validEmail } = require('./lib/community_store');
const { CommunityMailer } = require('./lib/community_mailer');

let OAuth2Client;
try { ({ OAuth2Client } = require('google-auth-library')); } catch { OAuth2Client = null; }

const PORT = Number(process.env.PORT || 3000);
const CORE_PORT = Number(process.env.INTERNAL_APP_PORT || (PORT + 1));
const store = new CommunityStore();
const mailer = new CommunityMailer();
const googleClientId = String(process.env.GOOGLE_CLIENT_ID || '');
const googleClient = OAuth2Client && googleClientId ? new OAuth2Client(googleClientId) : null;
const SESSION_COOKIE = 'water_session';
const allowedCities = [
  'Sanford','Lake Mary','Oviedo','Winter Springs','Casselberry','Longwood','Altamonte Springs',
  'Geneva','Chuluota','Heathrow','Winter Park','Maitland','Orlando','Apopka'
];
const rateBuckets = new Map();

const child = fork(path.join(__dirname, 'server.js'), [], {
  env: { ...process.env, PORT: String(CORE_PORT) },
  stdio: 'inherit'
});
child.on('exit', code => {
  if (code !== 0) console.error(`Core water service exited with code ${code}`);
  process.exit(code || 0);
});

function publicCsp() {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://accounts.google.com/gsi/client",
    "connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://analytics.google.com https://www.googletagmanager.com https://stats.g.doubleclick.net https://accounts.google.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://www.google-analytics.com https://*.google-analytics.com https://www.googletagmanager.com https://lh3.googleusercontent.com",
    "frame-src https://accounts.google.com",
    "form-action 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'"
  ].join('; ');
}

function commonHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', publicCsp());
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
}

function json(res, status, body, headers = {}) {
  commonHeaders(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function redirect(res, location) {
  commonHeaders(res);
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

function parseCookies(req) {
  const cookies = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

function isSecureRequest(req) {
  return String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https' ||
    String(process.env.PUBLIC_BASE_URL || '').startsWith('https://') || process.env.NODE_ENV === 'production';
}

function sessionCookie(req, token, expires) {
  const maxAge = Math.max(0, Math.floor((new Date(expires).getTime() - Date.now()) / 1000));
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isSecureRequest(req) ? '; Secure' : ''}`;
}

function clearSessionCookie(req) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isSecureRequest(req) ? '; Secure' : ''}`;
}

function requestIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}

function rateAllowed(req, bucket, limit, windowMs) {
  const key = `${bucket}:${requestIp(req)}`;
  const now = Date.now();
  let entry = rateBuckets.get(key);
  if (!entry || now >= entry.reset) entry = { count: 0, reset: now + windowMs };
  entry.count += 1;
  rateBuckets.set(key, entry);
  if (rateBuckets.size > 10000) {
    for (const [k, value] of rateBuckets) if (now >= value.reset) rateBuckets.delete(k);
  }
  return entry.count <= limit;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const expectedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
    return new URL(origin).host.toLowerCase() === expectedHost;
  } catch { return false; }
}

function readJson(req, maxBytes = 65536) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      body += chunk;
      if (body.length > maxBytes) reject(Object.assign(new Error('Request is too large.'), { statusCode: 413 }));
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(Object.assign(new Error('Invalid request.'), { statusCode: 400 }));
    });
    req.on('error', reject);
  });
}

async function currentUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  return store.userFromSession(token);
}

async function createUserSession(req, res, user) {
  const session = await store.createSession(user.id);
  json(res, 200, { ok: true, user: store.publicUser(user) }, { 'Set-Cookie': sessionCookie(req, session.token, session.expires) });
}

function cleanCity(value) {
  const raw = String(value || '').trim();
  return allowedCities.find(city => city.toLowerCase() === raw.toLowerCase()) || raw.slice(0, 80);
}

function fetchJson(urlString, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const target = new URL(urlString);
    const request = https.get(target, { family: 4, headers: { 'User-Agent': 'IsMyWaterOK/14.0', Accept: 'application/json' } }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; if (body.length > 1_000_000) request.destroy(new Error('response too large')); });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) return reject(new Error(`HTTP ${response.statusCode}`));
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('request timed out')));
    request.on('error', reject);
  });
}

async function addressSuggestions(query, cityHint) {
  const text = String(query || '').replace(/[\r\n\t]/g, ' ').trim().slice(0, 120);
  if (text.length < 3) return [];
  const params = new URLSearchParams({
    f: 'json',
    text: cityHint ? `${text}, ${cityHint}, FL` : `${text}, Seminole County, FL`,
    countryCode: 'USA',
    maxSuggestions: '8',
    returnCollections: 'false',
    location: '-81.27,28.72',
    searchExtent: '-81.55,28.56,-80.90,29.08'
  });
  const data = await fetchJson(`https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/suggest?${params}`);
  const results = [];
  for (const suggestion of data.suggestions || []) {
    const label = String(suggestion.text || '');
    const parts = label.split(',').map(x => x.trim());
    if (parts.length < 2 || !/\bFL\b|Florida/i.test(label)) continue;
    const city = parts.find(part => allowedCities.some(c => c.toLowerCase() === part.toLowerCase())) || parts[1] || '';
    const street = parts[0] || label;
    if (!street || !city) continue;
    results.push({ label, street, city });
    if (results.length >= 6) break;
  }
  return results;
}

function proxyToCore(req, res) {
  const headers = { ...req.headers, host: `127.0.0.1:${CORE_PORT}` };
  const upstream = http.request({ hostname: '127.0.0.1', port: CORE_PORT, path: req.url, method: req.method, headers }, upstreamRes => {
    const responseHeaders = { ...upstreamRes.headers };
    responseHeaders['content-security-policy'] = publicCsp();
    responseHeaders['referrer-policy'] = 'strict-origin-when-cross-origin';
    responseHeaders['permissions-policy'] = 'geolocation=(), camera=(), microphone=()';
    res.writeHead(upstreamRes.statusCode || 502, responseHeaders);
    upstreamRes.pipe(res);
  });
  upstream.on('error', error => json(res, 502, { error: 'Water service is restarting. Please refresh in a moment.', detail: process.env.NODE_ENV === 'production' ? undefined : error.message }));
  req.pipe(upstream);
}

function coreImpact() {
  return new Promise(resolve => {
    const request = http.get({ hostname: '127.0.0.1', port: CORE_PORT, path: '/api/impact' }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { resolve({}); }
      });
    });
    request.setTimeout(2500, () => { request.destroy(); resolve({}); });
    request.on('error', () => resolve({}));
  });
}

const server = http.createServer(async (req, res) => {
  const target = new URL(req.url, 'http://localhost');
  const pathname = target.pathname;

  if (pathname === '/impact.html') return redirect(res, '/');
  if ((pathname === '/api/impact' || pathname === '/api/community/impact') && req.method === 'GET') {
    return json(res, 404, { error: 'Not found.' });
  }

  if (pathname === '/api/community/config' && req.method === 'GET') {
    await store.ready;
    return json(res, 200, {
      accounts_enabled: store.available,
      google_enabled: !!googleClient,
      google_client_id: googleClientId || '',
      contact_enabled: mailer.configured && !!process.env.CONTACT_TO_EMAIL,
      mailing_enabled: store.available && mailer.configured
    });
  }

  if (pathname === '/api/address-suggest' && req.method === 'GET') {
    if (!rateAllowed(req, 'suggest', 80, 60000)) return json(res, 429, { suggestions: [] });
    try {
      const suggestions = await addressSuggestions(target.searchParams.get('q'), target.searchParams.get('city'));
      return json(res, 200, { suggestions });
    } catch {
      return json(res, 200, { suggestions: [] });
    }
  }

  if (pathname === '/api/auth/me' && req.method === 'GET') {
    await store.ready;
    if (!store.available) return json(res, 200, { user: null, accounts_enabled: false });
    const user = await currentUser(req);
    const subscription = user ? await store.subscriptionForEmail(user.email).catch(() => null) : null;
    return json(res, 200, {
      user: store.publicUser(user),
      accounts_enabled: true,
      subscription: subscription ? { frequency: subscription.frequency, content_type: subscription.content_type, city: subscription.city, active: subscription.active } : null
    });
  }

  if (pathname === '/api/auth/signup' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'Request blocked.' });
    if (!rateAllowed(req, 'signup', 10, 10 * 60000)) return json(res, 429, { error: 'Too many signup attempts. Try again later.' });
    try {
      const body = await readJson(req);
      const user = await store.createPasswordUser(body);
      const verification = await store.issueVerification(user.id);
      if (mailer.configured) await mailer.sendVerification({ email: user.email, token: verification.token }).catch(error => console.error('Verification email failed:', error.message));
      if (['weekly','monthly'].includes(body.newsletter_frequency)) {
        const subscription = await store.upsertSubscription({ email: user.email, userId: user.id, frequency: body.newsletter_frequency, contentType: body.content_type, city: cleanCity(body.city) });
        if (mailer.configured) await mailer.sendWelcome({ email: user.email, frequency: subscription.frequency, contentType: subscription.content_type, city: cleanCity(body.city), unsubscribeToken: subscription.unsubscribe_token }).catch(() => {});
      }
      return createUserSession(req, res, user);
    } catch (error) { return json(res, error.statusCode || 500, { error: error.message || 'Could not create account.' }); }
  }

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'Request blocked.' });
    if (!rateAllowed(req, 'login', 25, 10 * 60000)) return json(res, 429, { error: 'Too many sign-in attempts. Try again later.' });
    try {
      const body = await readJson(req);
      const user = await store.loginPassword(body);
      return createUserSession(req, res, user);
    } catch (error) { return json(res, error.statusCode || 500, { error: error.message || 'Could not sign in.' }); }
  }

  if (pathname === '/api/auth/google' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'Request blocked.' });
    if (!googleClient) return json(res, 503, { error: 'Google sign-in is not configured yet.' });
    if (!rateAllowed(req, 'google-login', 30, 10 * 60000)) return json(res, 429, { error: 'Too many sign-in attempts. Try again later.' });
    try {
      const body = await readJson(req);
      const ticket = await googleClient.verifyIdToken({ idToken: String(body.credential || ''), audience: googleClientId });
      const payload = ticket.getPayload();
      if (!payload || !payload.sub || !payload.email || payload.email_verified !== true) throw Object.assign(new Error('Google could not verify this email address.'), { statusCode: 401 });
      const user = await store.upsertGoogleUser({ sub: payload.sub, email: payload.email, name: payload.name, picture: payload.picture });
      return createUserSession(req, res, user);
    } catch (error) { return json(res, error.statusCode || 401, { error: 'Google sign-in could not be completed.' }); }
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'Request blocked.' });
    const token = parseCookies(req)[SESSION_COOKIE];
    if (token) await store.logout(token).catch(() => {});
    return json(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie(req) });
  }

  if (pathname === '/api/auth/verify' && req.method === 'GET') {
    try {
      const user = await store.verifyEmail(target.searchParams.get('token'));
      return redirect(res, user ? '/account.html?verified=1' : '/account.html?verified=0');
    } catch { return redirect(res, '/account.html?verified=0'); }
  }

  if (pathname === '/api/auth/resend-verification' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'Request blocked.' });
    try {
      const user = await currentUser(req);
      if (!user) return json(res, 401, { error: 'Sign in first.' });
      if (user.email_verified) return json(res, 200, { ok: true, already_verified: true });
      if (!mailer.configured) return json(res, 503, { error: 'Email delivery is not configured yet.' });
      const verification = await store.issueVerification(user.id);
      await mailer.sendVerification({ email: user.email, token: verification.token });
      return json(res, 200, { ok: true });
    } catch (error) { return json(res, error.statusCode || 500, { error: error.message || 'Could not send verification email.' }); }
  }

  if (pathname === '/api/auth/forgot-password' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'Request blocked.' });
    if (!rateAllowed(req, 'forgot-password', 8, 30 * 60000)) return json(res, 429, { error: 'Try again later.' });
    try {
      const body = await readJson(req);
      if (validEmail(body.email) && mailer.configured) {
        const reset = await store.issuePasswordReset(body.email);
        if (reset) await mailer.sendPasswordReset({ email: reset.email, token: reset.token }).catch(() => {});
      }
      return json(res, 200, { ok: true, message: 'If that email has an account, a reset link will be sent.' });
    } catch { return json(res, 200, { ok: true, message: 'If that email has an account, a reset link will be sent.' }); }
  }

  if (pathname === '/api/auth/reset-password' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'Request blocked.' });
    try {
      const body = await readJson(req);
      const user = await store.resetPassword(body.token, body.password);
      return createUserSession(req, res, user);
    } catch (error) { return json(res, error.statusCode || 500, { error: error.message || 'Could not reset password.' }); }
  }

  if (pathname === '/api/auth/preferences' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'Request blocked.' });
    try {
      const user = await currentUser(req);
      if (!user) return json(res, 401, { error: 'Sign in first.' });
      const body = await readJson(req);
      if (body.frequency === 'none') {
        const existing = await store.subscriptionForEmail(user.email);
        if (existing) await store.unsubscribe(existing.unsubscribe_token);
        return json(res, 200, { ok: true, subscription: { active: false } });
      }
      const subscription = await store.upsertSubscription({ email: user.email, userId: user.id, frequency: body.frequency, contentType: body.content_type, city: cleanCity(body.city) });
      return json(res, 200, { ok: true, subscription: { active: true, frequency: subscription.frequency, content_type: subscription.content_type, city: subscription.city } });
    } catch (error) { return json(res, error.statusCode || 500, { error: error.message || 'Could not save preferences.' }); }
  }

  if (pathname === '/api/auth/account' && req.method === 'DELETE') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'Request blocked.' });
    try {
      const user = await currentUser(req);
      if (!user) return json(res, 401, { error: 'Sign in first.' });
      await store.deleteUser(user.id);
      return json(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie(req) });
    } catch (error) { return json(res, error.statusCode || 500, { error: error.message || 'Could not delete account.' }); }
  }

  if (pathname === '/api/subscribe' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'Request blocked.' });
    if (!rateAllowed(req, 'subscribe', 12, 10 * 60000)) return json(res, 429, { error: 'Too many requests. Try again later.' });
    try {
      const body = await readJson(req);
      const user = await currentUser(req);
      const email = normalizeEmail(body.email || user?.email);
      const subscription = await store.upsertSubscription({ email, userId: user?.id || null, frequency: body.frequency, contentType: body.content_type, city: cleanCity(body.city) });
      if (mailer.configured) await mailer.sendWelcome({ email, frequency: subscription.frequency, contentType: subscription.content_type, city: subscription.city, unsubscribeToken: subscription.unsubscribe_token }).catch(() => {});
      return json(res, 200, { ok: true, frequency: subscription.frequency, content_type: subscription.content_type, city: subscription.city });
    } catch (error) { return json(res, error.statusCode || 500, { error: error.message || 'Could not sign you up.' }); }
  }

  if (pathname === '/api/unsubscribe' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'Request blocked.' });
    try {
      const body = await readJson(req);
      const ok = await store.unsubscribe(body.token);
      return json(res, ok ? 200 : 400, { ok, error: ok ? undefined : 'This unsubscribe link is invalid or already inactive.' });
    } catch (error) { return json(res, error.statusCode || 500, { error: error.message || 'Could not unsubscribe.' }); }
  }

  if (pathname === '/api/contact' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'Request blocked.' });
    if (!rateAllowed(req, 'contact', 5, 10 * 60000)) return json(res, 429, { error: 'Too many messages. Please try again later.' });
    try {
      const body = await readJson(req);
      if (body.website) return json(res, 200, { ok: true });
      const email = normalizeEmail(body.email);
      const message = String(body.message || '').trim();
      if (!validEmail(email)) return json(res, 400, { error: 'Enter a valid email address.' });
      if (message.length < 5) return json(res, 400, { error: 'Write a short message first.' });
      let contactId = null;
      if (store.available) contactId = await store.addContact({ name: body.name, email, subject: body.subject, message }).catch(() => null);
      const delivery = await mailer.sendContact({ name: body.name, email, subject: body.subject, message });
      if (!delivery.sent) return json(res, 503, { error: 'Message delivery is being configured. Please try again soon.' });
      if (contactId) await store.markContactDelivered(contactId).catch(() => {});
      if (body.newsletter === true && store.available) {
        const subscription = await store.upsertSubscription({ email, frequency: body.frequency, contentType: body.content_type, city: cleanCity(body.city) });
        if (mailer.configured) await mailer.sendWelcome({ email, frequency: subscription.frequency, contentType: subscription.content_type, city: subscription.city, unsubscribeToken: subscription.unsubscribe_token }).catch(() => {});
      }
      return json(res, 200, { ok: true, message: 'Your message was sent.' });
    } catch (error) { return json(res, error.statusCode || 500, { error: error.message || 'Could not send your message.' }); }
  }

  if (pathname === '/api/feedback' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'Request blocked.' });
    if (!rateAllowed(req, 'feedback', 20, 60000)) return json(res, 429, { error: 'Too many requests.' });
    try {
      const body = await readJson(req);
      await store.addFeedback({ helpful: body.helpful, city: cleanCity(body.city), issue: body.issue });
      return json(res, 200, { ok: true });
    } catch (error) { return json(res, error.statusCode || 500, { error: error.message || 'Could not save feedback.' }); }
  }

  if (pathname === '/api/report-issue' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'Request blocked.' });
    if (!rateAllowed(req, 'issue-report', 10, 10 * 60000)) return json(res, 429, { error: 'Too many reports. Try again later.' });
    try {
      const body = await readJson(req);
      const allowedIssues = ['cloudy-discolored','chlorine-smell','sulfur-smell','metallic-taste','low-pressure','lead-old-home','private-well','boil-alert','pfas','dioxane','other'];
      if (!allowedIssues.includes(body.issue_type)) return json(res, 400, { error: 'Choose an issue type.' });
      await store.addIssueReport({ issueType: body.issue_type, city: cleanCity(body.city), neighborhood: body.neighborhood, notes: body.notes });
      return json(res, 200, { ok: true, message: 'Thanks. Your anonymous report was recorded.' });
    } catch (error) { return json(res, error.statusCode || 500, { error: error.message || 'Could not record the report.' }); }
  }

  if (pathname === '/api/community/stats' && req.method === 'GET') {
    try {
      const stats = await store.stats();
      return json(res, 200, { configured: true, ...stats, helpful_percent: stats.feedback_total ? Math.round(stats.feedback_helpful / stats.feedback_total * 100) : null });
    } catch {
      return json(res, 200, { configured: false, accounts: 0, verified_accounts: 0, subscribers: 0, contact_messages: 0, issue_reports: 0, feedback_total: 0, feedback_helpful: 0, helpful_percent: null });
    }
  }

  if (pathname === '/api/community/impact' && req.method === 'GET') {
    const [impact, community] = await Promise.all([coreImpact(), store.stats().catch(() => ({}))]);
    return json(res, 200, { ...impact, ...community, helpful_percent: community.feedback_total ? Math.round(community.feedback_helpful / community.feedback_total * 100) : null });
  }

  return proxyToCore(req, res);
});

server.on('error', error => {
  if (error.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use.`);
  else console.error(error);
  process.exit(1);
});

function shutdown(signal) {
  console.log(`${signal} received: closing community gateway.`);
  try { child.kill('SIGTERM'); } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(PORT, () => {
  console.log(`IsMyWaterOK community gateway running at http://localhost:${PORT}; water core on ${CORE_PORT}.`);
  store.ready.then(() => console.log(`Community database: ${store.available ? 'ready' : 'not configured'}. Mail: ${mailer.configured ? 'ready' : 'not configured'}. Google: ${googleClient ? 'ready' : 'not configured'}.`));
});

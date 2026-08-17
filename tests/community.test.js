'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const index = read('public/index.html');
const account = read('public/account.html');
const accountJs = read('public/account.js');
const contact = read('public/contact.html');
const feedback = read('public/feedback.html');
const feedbackJs = read('public/feedback.js');
const feedbackEntry = read('public/feedback-entry.js');
const community = read('public/community.js');
const platform = read('platform.js');
const store = read('lib/community_store.js');
const mailer = read('lib/community_mailer.js');
const pkg = JSON.parse(read('package.json'));

function publicText() {
  return fs.readdirSync(publicDir)
    .filter(name => /\.(html|js|css)$/.test(name))
    .map(name => fs.readFileSync(path.join(publicDir, name), 'utf8'))
    .join('\n');
}

test('production starts through the community gateway', () => {
  assert.equal(pkg.scripts.start, 'node platform.js');
  assert.ok(pkg.dependencies.pg);
  assert.ok(pkg.dependencies.nodemailer);
  assert.ok(pkg.dependencies['google-auth-library']);
});

test('home address starts blank and provides accessible autocomplete', () => {
  assert.match(index, /<input id="address" required autocomplete="off">/);
  assert.doesNotMatch(index, /4301 Foggy Oak/i);
  assert.match(community, /aria-autocomplete/);
  assert.match(community, /role=\\?"listbox/);
  assert.match(community, /\/api\/address-suggest/);
  assert.match(community, /ArrowDown/);
  assert.match(community, /ArrowUp/);
  assert.match(community, /Escape/);
});

test('Google account sign-in uses one Google Identity Services initialization', () => {
  assert.match(account, /Sign in with Google or email/);
  assert.match(account, /\/account\.js/);
  assert.doesNotMatch(account, /\/community\.js/);
  assert.match(accountJs, /accounts\.id\.initialize/);
  assert.match(accountJs, /accounts\.id\.renderButton/);
  assert.equal((accountJs.match(/accounts\.id\.initialize/g) || []).length, 1);
  assert.match(accountJs, /credential: response\.credential/);
  assert.match(accountJs, /\/api\/auth\/google/);
  assert.match(platform, /verifyIdToken/);
  assert.match(platform, /payload\.sub/);
  assert.match(platform, /audience: googleClientId/);
  assert.match(platform, /HttpOnly/);
  assert.match(platform, /SameSite=Lax/);
});

test('email accounts retain secure password and verification flows', () => {
  assert.match(store, /crypto\.scrypt/);
  assert.match(store, /email_verified/);
  assert.match(platform, /\/api\/auth\/forgot-password/);
  assert.match(platform, /\/api\/auth\/reset-password/);
  assert.match(accountJs, /\/api\/auth\/signup/);
  assert.match(accountJs, /\/api\/auth\/login/);
});

test('contact recipient is never exposed to browser files', () => {
  assert.doesNotMatch(publicText(), /nish\.lakemary@gmail\.com/i);
  assert.doesNotMatch(publicText(), /CONTACT_TO_EMAIL/);
  assert.match(mailer, /CONTACT_TO_EMAIL/);
  assert.match(contact, /contact-form/);
  assert.match(platform, /\/api\/contact/);
  assert.match(mailer, /replyTo: email/);
});

test('proper detailed feedback channel is visible and privately delivered', () => {
  assert.match(feedback, /Tell us what worked—or what did not/);
  assert.match(feedback, /feedback-type/);
  assert.match(feedback, /name="rating"/);
  assert.match(feedback, /feedback-message/);
  assert.match(feedbackJs, /\/api\/contact/);
  assert.match(feedbackJs, /Website feedback/);
  assert.match(feedbackJs, /\/api\/feedback/);
  assert.match(feedbackEntry, /Tell us more/);
  assert.match(feedbackEntry, /from=water-result/);
  assert.match(index, /feedback-entry\.js/);
});

test('mailing list is explicit and supports weekly or monthly updates', () => {
  assert.match(community, /water_updates_subscribed/);
  assert.match(community, /value=\\?"weekly/);
  assert.match(community, /value=\\?"monthly/);
  assert.match(platform, /\/api\/subscribe/);
  assert.match(platform, /\/api\/unsubscribe/);
  assert.match(store, /water-report/);
  assert.match(store, /alerts-media/);
  assert.match(store, /both/);
});

test('community metrics expose aggregate account and subscriber counts only', () => {
  assert.match(platform, /\/api\/community\/impact/);
  assert.match(store, /verified_accounts/);
  assert.match(store, /subscribers/);
  assert.match(community, /accounts created/);
  assert.match(community, /verified accounts/);
  assert.doesNotMatch(community, /community_contacts.*email/);
});

test('anonymous resident reports are persisted without a street-address field', () => {
  assert.match(platform, /\/api\/report-issue/);
  assert.match(store, /community_issue_reports/);
  assert.match(community, /anonymous report/);
  assert.doesNotMatch(store, /community_issue_reports[\s\S]{0,500}street_address/i);
});

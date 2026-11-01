'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { publicErrorBody } = require('../lib/public_errors');

test('gateway errors cannot disclose provider details, secrets, or stack traces', () => {
  for (const status of [400, 401, 403, 404, 409, 429, 500, 502, 503]) {
    const body = publicErrorBody(status, {
      error: 'password authentication failed for user secret-user at postgres://secret',
      detail: 'SMTP token secret-key', stack: '/app/lib/community_store.js:88',
      provider_response: { key: 'private' }
    });
    assert.deepEqual(Object.keys(body), ['error']);
    assert.doesNotMatch(body.error, /secret|postgres|SMTP|private|community_store/);
  }
});

test('residents retain useful validation and sign-in instructions', () => {
  for (const error of ['Enter a valid email address.', 'Password must be at least 8 characters.', 'Email or password is incorrect.', 'This reset link is invalid or expired.']) {
    assert.deepEqual(publicErrorBody(400, { error }), { error });
  }
  const success = { ok: true, user: { name: 'Resident' } };
  assert.equal(publicErrorBody(200, success), success);
  assert.match(publicErrorBody(429, {}).error, /wait a moment/);
});

test('community, feedback and account pages replace browser connection exceptions with plain help', async () => {
  for (const name of ['community', 'feedback', 'account']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'public', name + '.js'), 'utf8');
    const match = source.match(/  async function api\(url, options = \{\}\) \{[\s\S]+?\n  \}/);
    assert.ok(match, name);
    const api = vm.runInNewContext('(' + match[0].trim().replace('async function api', 'async function') + ')', {
      fetch: async () => { throw new TypeError('NetworkError internal transport details'); },
      t: english => english
    });
    await assert.rejects(api('/api/contact'), { message: 'Please check your connection and try again.' });
    const malformedApi = vm.runInNewContext('(' + match[0].trim().replace('async function api', 'async function') + ')', {
      fetch: async () => ({ ok: true, json: async () => { throw new SyntaxError('Unexpected < in upstream HTML'); } }),
      t: english => english
    });
    await assert.rejects(malformedApi('/api/contact'), { message: 'We could not finish that. Please try again.' });
  }
});

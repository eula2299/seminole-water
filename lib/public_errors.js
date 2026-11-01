'use strict';

// Only reviewed, resident-facing messages may cross the gateway boundary.
// Database, mail-provider and parser exceptions stay on the server.
const messages = new Set([
  'Enter a valid email address.',
  'Password must be at least 8 characters.',
  'An account already exists for this email.',
  'Email or password is incorrect.',
  'This reset link is invalid or expired.',
  'This unsubscribe link is invalid or already inactive.',
  'Write a short message first.',
  'Choose an issue type.',
  'Sign in first.',
  'Google sign-in could not be completed.'
]);

function publicErrorBody(status, body) {
  if (status < 400) return body;
  const message = typeof body?.error === 'string' ? body.error : '';
  let error = 'We could not finish that. Please try again.';
  if (messages.has(message)) error = message;
  else if (status === 429) error = 'Please wait a moment, then try again.';
  else if (status === 401) error = 'Please sign in and try again.';
  else if (status === 403) error = 'Please refresh this page and try again.';
  else if (status === 404) error = 'We could not find that page.';
  // Do not forward provider responses, stack traces, detail or other fields.
  return { error };
}

module.exports = { publicErrorBody };

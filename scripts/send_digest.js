'use strict';

const { CommunityStore } = require('../lib/community_store');
const { CommunityMailer } = require('../lib/community_mailer');

async function main() {
  const frequency = String(process.argv[2] || '').toLowerCase();
  if (!['weekly', 'monthly'].includes(frequency)) {
    console.error('Usage: node scripts/send_digest.js weekly|monthly');
    process.exit(2);
  }

  const store = new CommunityStore();
  const mailer = new CommunityMailer();
  await store.ready;
  if (!store.available) throw new Error('DATABASE_URL is not configured or the community database is unavailable.');
  if (!mailer.configured) throw new Error('Mail delivery is not configured.');

  const recipients = await store.digestRecipients(frequency);
  let sent = 0;
  let failed = 0;
  for (const recipient of recipients) {
    try {
      const result = await mailer.sendDigest(recipient, frequency);
      if (result.sent) sent += 1; else failed += 1;
    } catch (error) {
      failed += 1;
      console.error(`Failed for ${recipient.email}: ${error.message}`);
    }
  }
  console.log(JSON.stringify({ frequency, recipients: recipients.length, sent, failed }));
  if (failed) process.exitCode = 1;
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});

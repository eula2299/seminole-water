# IsMyWaterOK Community Features — Railway Setup

This release adds persistent user accounts, Google sign-in, private Contact Us delivery, weekly/monthly water emails, address autocomplete, aggregate account metrics, resident feedback, and anonymous issue reports.

The public repository intentionally contains **no private receiving email address, mail password, Google secret, refresh token, or database password**. These belong in Railway Variables only.

## 1. Add PostgreSQL

In the Railway project, add a PostgreSQL service. In the web service, add a reference variable:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

The application creates its community tables automatically when it starts. No manual migration command is required for this release.

## 2. Public URL

Set the canonical production URL:

```text
PUBLIC_BASE_URL=https://YOUR-DOMAIN
NODE_ENV=production
```

This is used to build email verification, password-reset, and unsubscribe links.

## 3. Google sign-in

Create a Google OAuth 2.0 **Web application** client and add the production website under Authorized JavaScript origins. If a Railway preview/domain will be used for testing, add that origin too.

Set this Railway variable on the web service:

```text
GOOGLE_CLIENT_ID=YOUR_WEB_CLIENT_ID.apps.googleusercontent.com
```

The browser only receives the client ID. The server verifies the signed Google ID token and uses Google's stable account subject identifier as the login identity.

## 4. Contact Us destination

Set the private receiving inbox in Railway:

```text
CONTACT_TO_EMAIL=YOUR_PRIVATE_RECEIVING_INBOX
```

Do not put the address in HTML, JavaScript, documentation screenshots, or public repository files. Visitors only see the Contact Us form.

## 5. Outgoing email

### Quick Gmail setup

Use a Gmail account with 2-Step Verification and an app password:

```text
MAIL_USER=YOUR_SENDER_GMAIL
MAIL_APP_PASSWORD=YOUR_APP_PASSWORD
MAIL_FROM=YOUR_SENDER_GMAIL
```

### Gmail OAuth2 setup

For a longer-term OAuth2 setup:

```text
MAIL_USER=YOUR_SENDER_GMAIL
MAIL_FROM=YOUR_SENDER_GMAIL
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=...
```

### Generic SMTP alternative

```text
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_SECURE=false
MAIL_FROM=...
```

Only one mail method is needed.

Email is used for:
- contact-form delivery;
- account email verification;
- password-reset links;
- subscription confirmation;
- weekly/monthly water updates.

## 6. Scheduled water emails

Create two Railway scheduled services from the same GitHub repository. Give each the same `DATABASE_URL`, mail variables, and `PUBLIC_BASE_URL` as the web app.

### Weekly service

Start command:

```text
npm run mail:weekly
```

Example schedule, Monday 8:00 AM UTC:

```text
0 8 * * 1
```

### Monthly service

Start command:

```text
npm run mail:monthly
```

Example schedule, first day of the month at 8:00 AM UTC:

```text
0 8 1 * *
```

Railway cron schedules use UTC. The digest script exits when sending is complete so the next scheduled run can occur.

## 7. What to verify after deploy

Open these pages/routes in production:

```text
/account.html
/contact.html
/impact.html
/api/community/config
```

Then verify:

1. Address field starts blank.
2. Typing at least 3 address characters shows Seminole-area suggestions.
3. Email account signup succeeds and verification email arrives.
4. Google sign-in succeeds.
5. `/impact.html` increments account totals after creating an account.
6. Contact form delivers privately to the configured receiving inbox.
7. Weekly/monthly subscription confirmation arrives.
8. Unsubscribe link stops the subscription.
9. Password-reset email works.
10. Water lookup works exactly as before through the gateway.

## 8. Privacy behavior

- Account passwords are stored as scrypt hashes, never plaintext.
- Login sessions use opaque HttpOnly cookies and hashed database session tokens.
- Public impact pages display aggregate counts only.
- Anonymous water-issue reports do not store street addresses.
- Contact messages are private and are not displayed on the public impact page.
- A water lookup does not require an account.

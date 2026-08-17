'use strict';

(function () {
  const originalFetch = window.fetch.bind(window);
  let communityConfig = null;

  async function getConfig() {
    if (communityConfig) return communityConfig;
    try {
      const response = await originalFetch('/api/community/config', { credentials: 'same-origin' });
      communityConfig = response.ok ? await response.json() : null;
    } catch {
      communityConfig = null;
    }
    return communityConfig;
  }

  getConfig();

  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : String(input?.url || '');
    const response = await originalFetch(input, init);
    if (!url.includes('/api/auth/google') || response.ok) return response;

    let payload = {};
    try { payload = await response.clone().json(); } catch {}
    if (payload.error && payload.error !== 'Google sign-in could not be completed.') return response;

    const config = await getConfig();
    let error = 'Google sign-in failed. Check that your Google OAuth client is a Web application and that this exact website domain is listed under Authorized JavaScript origins.';

    if (config && config.accounts_enabled === false) {
      error = 'Google verified the sign-in, but account storage is not configured. Add Railway Postgres and set DATABASE_URL on the website service, then redeploy.';
    } else if (config && config.google_enabled === false) {
      error = 'Google sign-in is not configured on the server. Add GOOGLE_CLIENT_ID to the Railway website service and redeploy.';
    }

    return new Response(JSON.stringify({ error }), {
      status: response.status,
      statusText: response.statusText,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  };
})();

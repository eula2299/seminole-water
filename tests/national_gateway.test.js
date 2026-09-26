'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

async function unusedPorts() {
  const servers = [net.createServer(), net.createServer()];
  try {
    for (const server of servers) await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    return servers.map(server => server.address().port);
  } finally {
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
  }
}

test('production gateway preserves national, local, and account routes', { timeout: 40000 }, async t => {
  const [port, corePort] = await unusedPorts();
  const root = path.resolve(__dirname, '..');
  const detached = process.platform !== 'win32';
  const child = spawn(process.execPath, ['platform.js'], {
    cwd: root,
    detached,
    env: {
      ...process.env,
      PORT: String(port),
      INTERNAL_APP_PORT: String(corePort),
      DATABASE_URL: '',
      NATIONAL_SYNC_ENABLED: 'false',
      RAILWAY_ENVIRONMENT_ID: '',
      ENABLE_LIVE_WEB: '0',
      RETAIN_INVESTIGATIONS: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-16000); });
  let exit = null;
  const exited = new Promise(resolve => child.once('exit', (code, signal) => { exit = { code, signal }; resolve(); }));
  const base = 'http://127.0.0.1:' + port;
  function stop(signal) {
    try { if (detached) process.kill(-child.pid, signal); else child.kill(signal); } catch {}
  }
  try {
    const deadline = Date.now() + 25000;
    let ready = false;
    while (Date.now() < deadline) {
      if (exit) throw new Error('Gateway exited during startup: ' + JSON.stringify(exit) + '\n' + output);
      try {
        const response = await fetch(base + '/api/health', { signal: AbortSignal.timeout(1500) });
        if (response.ok && (await response.json()).ok === true) { ready = true; break; }
      } catch {}
      await delay(100);
    }
    assert.ok(ready, 'Gateway and local core must become ready.\n' + output);

    await t.test('home and national client are served through the real gateway', async () => {
      const home = await fetch(base + '/');
      assert.equal(home.status, 200);
      assert.match(await home.text(), /Water answers, close to home/);
      assert.match(home.headers.get('cache-control') || '', /public/);
      const client = await fetch(base + '/national-client.js');
      assert.equal(client.status, 200);
      assert.match(client.headers.get('content-type'), /javascript/);
      assert.match(await client.text(), /\/api\/national\/lookup/);
    });

    await t.test('SEO routes are crawlable and duplicate national home redirects to canonical root', async () => {
      const national = await fetch(base + '/national', { redirect: 'manual' });
      assert.equal(national.status, 301);
      assert.equal(national.headers.get('location'), '/');
      const robots = await fetch(base + '/robots.txt');
      assert.equal(robots.status, 200);
      assert.match(await robots.text(), /Sitemap: https:\/\/www\.ismywaterok\.com\/sitemap\.xml/);
      const sitemap = await fetch(base + '/sitemap.xml');
      assert.equal(sitemap.status, 200);
      assert.match(await sitemap.text(), /water-quality-by-address/);
      const guide = await fetch(base + '/private-well-water-testing');
      assert.equal(guide.status, 200);
      assert.match(await guide.text(), /Private well water testing/);
      const details = await fetch(base + '/water-details');
      assert.match(details.headers.get('x-robots-tag') || '', /noindex/);
    });

    await t.test('national status reports unavailable evidence without blocking process startup', async () => {
      const response = await fetch(base + '/api/national/status');
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(data.coverage_verified, false);
      assert.equal(data.supported_input_regions.length, 56);
      assert.equal(data.household_laboratory_data, 'not-connected');
    });

    await t.test('legacy Seminole and account pages remain reachable', async () => {
      const local = await fetch(base + '/seminole');
      assert.equal(local.status, 200);
      assert.match(await local.text(), /SEMINOLE COUNTY WATER CHECK/);
      const account = await fetch(base + '/account.html');
      assert.equal(account.status, 200);
      assert.match(await account.text(), /Sign in with Google or email/);
    });

    await t.test('malformed cookies cannot interrupt account endpoints or the gateway', async () => {
      const cookie = 'water_session=%; unrelated=%0a';
      const me = await fetch(base + '/api/auth/me', { headers: { Cookie: cookie } });
      assert.equal(me.status, 200);
      assert.equal((await me.json()).user, null);
      const logout = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { Cookie: cookie, Origin: base } });
      assert.equal(logout.status, 200);
      assert.equal((await logout.json()).ok, true);
      assert.equal((await fetch(base + '/healthz')).status, 200);
    });

    await t.test('same-origin national POST reaches validation and foreign origin is rejected', async () => {
      const same = await fetch(base + '/api/national/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: '{}' });
      assert.equal(same.status, 422);
      assert.equal((await same.json()).error, 'BAD_REGION');
      const foreign = await fetch(base + '/api/national/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://foreign.invalid' }, body: '{}' });
      assert.equal(foreign.status, 403);
    });

    await t.test('national body limit returns 413 through the gateway', async () => {
      const response = await fetch(base + '/api/national/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ street: 'x'.repeat(9000) }) });
      assert.equal(response.status, 413);
      assert.equal((await response.json()).error, 'BODY_TOO_LARGE');
    });

    await t.test('maintenance and intentionally removed impact endpoints stay blocked', async () => {
      for (const route of ['/api/service-areas/sync', '/api/epa/reload', '/api/local/reload']) {
        const response = await fetch(base + route, { method: 'POST' });
        assert.equal(response.status, 404, route);
      }
      for (const route of ['/api/impact', '/api/community/impact']) {
        assert.equal((await fetch(base + route)).status, 404, route);
      }
    });
  } finally {
    stop('SIGTERM');
    await Promise.race([exited, delay(3000, undefined, { ref: false })]);
    if (!exit) { stop('SIGKILL'); await exited; }
  }
});

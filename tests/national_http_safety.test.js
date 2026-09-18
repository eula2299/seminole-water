'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { PassThrough } = require('node:stream');
const { clientKey, parseCookies, readJson } = require('../national/http_safety');

function request(headers = {}) {
  const req = new PassThrough();
  req.headers = headers;
  return req;
}

test('client keys ignore spoofable forwarding headers unless explicitly trusted', () => {
  const req = { headers: { 'x-forwarded-for': '1.2.3.4' }, socket: { remoteAddress: '::ffff:127.0.0.1' } };
  assert.equal(clientKey(req), '127.0.0.1');
  assert.equal(clientKey(req, 'true'), '127.0.0.1');
});

test('trusted appended proxy chain selects its rightmost validated IP', () => {
  const req = { headers: { 'x-forwarded-for': '1.2.3.4, 203.0.113.12, invalid' }, socket: { remoteAddress: '127.0.0.1' } };
  assert.equal(clientKey(req, true), '203.0.113.12');
  req.headers['x-forwarded-for'] = 'spoofed, 2001:DB8::2';
  assert.equal(clientKey(req, true), '2001:db8::2');
  req.headers['x-forwarded-for'] = 'bad, 999.999.999.999, 1.2.3.4:1234';
  assert.equal(clientKey(req, true), '127.0.0.1');
});

test('malformed cookies cannot interrupt account parsing or mutate prototypes', () => {
  const cookies = parseCookies({ headers: { cookie: 'broken=%; water_session=valid%3Dtoken; __proto__=inert; newline=%0a; water_session=second' } });
  assert.equal(cookies.water_session, 'valid=token');
  assert.equal(cookies.broken, undefined);
  assert.equal(cookies.newline, undefined);
  assert.equal(Object.getPrototypeOf(cookies), null);
  assert.equal(cookies.__proto__, 'inert');
});

test('readJson assembles bounded chunks and counts UTF-8 bytes', async () => {
  const req = request();
  const body = readJson(req, 12);
  req.write('{"x":');
  req.end('"é"}');
  assert.deepEqual(await body, { x: 'é' });
  const tooSmall = request();
  const rejected = assert.rejects(readJson(tooSmall, 9), error => error.code === 'BODY_TOO_LARGE' && error.statusCode === 413);
  tooSmall.end('{"x":"é"}');
  await rejected;
});

test('readJson rejects declared oversize before data and discards later chunks', async () => {
  const req = request({ 'content-length': '1000000' });
  await assert.rejects(readJson(req, 32), error => error.status === 413);
  for (let i = 0; i < 32; i += 1) req.write(Buffer.alloc(65536, 120));
  req.end();
  await new Promise(resolve => req.once('close', resolve));
  assert.equal(req.listenerCount('data'), 0);
  assert.equal(req.listenerCount('error'), 0);
});

test('readJson rejects invalid JSON and resolves empty bodies consistently', async () => {
  const malformed = request();
  const bad = assert.rejects(readJson(malformed), error => error.code === 'BAD_JSON' && error.status === 400);
  malformed.end('{');
  await bad;
  const empty = request();
  const result = readJson(empty);
  empty.end();
  assert.deepEqual(await result, {});
});

test('readJson rejects interrupted bodies and tolerates error after aborted', async () => {
  const req = request();
  const failed = assert.rejects(readJson(req), error => error.code === 'BODY_ABORTED');
  req.write('{"unfinished":');
  req.emit('aborted');
  req.destroy(new Error('client disconnected'));
  await failed;
  await new Promise(resolve => req.once('close', resolve));
  assert.equal(req.listenerCount('data'), 0);
});

test('oversized HTTP requests can receive 413 and the server remains usable', async () => {
  const server = http.createServer(async (req, res) => {
    try {
      const body = await readJson(req, 32);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    } catch (error) {
      res.writeHead(error.statusCode || 500);
      res.end(error.code);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const large = await fetch(base, { method: 'POST', body: 'x'.repeat(65536) });
    assert.equal(large.status, 413);
    await large.text();
    const good = await fetch(base, { method: 'POST', body: '{"ok":true}' });
    assert.equal(good.status, 200);
    assert.deepEqual(await good.json(), { ok: true });
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

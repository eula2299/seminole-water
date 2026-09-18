'use strict';

const { isIP } = require('node:net');

class HttpInputError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'HttpInputError';
    this.code = code;
    this.status = status;
    this.statusCode = status;
  }
}

function ip(value) {
  if (typeof value !== 'string') return null;
  const candidate = value.trim().toLowerCase();
  if (!isIP(candidate)) return null;
  // Treat a socket's IPv4-mapped address as the same client as its IPv4 form.
  return /^::ffff:\d+\.\d+\.\d+\.\d+$/.test(candidate) ? candidate.slice(7) : candidate;
}

function clientKey(req, trustProxy = false) {
  const peer = ip(req.socket?.remoteAddress) || 'unknown';
  if (trustProxy !== true) return peer;
  const raw = req.headers?.['x-forwarded-for'];
  const forwarded = Array.isArray(raw) ? raw.join(',') : raw;
  if (typeof forwarded !== 'string' || forwarded.length > 8192) return peer;
  // Enable only behind a trusted ingress that appends its observed client IP.
  // The leftmost entry can have been supplied by the requesting client.
  const hops = forwarded.split(',');
  for (let i = hops.length - 1; i >= 0; i -= 1) {
    const candidate = ip(hops[i]);
    if (candidate) return candidate;
  }
  return peer;
}

function parseCookies(req) {
  const cookies = Object.create(null);
  const raw = req.headers?.cookie;
  if (typeof raw !== 'string') return cookies;
  for (const part of raw.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name) || Object.hasOwn(cookies, name)) continue;
    try {
      const value = decodeURIComponent(part.slice(separator + 1).trim());
      if (!/[\x00-\x1f\x7f]/.test(value)) cookies[name] = value;
    } catch {
      // A malformed, unrelated cookie must not break account requests.
    }
  }
  return cookies;
}

function readJson(req, maxBytes = 65536) {
  return new Promise((resolve, reject) => {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
      reject(new TypeError('maxBytes must be a nonnegative safe integer.'));
      return;
    }
    let chunks = [];
    let bytes = 0;
    let settled = false;

    function cleanup() {
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      req.removeListener('aborted', onAborted);
      req.removeListener('close', onClose);
    }
    function fail(error) {
      if (settled) return;
      settled = true;
      chunks = [];
      reject(error);
      // Continue draining without retaining bytes, allowing a 413 response.
      // Listeners remain until end/close to safely consume late stream errors.
      if (!req.destroyed) req.resume();
    }
    function onData(chunk) {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
      bytes += buffer.length;
      if (bytes > maxBytes) {
        fail(new HttpInputError('BODY_TOO_LARGE', `Request exceeds the ${maxBytes}-byte limit.`, 413));
        return;
      }
      chunks.push(buffer);
    }
    function onEnd() {
      cleanup();
      if (settled) return;
      const body = Buffer.concat(chunks, bytes).toString('utf8');
      chunks = [];
      settled = true;
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new HttpInputError('BAD_JSON', 'Invalid JSON.', 400)); }
    }
    function onError() {
      fail(new HttpInputError('BODY_UNAVAILABLE', 'Request body could not be read.', 400));
      cleanup();
    }
    function onAborted() {
      fail(new HttpInputError('BODY_ABORTED', 'Request body was interrupted.', 400));
      // IncomingMessage can emit an error after aborted; keep its listener
      // until close so it cannot become an uncaught stream error.
    }
    function onClose() {
      fail(new HttpInputError('BODY_ABORTED', 'Request body was interrupted.', 400));
      cleanup();
    }

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('aborted', onAborted);
    req.on('close', onClose);
    if (req.destroyed) {
      onClose();
      return;
    }
    const length = req.headers?.['content-length'];
    if (typeof length === 'string' && /^\d+$/.test(length) && Number(length) > maxBytes) {
      fail(new HttpInputError('BODY_TOO_LARGE', `Request exceeds the ${maxBytes}-byte limit.`, 413));
    }
  });
}

module.exports = { HttpInputError, clientKey, parseCookies, readJson };

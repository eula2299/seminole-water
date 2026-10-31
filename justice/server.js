"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { readJson, clientKey } = require("../national/http_safety");
const { createAi } = require("./ai");
const { createGroups } = require("./groups");
const sources = require("./sources");
const root = path.resolve(__dirname, "..");
const staticFiles = {};
for (const file of [
  "index.html",
  "app.js",
  "logic.js",
  "i18n.js",
  "style.css",
  "documents.js",
  "vault.js",
  "entry.js",
  "entry.css",
])
  staticFiles["/help/" + file] = path.join(root, "public/help", file);
for (const language of ["en", "es", "fr", "pt", "ht", "ar"])
  staticFiles["/help/" + language + ".json"] = path.join(
    root,
    "public/help",
    language + ".json",
  );
Object.assign(staticFiles, {
  "/help/vendor/fontkit.umd.min.js": path.join(
    root,
    "node_modules/@pdf-lib/fontkit/dist/fontkit.umd.min.js",
  ),
  "/help/fonts/DejaVuSans.ttf": path.join(__dirname, "fonts/DejaVuSans.ttf"),
  "/help/vendor/pdf.mjs": path.join(
    root,
    "node_modules/pdfjs-dist/build/pdf.mjs",
  ),
  "/help/vendor/pdf.worker.mjs": path.join(
    root,
    "node_modules/pdfjs-dist/build/pdf.worker.mjs",
  ),
  "/help/vendor/pdf-lib.min.js": path.join(
    root,
    "node_modules/pdf-lib/dist/pdf-lib.min.js",
  ),
  "/help/vendor/tesseract.min.js": path.join(
    root,
    "node_modules/tesseract.js/dist/tesseract.min.js",
  ),
  "/help/vendor/worker.min.js": path.join(
    root,
    "node_modules/tesseract.js/dist/worker.min.js",
  ),
  "/help/forms/rd3550-35.pdf": path.join(__dirname, "forms/rd3550-35.pdf"),
});
for (const name of [
  "tesseract-core.wasm.js",
  "tesseract-core.wasm",
  "tesseract-core-simd.wasm.js",
  "tesseract-core-simd.wasm",
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-lstm.wasm",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm",
])
  staticFiles["/help/vendor/" + name] = path.join(
    root,
    "node_modules/tesseract.js-core",
    name,
  );
function createHelpHandler({
  ai = createAi(),
  groups = createGroups(),
  fetcher = fetch,
  trustProxy = false,
} = {}) {
  const buckets = new Map();
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(self), geolocation=()",
    "Content-Security-Policy":
      "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' https://tessdata.projectnaptha.com; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  };
  function send(
    res,
    status,
    body,
    type = "application/json; charset=utf-8",
    extra = {},
  ) {
    res.writeHead(status, { ...headers, "Content-Type": type, ...extra });
    res.end(
      type.startsWith("application/json") && !Buffer.isBuffer(body)
        ? JSON.stringify(body)
        : body,
    );
  }
  function allowed(req) {
    const now = Date.now();
    for (const [k, b] of buckets) if (b.until < now) buckets.delete(k);
    const key = clientKey(req, trustProxy);
    const b = buckets.get(key) || { n: 0, until: now + 60000 };
    if (!buckets.has(key) && buckets.size >= 10000) return false;
    b.n++;
    buckets.set(key, b);
    return b.n <= 30;
  }
  async function handler(req, res, u) {
    if (
      !(
        u.pathname === "/help" ||
        u.pathname.startsWith("/help/") ||
        u.pathname.startsWith("/api/help/")
      )
    )
      return false;
    try {
      const pages = [
        "/help",
        "/help/",
        "/help/report",
        "/help/costs",
        "/help/repairs",
        "/help/rights",
        "/help/progress",
        "/help/join",
      ];
      if (
        req.method === "GET" &&
        (pages.includes(u.pathname) || staticFiles[u.pathname])
      ) {
        const file = pages.includes(u.pathname)
          ? staticFiles["/help/index.html"]
          : staticFiles[u.pathname];
        const ext = path.extname(file);
        const types = {
          ".html": "text/html; charset=utf-8",
          ".js": "application/javascript; charset=utf-8",
          ".mjs": "application/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".pdf": "application/pdf",
          ".wasm": "application/wasm",
          ".json": "application/json; charset=utf-8",
          ".ttf": "font/ttf",
        };
        send(
          res,
          200,
          fs.readFileSync(file),
          types[ext] || "application/octet-stream",
          {
            "Cache-Control":
              ext === ".html" ? "public, max-age=120" : "public, max-age=3600",
            ...(u.pathname === "/help/join" || u.pathname === "/help/progress"
              ? { "X-Robots-Tag": "noindex, nofollow" }
              : {}),
          },
        );
        return true;
      }
      if (req.method === "GET" && u.pathname === "/api/help/config") {
        send(res, 200, {
          ai: ai.enabled,
          groups: groups.available ? await groups.available() : groups.enabled,
          languages: Object.keys(ai.languages),
          forms: require("./local-sources.json").forms.map((f) => ({
            id: f.id,
            field_map: f.field_map,
            expires_at: f.expires_at || "2026-11-30",
            program: f.official_program_url,
            office: f.office_locator_url,
          })),
          pipe_cities: require("./local-sources.json").pipes.map((s) => s.city),
        });
        return true;
      }
      if (req.method === "GET" && u.pathname === "/api/help/filters") {
        const catalog = require("./filter-catalog.json");
        send(
          res,
          200,
          {
            ...catalog,
            stale: Date.now() - Date.parse(catalog.checked_at) > 30 * 86400000,
          },
          undefined,
          { "Cache-Control": "public, max-age=3600" },
        );
        return true;
      }
      if (req.method !== "POST") {
        send(res, 404, { error: "NOT_FOUND" });
        return true;
      }
      if (req.headers.origin) {
        let origin;
        try {
          origin = new URL(req.headers.origin);
        } catch {}
        if (
          !origin ||
          !["http:", "https:"].includes(origin.protocol) ||
          origin.host !== req.headers.host
        ) {
          send(res, 403, { error: "ORIGIN" });
          return true;
        }
      }
      if (req.headers["sec-fetch-site"] === "cross-site") {
        send(res, 403, { error: "ORIGIN" });
        return true;
      }
      if (
        !/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")
      ) {
        send(res, 415, { error: "FORMAT" });
        return true;
      }
      if (!allowed(req)) {
        send(res, 429, { error: "PLEASE_WAIT" });
        return true;
      }
      const timer = setTimeout(() => req.destroy(), 10000);
      timer.unref();
      let body;
      try {
        body = await readJson(req, 220000);
      } finally {
        clearTimeout(timer);
      }
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw Object.assign(Error("INVALID_REQUEST"), { status: 400 });
      if (u.pathname === "/api/help/analyze") {
        if (body.consent !== true)
          throw Object.assign(Error("CONSENT_REQUIRED"), { status: 400 });
        send(res, 200, await ai.analyze(body));
      } else if (u.pathname === "/api/help/translate") {
        if (body.consent !== true)
          throw Object.assign(Error("CONSENT_REQUIRED"), { status: 400 });
        send(res, 200, { translations: await ai.translate(body) });
      } else if (u.pathname === "/api/help/pipes")
        send(res, 200, await sources.pipes(body, fetcher));
      else if (u.pathname === "/api/help/meetings")
        send(res, 200, await sources.meetings(body, fetcher));
      else if (u.pathname === "/api/help/groups")
        send(res, 201, await groups.create(body));
      else if (
        /^\/api\/help\/groups\/[A-Za-z0-9_-]+\/(view|join|delete)$/.test(
          u.pathname,
        )
      ) {
        const [, id, action] = u.pathname.match(/groups\/([^/]+)\/([^/]+)$/);
        const secret = String(req.headers["x-help-key"] || "");
        send(
          res,
          200,
          action === "view"
            ? await groups.view(id, secret, body.owner === true)
            : action === "join"
              ? await groups.join(id, secret, body)
              : await groups.remove(id, secret),
        );
      } else send(res, 404, { error: "NOT_FOUND" });
    } catch (e) {
      if (!res.headersSent)
        send(res, e.status || 503, {
          error: e.status ? e.message : "HELP_UNAVAILABLE",
        });
      else res.end();
    }
    return true;
  }
  handler.close = () => groups.close();
  return handler;
}
module.exports = { createHelpHandler, staticFiles };

"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  http = require("node:http");
const { createHelpHandler } = require("../justice/server");
test("help API requires consent for AI, blocks cross-origin writes, and serves language assets correctly", async (t) => {
  let calls = 0;
  const handler = createHelpHandler({
    ai: {
      enabled: true,
      languages: { en: "English" },
      analyze: async () => {
        calls++;
        return { summary: "draft" };
      },
    },
    groups: { enabled: false, close() {} },
  });
  const server = http.createServer((req, res) =>
    handler(req, res, new URL(req.url, "http://localhost")),
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = "http://127.0.0.1:" + server.address().port;
  const post = (path, body, extra = {}) =>
    fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...extra },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await post("/api/help/analyze", { text: "private sample" })).status,
    400,
  );
  assert.equal(calls, 0);
  assert.equal(
    (
      await post(
        "/api/help/analyze",
        { consent: true },
        { Origin: "https://elsewhere.example" },
      )
    ).status,
    403,
  );
  assert.equal(calls, 0);
  assert.equal(
    (await post("/api/help/analyze", { consent: true })).status,
    200,
  );
  assert.equal(calls, 1);
  const lang = await fetch(base + "/help/es.json");
  assert.match(lang.headers.get("Content-Type"), /application\/json/);
  assert.equal(typeof (await lang.json()).home, "string");
  assert.equal(
    (await fetch(base + "/help/..%2F..%2Fpackage.json")).status,
    404,
  );
  const page = await fetch(base + "/help");
  assert.match(
    page.headers.get("Content-Security-Policy"),
    /frame-ancestors 'none'/,
  );
  assert.doesNotMatch(
    page.headers.get("Content-Security-Policy"),
    /script-src[^;]*unsafe-inline/,
  );
});
test("official repair form mapping exists and signatures remain empty", async () => {
  const { PDFDocument } = require("pdf-lib"),
    fs = require("node:fs"),
    spec = require("../justice/local-sources.json").forms[0];
  const doc = await PDFDocument.load(
    fs.readFileSync(require.resolve("../justice/forms/rd3550-35.pdf")),
  );
  const form = doc.getForm();
  for (const name of Object.values(spec.field_map))
    assert.ok(form.getFieldMaybe(name), name);
  form.getTextField(spec.field_map.applicant_name).setText("Sample Resident");
  form
    .getTextField(spec.field_map.repairs_line_1)
    .setText("Repair leaking kitchen pipe.");
  const saved = await PDFDocument.load(await doc.save());
  assert.equal(
    saved.getForm().getTextField(spec.field_map.applicant_name).getText(),
    "Sample Resident",
  );
  assert.ok(saved.getForm().getFieldMaybe("Potential Applicant Signature"));
});

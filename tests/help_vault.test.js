"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const { webcrypto } = require("node:crypto");
test("private backup round-trip preserves evidence and rejects the wrong password without changing saved records", async () => {
  const { IDBFactory } = require("fake-indexeddb");
  const context = {
    window: {},
    indexedDB: new IDBFactory(),
    crypto: webcrypto,
    Uint8Array,
    TextEncoder,
    TextDecoder,
    btoa,
    atob,
  };
  vm.runInNewContext(
    fs.readFileSync(require.resolve("../public/help/vault.js"), "utf8"),
    context,
  );
  const vault = context.window.WaterHelpVault;
  const item = await vault.put({
    title: "Fictional private request",
    kind: "complaint",
    status: "submitted",
    receipt: "DEMO-ONLY",
    attachments: [
      {
        name: "evidence.txt",
        type: "text/plain",
        data: btoa("fictional evidence"),
      },
    ],
    events: [],
  });
  const encrypted = await vault.backup("long fictional test password");
  assert.ok(!encrypted.includes(item.title));
  assert.ok(!encrypted.includes("DEMO-ONLY"));
  await assert.rejects(vault.restore(encrypted, "a wrong long password"));
  assert.equal((await vault.list()).length, 1);
  await vault.clear();
  assert.equal((await vault.list()).length, 0);
  assert.equal(
    await vault.restore(encrypted, "long fictional test password"),
    1,
  );
  const recovered = (await vault.list())[0];
  assert.equal(recovered.id, item.id);
  assert.equal(recovered.receipt, "DEMO-ONLY");
  assert.equal(atob(recovered.attachments[0].data), "fictional evidence");
});

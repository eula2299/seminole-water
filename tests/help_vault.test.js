"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const { webcrypto } = require("node:crypto");
test("without-saving mode keeps records only in memory and clears them when locked", async () => {
  let opened=0;
  const context={window:{},indexedDB:{open(){opened++;throw Error("Unexpected disk write");}},crypto:webcrypto,Uint8Array,TextEncoder,TextDecoder,btoa,atob,setTimeout,clearTimeout};
  vm.runInNewContext(fs.readFileSync(require.resolve("../public/help/vault.js"),"utf8"),context);
  const vault=context.window.WaterHelpVault;
  vault.startSession();
  const item=await vault.put({title:"Test-only private evidence",kind:"complaint",events:[]});
  assert.equal((await vault.list())[0].id,item.id);
  await vault.remove(item.id);
  assert.equal((await vault.list()).length,0);
  await vault.put({title:"Another test-only record",kind:"request"});
  vault.lock();
  await assert.rejects(vault.list(),/VAULT_LOCKED/);
  vault.startSession();
  assert.equal((await vault.list()).length,0);
  assert.equal(opened,0);
});
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
    setTimeout, clearTimeout,
  };
  vm.runInNewContext(
    fs.readFileSync(require.resolve("../public/help/vault.js"), "utf8"),
    context,
  );
  const vault = context.window.WaterHelpVault;
  await assert.rejects(vault.list(), /VAULT_LOCKED/);
  await vault.unlock("a long private vault password");
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
  const db = await new Promise((resolve,reject)=>{const r=context.indexedDB.open("water-help-private",1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const raw=await new Promise((resolve,reject)=>{const r=db.transaction("items").objectStore("items").getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  assert.ok(!JSON.stringify(raw).includes("Fictional private request"));
  assert.ok(!JSON.stringify(raw).includes("DEMO-ONLY"));
  vault.lock();
  await assert.rejects(vault.list(), /VAULT_LOCKED/);
  await assert.rejects(vault.unlock("wrong private vault password"));
  await vault.unlock("a long private vault password");
  const encrypted = await vault.backup("long fictional test password");
  assert.ok(!encrypted.includes(item.title));
  assert.ok(!encrypted.includes("DEMO-ONLY"));
  await assert.rejects(vault.restore(encrypted, "a wrong long password"));
  assert.equal((await vault.list()).length, 1);
  await vault.clear();
  await vault.unlock("a fresh private vault password");
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

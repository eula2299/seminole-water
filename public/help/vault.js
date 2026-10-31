/* Private device storage. Nothing here is sent to the website. */
window.WaterHelpVault = (() => {
  "use strict";
  let connection;
  const open = () =>
    connection ||
    (connection = new Promise((resolve, reject) => {
      const r = indexedDB.open("water-help-private", 1);
      r.onupgradeneeded = () =>
        r.result.createObjectStore("items", { keyPath: "id" });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  async function run(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("items", mode),
        request = fn(tx.objectStore("items"));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  const list = async () =>
    ((await run("readonly", (s) => s.getAll())) || []).sort((a, b) =>
      b.updated.localeCompare(a.updated),
    );
  const put = async (item) => {
    if (!item || typeof item.title !== "string") throw Error("INVALID_ITEM");
    const id = () =>
      Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) =>
        n.toString(16).padStart(2, "0"),
      ).join("");
    const data = {
      ...item,
      id: item.id || id(),
      updated: new Date().toISOString(),
    };
    if (JSON.stringify(data).length > 16000000) throw Error("TOO_LARGE");
    await run("readwrite", (s) => s.put(data));
    return data;
  };
  const base64 = (bytes) => {
    let s = "";
    for (const n of bytes) s += String.fromCharCode(n);
    return btoa(s);
  };
  const bytes = (s) => Uint8Array.from(atob(s), (x) => x.charCodeAt(0));
  async function key(password, salt, usage) {
    if (password.length < 12) throw Error("PASSWORD_SHORT");
    const raw = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 210000, hash: "SHA-256" },
      raw,
      { name: "AES-GCM", length: 256 },
      false,
      usage,
    );
  }
  async function backup(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16)),
      iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(JSON.stringify(await list()));
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await key(password, salt, ["encrypt"]),
      data,
    );
    return JSON.stringify({
      format: "water-help-backup",
      version: 1,
      salt: base64(salt),
      iv: base64(iv),
      data: base64(new Uint8Array(encrypted)),
    });
  }
  async function restore(raw, password) {
    if (raw.length > 30000000) throw Error("TOO_LARGE");
    const data = JSON.parse(raw);
    if (data.format !== "water-help-backup" || data.version !== 1)
      throw Error("INVALID_BACKUP");
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes(data.iv) },
      await key(password, bytes(data.salt), ["decrypt"]),
      bytes(data.data),
    );
    const items = JSON.parse(new TextDecoder().decode(decrypted));
    if (!Array.isArray(items) || items.length > 300)
      throw Error("INVALID_BACKUP");
    for (const i of items)
      if (
        !i ||
        typeof i.title !== "string" ||
        typeof i.id !== "string" ||
        typeof i.kind !== "string"
      )
        throw Error("INVALID_BACKUP");
    for (const item of items) await put(item);
    return items.length;
  }
  return {
    list,
    put,
    remove: (id) => run("readwrite", (s) => s.delete(id)),
    clear: () => run("readwrite", (s) => s.clear()),
    backup,
    restore,
  };
})();

/* Encrypted device storage. The password and key are never sent to the server. */
window.WaterHelpVault = (() => {
  'use strict';
  let connection, sessionKey, lockTimer, sessionOnly=false, temporary=[];
  const META = '__water_help_lock__';
  const open = () => connection || (connection = new Promise((resolve, reject) => {
    const r = indexedDB.open('water-help-private', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('items', { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
  async function run(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('items', mode), request = fn(tx.objectStore('items'));
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  }
  const b64 = (data) => { let s=''; for (const n of data) s += String.fromCharCode(n); return btoa(s); };
  const bytes = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const id = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2,'0')).join('');
  async function derive(password, salt) {
    if (!crypto.subtle) throw Error('SECURE_PAGE_REQUIRED');
    if (typeof password !== 'string' || password.length < 12) throw Error('PASSWORD_SHORT');
    const raw = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:210000,hash:'SHA-256'}, raw, {name:'AES-GCM',length:256}, false, ['encrypt','decrypt']);
  }
  async function encrypt(value, key) {
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(value)));
    return {iv:b64(iv),data:b64(new Uint8Array(data))};
  }
  async function decrypt(value, key) {
    const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(value.iv)},key,bytes(value.data));
    return JSON.parse(new TextDecoder().decode(raw));
  }
  function lock() { sessionKey=null; sessionOnly=false; temporary=[]; clearTimeout(lockTimer); }
  function requireKey() {
    if (!sessionKey) throw Error('VAULT_LOCKED');
    clearTimeout(lockTimer); lockTimer=setTimeout(lock,5*60000);
    if (lockTimer?.unref) lockTimer.unref();
    return sessionKey;
  }
  async function state() {
    const meta=await run('readonly',s=>s.get(META));
    return {configured:!!meta,locked:!sessionKey&&!sessionOnly,secure:!!crypto.subtle,sessionOnly};
  }
  async function unlock(password) {
    sessionOnly=false; temporary=[];
    const meta=await run('readonly',s=>s.get(META));
    if (meta) {
      const key=await derive(password,bytes(meta.salt));
      if (await decrypt(meta.check,key)!=='water-help-unlocked') throw Error('PASSWORD_WRONG');
      sessionKey=key;
    } else {
      const salt=crypto.getRandomValues(new Uint8Array(16)), key=await derive(password,salt);
      const old=(await run('readonly',s=>s.getAll())) || [];
      const migrated=[];
      for (const item of old) migrated.push({id:item.id,sealed:await encrypt(item,key)});
      const newMeta={id:META,salt:b64(salt),check:await encrypt('water-help-unlocked',key)};
      await run('readwrite',s=>{for(const item of migrated)s.put(item); return s.put(newMeta);});
      sessionKey=key;
    }
    requireKey(); return true;
  }
  async function list() {
    if(sessionOnly)return JSON.parse(JSON.stringify(temporary)).sort((a,b)=>b.updated.localeCompare(a.updated));
    const key=requireKey(), raw=(await run('readonly',s=>s.getAll())) || [], items=[];
    for (const r of raw) if(r.id!==META) {
      if(!r.sealed) throw Error('INVALID_VAULT');
      items.push(await decrypt(r.sealed,key));
    }
    return items.sort((a,b)=>b.updated.localeCompare(a.updated));
  }
  async function save(item) {
    const key=sessionOnly?null:requireKey();
    if(!item || typeof item.title!=='string')throw Error('INVALID_ITEM');
    const data={...item,id:item.id||id(),updated:new Date().toISOString()};
    if(data.id===META || JSON.stringify(data).length>16000000)throw Error('TOO_LARGE');
    if(sessionOnly){temporary=temporary.filter(v=>v.id!==data.id);temporary.push(JSON.parse(JSON.stringify(data)));return data;}
    const sealed=await encrypt(data,key);
    await run('readwrite',s=>s.put({id:data.id,sealed}));
    return data;
  }
  async function backup(password) {
    const salt=crypto.getRandomValues(new Uint8Array(16)),key=await derive(password,salt);
    return JSON.stringify({format:'water-help-backup',version:1,salt:b64(salt),...await encrypt(await list(),key)});
  }
  async function restore(raw,password) {
    requireKey();
    if(raw.length>30000000)throw Error('TOO_LARGE');
    const data=JSON.parse(raw);
    if(data.format!=='water-help-backup'||data.version!==1)throw Error('INVALID_BACKUP');
    const items=await decrypt(data,await derive(password,bytes(data.salt)));
    if(!Array.isArray(items)||items.length>300||items.some(i=>!i||typeof i.title!=='string'||typeof i.id!=='string'||i.id===META||typeof i.kind!=='string'))throw Error('INVALID_BACKUP');
    const key=requireKey(), records=[];
    for(const item of items)records.push({id:item.id,sealed:await encrypt(item,key)});
    await run('readwrite',s=>{for(const item of records)s.put(item);});
    return items.length;
  }
  return {state,unlock,lock,list,put:save,backup,restore,startSession:()=>{lock();sessionOnly=true;},isSessionOnly:()=>sessionOnly,
    remove:async id=>{if(sessionOnly){temporary=temporary.filter(i=>i.id!==id);return;}requireKey();if(id!==META)await run('readwrite',s=>s.delete(id));},
    clear:async()=>{if(sessionOnly){temporary=[];return;}requireKey();await run('readwrite',s=>s.clear());lock();}
  };
})();

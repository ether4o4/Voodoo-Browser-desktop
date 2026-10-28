'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

// The encryption provider is Electron safeStorage in production. No plaintext fallback.
class ProtectedStore {
  constructor(file, provider) { this.file=file; this.provider=provider; this.state={items:[]}; }
  async init() {
    if (!await this.provider.isAsyncEncryptionAvailable()) throw Error('Windows protected storage is unavailable. Voodoo will not save unprotected pairing secrets.');
    let encrypted;
    try { encrypted=await fs.readFile(this.file); }
    catch (e) { if(e.code==='ENOENT') return this.state; throw e; }
    try {
      const decrypted=await this.provider.decryptStringAsync(encrypted);
      if(!decrypted||typeof decrypted.result!=='string')throw Error('Unexpected encryption-provider result');
      const state=JSON.parse(decrypted.result);
      if (!state || typeof state!=='object' || !Array.isArray(state.items)) throw Error('Invalid state');
      this.state=state;
      if(decrypted.shouldReEncrypt)await this.save(state);
    } catch { throw Error('The saved Voodoo library could not be unlocked. It has been preserved; do not delete it to troubleshoot.'); }
    return this.snapshot();
  }
  snapshot() { return structuredClone(this.state); }
  async save(state) {
    const plain=JSON.stringify(state);
    if(Buffer.byteLength(plain)>4*1024*1024) throw Error('The local library is full.');
    const encrypted=await this.provider.encryptStringAsync(plain);
    if(!Buffer.isBuffer(encrypted)||!encrypted.length) throw Error('Protected storage did not produce an encrypted result.');
    await fs.mkdir(path.dirname(this.file),{recursive:true});
    const temp=this.file+'.'+crypto.randomUUID()+'.tmp';
    let handle;
    try {
      handle=await fs.open(temp,'wx',0o600); await handle.writeFile(encrypted); await handle.sync(); await handle.close();handle=null;
      await fs.rename(temp,this.file); this.state=structuredClone(state);
    } finally { if(handle)await handle.close(); await fs.unlink(temp).catch(()=>{}); }
  }
}
module.exports={ProtectedStore};

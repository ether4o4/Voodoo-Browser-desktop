'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {ProtectedStore}=require('../src/store.cjs');
function provider(){const key=crypto.randomBytes(32);return {isAsyncEncryptionAvailable:async()=>true,encryptStringAsync:async value=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,c.update(value,'utf8'),c.final(),c.getAuthTag()]);},decryptStringAsync:async value=>{const d=crypto.createDecipheriv('aes-256-gcm',key,value.subarray(0,12));d.setAuthTag(value.subarray(-16));return {result:Buffer.concat([d.update(value.subarray(12,-16)),d.final()]).toString('utf8'),shouldReEncrypt:false};}};}
test('encrypted state reloads without placing secrets in plaintext on disk',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'voodoo-store-')),file=path.join(dir,'state'),p=provider();
  try{const s=new ProtectedStore(file,p);await s.init();await s.save({items:[],link:{key:'sensitive-pair-key'}});assert.equal((await fs.readFile(file)).includes(Buffer.from('sensitive-pair-key')),false);const second=new ProtectedStore(file,p);await second.init();assert.equal(second.snapshot().link.key,'sensitive-pair-key');}finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('unavailable encryption and corrupt vault fail closed without replacing data',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'voodoo-store-')),file=path.join(dir,'state');
  try{await assert.rejects(new ProtectedStore(file,{isAsyncEncryptionAvailable:async()=>false}).init());await fs.writeFile(file,'corrupt');await assert.rejects(new ProtectedStore(file,provider()).init(),/preserved/);assert.equal(await fs.readFile(file,'utf8'),'corrupt');}finally{await fs.rm(dir,{recursive:true,force:true});}
});

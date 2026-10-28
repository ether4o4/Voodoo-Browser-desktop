'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {websiteUrl,navigationInput,trustedSender,APP_URL,newItem}=require('../src/policy.cjs');
test('website boundary blocks local files, script URLs, credentials and cleartext',()=>{
  for(const url of ['file:///C:/secrets','javascript:alert(1)','data:text/html,hello','http://example.com','https://user:password@example.com','voodoo://app/index.html'])assert.throws(()=>websiteUrl(url));
  assert.equal(websiteUrl('https://example.com/path?q=x'),'https://example.com/path?q=x');
  assert.equal(navigationInput('example.com'),'https://example.com/');
  assert.equal(navigationInput('http://example.com'),'https://example.com/');
  assert.match(navigationInput('some search words'),/^https:\/\/duckduckgo.com/);
  assert.throws(()=>navigationInput('file:///C:/'));
});
test('only exact trusted main-frame sender can access browser controls',()=>{
  const frame={url:APP_URL},webContents={mainFrame:frame};const win={isDestroyed:()=>false,webContents};
  assert.equal(trustedSender({sender:webContents,senderFrame:frame},win),true);
  assert.equal(trustedSender({sender:webContents,senderFrame:{url:APP_URL}},win),false);
  assert.equal(trustedSender({sender:{mainFrame:frame},senderFrame:frame},win),false);
  frame.url='https://example.com/';assert.equal(trustedSender({sender:webContents,senderFrame:frame},win),false);
});
test('shared note is an explicit snapshot with no credential/profile fields',()=>{
  const item=newItem('note',{title:'Draft',body:'Preserve my words',cookie:'secret'});
  assert.deepEqual(Object.keys(item).sort(),['body','createdAt','id','kind','title']);
  assert.throws(()=>newItem('note',{body:'x'.repeat(20001)}));
});

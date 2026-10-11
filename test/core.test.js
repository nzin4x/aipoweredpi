import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { Store, dayKey, monthKey } from '../server/store.js';
import { graphGet, graphPages, syncTeams } from '../server/graph.js';
import { compare, requestBody } from '../server/ai.js';
import { readOutlook } from '../server/outlook.js';
import { createApp } from '../server/index.js';
import { createJira } from '../server/jira.js';
import { setInterest } from '../server/operations.js';
function watch(s,ids){for(const id of ids){s.upsertChat('a',{id});setInterest(s,'a',id,true);}}

const json=value=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
const args={workflow:'weekly',input:'[source:1] 담당자 확인 요청',modelIds:['fast','balanced'],effort:'low'};
const live=s=>{const cfg=s.settings();cfg.mode='live';s.saveSettings(cfg);};
test('Korean day and billing month use timezone, not host date',()=>{
  const d=new Date('2026-09-30T16:00:00Z');assert.equal(dayKey('Asia/Seoul',d),'2026-10-01');assert.equal(monthKey('Asia/Seoul',d),'2026-10');
});
test('Graph follows every chat/message page, upserts edits and deletions, isolates accounts',async()=>{
  const s=new Store(':memory:');watch(s,['c1','c2']);const calls=[];
  const fetcher=async url=>{calls.push(url);const u=new URL(url);
    if(u.pathname.endsWith('/me/chats'))return json(u.searchParams.has('page')?{value:[{id:'c2',topic:'Second'}]}:{value:[{id:'c1',topic:'First'}],'@odata.nextLink':'https://graph.microsoft.com/v1.0/me/chats?page=2'});
    if(u.pathname.includes('/c1/'))return json(u.searchParams.has('page')?{value:[{id:'m2',body:{content:'old'},deletedDateTime:'2026-10-01'}]}:{value:[{id:'m1',body:{content:'<b>new</b>'},createdDateTime:'2026-10-01T00:00:00Z'}],'@odata.nextLink':'https://graph.microsoft.com/v1.0/chats/c1/messages?page=2'});
    return json({value:[]});
  };
  await syncTeams(s,{token:'secret',account:'a'},()=>{},{fetcher});
  assert.equal(s.counts('a').chats,2);assert.equal(s.counts('a').messages,1);assert.equal(s.search('a')[0].body,'new');assert.equal(s.counts('b').messages,0);
  calls.length=0;await syncTeams(s,{token:'secret',account:'a'},()=>{},{fetcher});
  assert.equal(s.counts('a').messages,1);assert(calls.some(u=>new URL(u).searchParams.has('$filter')));s.close();
});
test('Graph rejects credential forwarding via malicious pagination',async()=>{
  let calls=0;await assert.rejects(async()=>{for await(const _ of graphPages('me/chats','secret',{fetcher:async()=>{calls++;return json({value:[],'@odata.nextLink':'https://evil.invalid/steal'});}})){}},/잘못된 Graph/);assert.equal(calls,1);
});
test('Graph throttling retries and token expiry never advances incomplete watermark',async()=>{
  let attempts=0;const sleeps=[];
  await graphGet('me','secret',{fetcher:async()=>++attempts===1?new Response('',{status:429,headers:{'Retry-After':'2'}}):json({id:'me'}),sleep:async ms=>sleeps.push(ms)});
  assert.deepEqual(sleeps,[2000]);
  const s=new Store(':memory:');watch(s,['c1']);await assert.rejects(()=>syncTeams(s,{token:'secret',account:'a'},()=>{},{fetcher:async url=>url.includes('me/chats')?json({value:[{id:'c1'}]}):new Response('',{status:401})}),/토큰/);
  assert.equal(s.chat('a','c1').watermark,null);s.close();
});
test('Partial chat failures do not block successful chats or commit failed watermark',async()=>{
  const s=new Store(':memory:');watch(s,['bad','good']);const out=await syncTeams(s,{token:'secret',account:'a'},()=>{},{fetcher:async url=>url.includes('me/chats')?json({value:[{id:'bad'},{id:'good'}]}):url.includes('/bad/')?new Response('',{status:403}):json({value:[]})});
  assert.equal(out.errors.length,1);assert.equal(out.chats,1);assert.equal(s.chat('a','bad').watermark,null);assert(s.chat('a','good').watermark);s.close();
});
test('Budget rejects comparison atomically before making any calls',async()=>{
  const s=new Store(':memory:');live(s);const c=s.settings();c.monthlyBudget=0.000001;s.saveSettings(c);let calls=0;
  await assert.rejects(()=>compare(s,args,'key',{fetcher:async()=>{calls++;return json({});}}),/잔여 예산/);assert.equal(calls,0);assert.equal(s.results().length,0);s.close();
});
test('Usage accounting includes reasoning once and exact cache hits make no new calls',async()=>{
  const s=new Store(':memory:');live(s);let calls=0;const fetcher=async()=>{calls++;return json({choices:[{message:{content:'보고서'}}],usage:{prompt_tokens:100,completion_tokens:200,completion_tokens_details:{reasoning_tokens:150}}});};
  const first=await compare(s,args,'key',{fetcher});assert.equal(calls,2);assert.equal(first.results[1].cost,(100+200*5)/1e6);
  const total=s.budget().spent;const second=await compare(s,args,'key',{fetcher});assert.equal(calls,2);assert(second.results.every(r=>r.cached===1&&r.cost===0));assert.equal(s.budget().spent,total);assert.equal(s.budget().reserved,0);s.close();
});
test('Timeout retains estimated liability; missing usage is never reported free',async()=>{
  const s=new Store(':memory:');live(s);const out=await compare(s,{...args,modelIds:['balanced']},'key',{fetcher:async()=>{throw new Error('timeout');}});
  assert.equal(out.results[0].status,'uncertain');assert(s.budget().reserved>0);
  const next=await compare(s,{...args,modelIds:['fast']},'key',{fetcher:async()=>json({choices:[{message:{content:'response'}}]})});assert(next.results[0].cost>0);assert.equal(next.results[0].usage_estimated,1);s.close();
});
test('Demo never calls upstream or consumes real monthly budget',async()=>{
  const s=new Store(':memory:');await compare(s,args,'',{fetcher:async()=>{throw new Error('must not call');}});assert.equal(s.budget().spent,0);assert.equal(s.budget().calls,0);s.close();
});
test('Model reasoning is explicitly mapped and omitted for unsupported models',()=>{
  const s=new Store(':memory:');const [a,b]=s.settings().models;assert.equal(requestBody(a,'max',[],100).reasoning_effort,undefined);b.effortMap.max='xhigh';assert.equal(requestBody(b,'max',[],100).reasoning_effort,'xhigh');s.close();
});
test('Outlook SQLite mapping reads local rows without changing source',()=>{
  const dir=mkdtempSync(join(tmpdir(),'mytools-test-'));const path=join(dir,'outlook.sqlite');
  try { const db=new DatabaseSync(path);db.exec("CREATE TABLE mail(id TEXT, subject TEXT);INSERT INTO mail VALUES('1','Hello');");db.close();
    const query="SELECT id,id thread_id,subject,'sender@test' sender,'me@test' recipients,'2026-10-01T00:00:00Z' sent_at,'body' body FROM mail";
    assert.equal(readOutlook({path,query})[0].subject,'Hello');assert.throws(()=>readOutlook({path,query:'DELETE FROM mail'}),/읽기/);
    const check=new DatabaseSync(path);assert.equal(check.prepare('SELECT COUNT(*) n FROM mail').get().n,1);check.close();
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('Local API requires same-origin anti-CSRF token and never exposes credentials',async()=>{
  const s=new Store(':memory:');const {app}=createApp({store:s,port:44310});const server=app.listen(44310,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  try {
    const url='http://127.0.0.1:44310';const state=await fetch(`${url}/api/state`).then(r=>r.json());assert(state.csrf);
    const bad=await fetch(`${url}/api/credentials`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"apiKey":"SECRET"}'});assert.equal(bad.status,403);
    const origin=await fetch(`${url}/api/state`,{headers:{Origin:'https://evil.invalid'}});assert.equal(origin.status,403);
    const ok=await fetch(`${url}/api/credentials`,{method:'POST',headers:{'Content-Type':'application/json','X-Mytools-Token':state.csrf},body:'{"apiKey":"SECRET"}'});assert.equal(ok.status,200);
    const text=await fetch(`${url}/api/state`).then(r=>r.text());assert(!text.includes('SECRET'));assert(JSON.parse(text).credentials.api);
  } finally {await new Promise(r=>server.close(r));s.close();}
});
test('JIRA creation is idempotent and uncertain writes cannot blindly retry',async()=>{
  const s=new Store(':memory:');live(s);const cfg=s.settings();cfg.jira.baseUrl='https://jira.example.test';s.saveSettings(cfg);
  const comparison=await compare(s,{workflow:'email-jira',input:'mail',modelIds:['fast']},'key',{fetcher:async()=>json({choices:[{message:{content:'draft'}}],usage:{prompt_tokens:10,completion_tokens:10}})});
  const args={resultId:comparison.results[0].id,summary:'Issue',description:'Desc',project:'DEMO',issueType:'Task'};let calls=0;
  const opts={fetcher:async()=>{calls++;return json({key:'DEMO-1'});}};
  assert.equal((await createJira(s,args,'pat',opts)).issue_key,'DEMO-1');await createJira(s,args,'pat',opts);assert.equal(calls,1);
  s.db.prepare("UPDATE jira_links SET issue_key='__pending__' WHERE result_id=?").run(args.resultId);
  await assert.rejects(()=>createJira(s,args,'pat',opts),/불확실/);assert.equal(calls,1);s.close();
});

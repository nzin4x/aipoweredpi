import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/store.js';
import {discoverChats,syncTeams} from '../server/graph.js';
import {setInterest,interested,startScheduler,syncJira,dueIssues,dailyRoom,teamEntries,operationsSettings} from '../server/operations.js';
import {getGuide,saveGuide} from '../server/guides.js';
import {compare,prepareComparison} from '../server/ai.js';
import {lineDiff,meetingInput} from '../shared/text.js';
import {createApp} from '../server/index.js';
const json=v=>new Response(JSON.stringify(v),{headers:{'Content-Type':'application/json'}});

test('discover defaults OFF; interest OFF preserves watermark; re-enable catches gaps and edits',async()=>{
  const s=new Store(':memory:');const session={account:'me',token:'secret'};let calls=[];
  const fetcher=async url=>{calls.push(String(url));return String(url).includes('me/chats')?json({value:[{id:'one',topic:'One'},{id:'two',topic:'Two'}]}):json({value:[{id:'m',body:'work',createdDateTime:'2026-10-01T00:00:00Z',lastModifiedDateTime:'2026-10-08T00:00:00Z'}]});};
  await discoverChats(s,session,{fetcher});assert.equal(s.counts('me').chats,2);assert(!interested(s,'me','one'));assert.equal(s.counts('me').messages,0);
  setInterest(s,'me','one',true);await syncTeams(s,session,()=>{},{fetcher});assert.equal(s.counts('me').messages,1);assert(!calls.some(c=>c.includes('/two/messages')));
  s.watermark('me','one','2026-10-01T00:00:00Z');setInterest(s,'me','one',false);calls=[];
  await syncTeams(s,session,()=>{},{fetcher});assert.equal(calls.length,1);assert.equal(s.chat('me','one').watermark,'2026-10-01T00:00:00Z');
  setInterest(s,'me','one',true);calls=[];await syncTeams(s,session,()=>{},{fetcher});const query=new URL(calls.find(c=>c.includes('/one/messages'))).searchParams.get('$filter');assert(query.includes('2026-09-30T23:55:00.000Z'));assert(!interested(s,'other','one'));s.close();
});

test('local scheduler obeys enabled, interval, token availability and serial execution',async()=>{
  let time=0,enabled=false,token=true,calls=0,release;
  const scheduler=startScheduler({settings:()=>({enabled,intervalMinutes:5}),canRun:()=>token,now:()=>time,run:async()=>{calls++;await new Promise(r=>{release=r;});}});
  try{await scheduler.tick();assert.equal(calls,0);enabled=true;token=false;await scheduler.tick();assert.equal(calls,0);token=true;
    const first=scheduler.tick();assert.equal(calls,1);time=600000;await scheduler.tick();assert.equal(calls,1);release();await first;
    const next=scheduler.tick();assert.equal(calls,2);release();await next;await scheduler.tick();assert.equal(calls,2);
  }finally{scheduler.stop();}
});

test('JIRA full snapshot is paginated and atomic, deadlines use configured field',async()=>{
  const s=new Store(':memory:');const c=s.settings();c.mode='live';c.jira.baseUrl='https://jira.example.test';s.saveSettings(c);
  const config={...operationsSettings(s),dateField:'customfield_10101'};s.db.prepare('UPDATE operations_settings SET json=?').run(JSON.stringify(config));
  const issue=n=>({key:`VPC-${n}`,fields:{summary:'Work',status:{name:'Open'},assignee:{displayName:'A'},customfield_10101:'2026-01-01',duedate:'2099-12-01'}});
  let calls=0;await syncJira(s,'key',{fetcher:async url=>{calls++;assert(new URL(url).searchParams.get('fields').includes('customfield_10101'));return json({total:2,issues:[issue(calls)]});}});
  assert.equal(calls,2);assert.equal(dueIssues(s).length,2);assert.equal(dueIssues(s)[0].due,'2026-01-01');
  await assert.rejects(()=>syncJira(s,'key',{fetcher:async()=>new Response('',{status:403})}),/403/);assert.equal(dueIssues(s).length,2);s.close();
});

test('meeting inputs stay separated; guide versions are immutable and pinned to execution',async()=>{
  const s=new Store(':memory:');const input=meetingInput({transcript:'HLV 확인',notes:'정확한 용어 HLB',agenda:'안건 계획'});
  assert(input.includes('안건 계획'));assert.equal(meetingInput({agenda:'only agenda'}),'');
  const first=getGuide(s,'meeting');saveGuide(s,'meeting',{baseVersion:1,content:first.content+'\n반드시 짧게.',note:'간결화'});
  assert.throws(()=>saveGuide(s,'meeting',{baseVersion:1,content:'overwrite',note:'bad'}),/새 버전/);
  const args={workflow:'meeting',input,modelIds:['fast'],guideVersion:1};
  const p=prepareComparison(s,args)[0];assert(!p.body.messages[0].content.includes('반드시 짧게.'));
  const out=await compare(s,args,'');assert.equal(out.results[0].guide_version,1);assert(out.results[0].content.includes('# Action Item'));
  assert.equal(s.db.prepare('SELECT version FROM execution_guides WHERE group_id=?').get(out.groupId).version,1);
  assert.deepEqual(lineDiff('one\ntwo','one\nadded\ntwo').filter(x=>x.kind==='add').map(x=>x.text),['added']);s.close();
});

test('room day filter honours Seoul midnight and retains source IDs',()=>{
  const s=new Store(':memory:');s.upsertChat('a',{id:'c'});s.saveMessages('a','c',[{id:'before',body:'old',createdDateTime:'2026-10-07T14:59:00Z'},{id:'after',body:'new',createdDateTime:'2026-10-07T15:01:00Z'}]);
  const out=dailyRoom(s,'a','c','2026-10-08');assert.equal(out.count,1);assert(out.input.includes('[after]'));assert(!out.input.includes('old'));s.close();
});

test('HChat adapter uses separate system, native usage, Bearer and no guessed effort',async()=>{
  const s=new Store(':memory:');const c=s.settings();c.mode='live';c.protocol='anthropic';c.baseUrl='https://company.example/claude';s.saveSettings(c);
  let request;const out=await compare(s,{workflow:'ask',input:'test',modelIds:['fast']},'secret',{fetcher:async(url,options)=>{request={url,...options};return json({content:[{type:'text',text:'answer'}],usage:{input_tokens:11,output_tokens:7},stop_reason:'end_turn'});}});
  assert.equal(request.url,'https://company.example/claude/messages');assert.equal(request.headers.Authorization,'Bearer secret');const body=JSON.parse(request.body);assert(body.system);assert(body.max_tokens);assert(!body.messages.some(m=>m.role==='system'));assert.equal(out.results[0].input_tokens,11);
  assert.throws(()=>prepareComparison(s,{workflow:'ask',input:'test',modelIds:['deep']}),/미지원/);s.close();
});

test('team extraction import validates, is idempotent and isolates demo/live',async()=>{
  const s=new Store(':memory:');const instance=createApp({store:s,port:44311});const server=instance.app.listen(44311,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  try{const base='http://127.0.0.1:44311';const state=await fetch(base+'/api/state').then(r=>r.json());const headers={'Content-Type':'application/json','X-Mytools-Token':state.csrf};
    const out=await compare(s,{workflow:'team-extract',input:'source',modelIds:['fast']},'');const entries=[{day:'2026-10-08',person:'A',product:'VPC',work:'Review',status:'진행',due:'',source:'m1'}];
    const run=()=>fetch(base+'/api/team/import',{method:'POST',headers,body:JSON.stringify({resultId:out.results[0].id,entries})}).then(r=>r.json());assert.equal((await run()).count,1);assert.equal((await run()).duplicate,true);assert.equal(teamEntries(s,'2026-10-08','2026-10-08').length,1);
    const invalid=await fetch(base+'/api/team',{method:'POST',headers,body:JSON.stringify({...entries[0],day:'2026-02-30'})});assert.equal(invalid.status,400);
    const c=s.settings();c.mode='live';s.saveSettings(c);assert.equal(teamEntries(s,'2026-10-08','2026-10-08').length,0);
  }finally{instance.stop();await new Promise(r=>server.close(r));s.close();}
});

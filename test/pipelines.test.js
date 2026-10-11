import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../server/store.js';
import { saveRoomTags,roomTags,tagCollection } from '../server/tags.js';
import { pipelineRunner,executionBoard } from '../server/pipelines.js';
import { prepareComparison,compare,persistComparison } from '../server/ai.js';
import { createApp } from '../server/index.js';

const task=(n=0)=>({title:`Task ${n}`,request:{workflow:'ask',input:`Question ${n}`,modelIds:['fast'],effort:'low',fresh:true}});
const batch=(count=4,concurrency=2)=>({title:'Test batch',concurrency,tasks:Array.from({length:count},(_,i)=>task(i))});
const live=s=>{const settings=s.settings();settings.mode='live';s.saveSettings(settings);};
const json=value=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
const response=()=>json({choices:[{message:{content:'Answer'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5}});

test('room tags persist independently of interest, isolate accounts and gather exact tag/day',()=>{
  const s=new Store(':memory:');
  for(const account of ['a','b'])s.upsertChat(account,{id:'c',title:account});
  s.watermark('a','c','2026-10-08T00:00:00Z');
  assert.deepEqual(saveRoomTags(s,'a','c',[' VPC ','VPC','보안']),['VPC','보안']);
  saveRoomTags(s,'b','c',['else']);s.upsertChat('a',{id:'c',title:'renamed'});
  assert.deepEqual(roomTags(s,'a').get('c'),['VPC','보안']);
  s.saveMessages('a','c',[{id:'yes',body:'inside',createdDateTime:'2026-10-07T15:10:00Z'},{id:'no',body:'outside',createdDateTime:'2026-10-07T14:59:00Z'}]);
  const found=tagCollection(s,'a','VPC','2026-10-08');assert.equal(found.rooms[0].count,1);assert(found.rooms[0].input.includes('[yes]'));
  assert.equal(tagCollection(s,'a','VP','2026-10-08').rooms.length,0);assert.equal(tagCollection(s,'b','VPC','2026-10-08').rooms.length,0);
  assert.equal(s.chat('a','c').watermark,'2026-10-08T00:00:00Z');
  assert.throws(()=>saveRoomTags(s,'a','missing',['tag']));saveRoomTags(s,'a','c',[]);assert.equal(roomTags(s,'a').size,0);s.close();
});

test('batch rejects total budget and invalid tasks atomically before any calls',async()=>{
  const s=new Store(':memory:');live(s);const c=s.settings();c.monthlyBudget=0.0000001;s.saveSettings(c);
  let calls=0;const runner=pipelineRunner(s,{fetcher:async()=>{calls++;return response();}});
  assert.throws(()=>runner.submit(batch(),'secret'),/잔여 예산/);assert.equal(calls,0);assert.equal(s.results().length,0);assert.equal(executionBoard(s).pipelines.length,0);
  const bad=batch();bad.tasks[2].request.modelIds=['unknown'];assert.throws(()=>runner.submit(bad,'secret'),/모델/);assert.equal(s.results().length,0);s.close();
});

test('batch bounds actual model concurrency, pins snapshots, timestamps and records usage',async()=>{
  const s=new Store(':memory:');live(s);let active=0,peak=0,calls=0;
  const runner=pipelineRunner(s,{fetcher:async()=>{calls++;peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,15));active--;return response();}});
  const submitted=runner.submit(batch(5,2),'secret');assert.equal(runner.active,submitted.id);
  assert.throws(()=>runner.submit(batch(),'secret'),/진행 중/);
  await runner.completion;assert.equal(peak,2);assert.equal(calls,5);assert.equal(runner.active,null);
  const p=executionBoard(s).pipelines[0];assert.equal(p.status,'success');assert.equal(p.jobs.length,5);assert(p.started&&p.finished);
  for(const r of p.jobs){assert(r.started&&r.finished);assert(Date.parse(r.finished)>=Date.parse(r.started));assert.equal(r.input_tokens,10);assert.equal(r.output_tokens,5);assert.equal(r.status,'success');assert(s.db.prepare('SELECT * FROM execution_guides WHERE group_id=?').get(r.group_id));}
  assert.equal(s.budget().reserved,0);assert.equal(s.budget().tokens,75);s.close();
});

test('a failed request does not block siblings; queued cancellation never calls upstream',async()=>{
  const s=new Store(':memory:');live(s);let calls=0,release;
  const runner=pipelineRunner(s,{fetcher:async()=>{calls++;if(calls===1)return new Response('',{status:400});return response();}});
  runner.submit(batch(3,1),'secret');await runner.completion;assert.equal(calls,3);assert.equal(executionBoard(s).pipelines[0].status,'partial');
  const held=pipelineRunner(s,{fetcher:async()=>{calls++;await new Promise(r=>{release=r;});return response();}});
  const out=held.submit(batch(3,1),'secret');while(!release)await new Promise(r=>setImmediate(r));
  assert.equal(held.cancel(out.id).cancelled,2);release();await held.completion;
  assert.equal(calls,4);const p=executionBoard(s).pipelines.find(p=>p.id===out.id);assert.equal(p.jobs.filter(j=>j.status==='cancelled').length,2);assert.equal(s.budget().reserved,0);s.close();
});

test('cache jobs report zero usage; restart cancels unsent work but retains in-flight liability',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'mytools-pipeline-')),path=join(dir,'test.sqlite');
  let s=new Store(path);
  try{
    live(s);const request={...task().request,fresh:false};await compare(s,request,'secret',{fetcher:response});
    let calls=0;const runner=pipelineRunner(s,{fetcher:()=>{calls++;return response();}});runner.submit({title:'Cache',concurrency:1,tasks:[{title:'cached',request}]},'secret');await runner.completion;
    const cached=executionBoard(s).pipelines[0].jobs[0];assert.equal(cached.cached,1);assert.equal(cached.input_tokens+cached.output_tokens,0);assert(cached.started&&cached.finished);assert.equal(calls,0);
    const entries=prepareComparison(s,{...task(99).request,modelIds:['fast','balanced']});
    s.reserve(entries,()=>{
      persistComparison(s,task(99).request,entries);
      s.db.prepare('INSERT INTO pipelines VALUES(?,?,?,?,?,?,?,?)').run('restart','Restart','live','running',new Date().toISOString(),new Date().toISOString(),null,1);
      for(const [i,e] of entries.entries())s.db.prepare('INSERT INTO pipeline_jobs VALUES(?,?,?,?)').run(e.id,'restart','Restart',i);
    });
    s.finishResult(entries[0].id,{started:new Date().toISOString()});s.close();s=new Store(path);
    assert.equal(s.db.prepare('SELECT status FROM results WHERE id=?').get(entries[0].id).status,'uncertain');
    assert.equal(s.db.prepare('SELECT status FROM results WHERE id=?').get(entries[1].id).status,'cancelled');
    assert.equal(s.budget().reserved,entries[0].reserved);assert.equal(executionBoard(s).pipelines.find(p=>p.id==='restart').status,'interrupted');
  }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});

test('pipeline API validates CSRF, concurrency, source scopes and tracks code outcomes',async()=>{
  const s=new Store(':memory:'),instance=createApp({store:s,port:44312});const server=instance.app.listen(44312,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:44312';
  try{
    const state=await fetch(base+'/api/state').then(r=>r.json()),headers={'Content-Type':'application/json','X-Mytools-Token':state.csrf};
    const post=(url,body,method='POST')=>fetch(base+url,{method,headers,body:JSON.stringify(body)});
    assert.equal((await fetch(base+'/api/pipelines',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(batch())})).status,403);
    assert.equal((await post('/api/pipelines',batch(1,4))).status,400);
    assert.equal((await post('/api/rooms/tags',{chatId:'vpc',tags:['VPC']},'PUT')).status,200);
    assert.equal((await post('/api/pipelines',batch(2))).status,202);
    let board;do{await new Promise(r=>setTimeout(r,5));board=await fetch(base+'/api/executions').then(r=>r.json());}while(board.active);
    assert.equal(board.pipelines[0].jobs.length,2);assert.equal(board.pipelines[0].status,'success');
    await post('/api/outlook/import',{});board=await fetch(base+'/api/executions').then(r=>r.json());assert(board.code.find(r=>r.workflow==='outlook-import'&&r.finished&&r.status==='success'));
    assert(!JSON.stringify(board).includes(state.csrf));
  }finally{instance.stop();await new Promise(r=>server.close(r));s.close();}
});

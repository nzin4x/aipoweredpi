import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGraphVault } from '../server/vault.js';
import { Store } from '../server/store.js';
import { createApp } from '../server/index.js';
import { compare } from '../server/ai.js';
import { listActivity,tagActivity,activityDetail } from '../server/activity.js';

function keychain(){const entries=new Map();let fail=false;return {entries,set fail(value){fail=value;},entryFactory:(service,name)=>({getPassword:async()=>entries.get(`${service}:${name}`),setPassword:async value=>{if(fail)throw new Error('DO NOT EXPOSE PLATFORM SECRET');assert(value.length<1000);entries.set(`${service}:${name}`,value);},deletePassword:async()=>entries.delete(`${service}:${name}`)})};}

test('vault roundtrips long tokens, isolates stores, survives recreation and removes all fragments',async()=>{
  const k=keychain(),options={entryFactory:k.entryFactory,platform:'win32'},a=createGraphVault('db-a',options),token='TEST_TOKEN_'.repeat(1700);
  await a.write(token);assert.equal(a.status().saved,true);assert(k.entries.size>2);
  assert.equal(await createGraphVault('db-a',options).read(),token);assert.equal(await createGraphVault('db-b',options).read(),null);
  k.fail=true;await assert.rejects(a.write('replacement'),/키체인/);assert(!a.status().error.includes('SECRET'));k.fail=false;
  assert.equal(await a.read(),token);await a.write('replacement');assert.equal(k.entries.size,2);await a.remove();assert.equal(k.entries.size,0);assert.equal(a.status().saved,false);
});

test('activity tags span AI/code/actions, exact filter and mode isolation; replay is only a draft',async()=>{
  const s=new Store(':memory:');const out=await compare(s,{workflow:'weekly',input:'original source',modelIds:['fast'],effort:'high',instruction:'short'},'');
  const id=s.startRun('teams-cache','demo');s.updateRun(id,'success','Done');
  tagActivity(s,'ai',out.results[0].id,[' VPC ','VPC']);tagActivity(s,'code',id,['VPC']);
  assert.equal(listActivity(s,{tag:'VPC'}).total,2);assert.equal(listActivity(s,{tag:'VP'}).total,0);
  const repeat=activityDetail(s,'ai',out.results[0].id).repeat;assert.equal(repeat.type,'ai');assert.equal(repeat.request.input,'original source');assert.equal(repeat.request.effort,'high');assert.equal(repeat.request.guideVersion,1);
  assert.equal(s.results().length,1);assert.equal(activityDetail(s,'code',id).repeat.route,'teams');
  s.saveSettings({...s.settings(),mode:'live'});assert.equal(listActivity(s,{tag:'VPC'}).total,0);assert.throws(()=>tagActivity(s,'code',id,['private']));s.close();
});

test('Graph UI token persists only to vault, restores after app restart, rejects expired tokens and audits without secrets',async()=>{
  const s=new Store(':memory:');s.saveSettings({...s.settings(),mode:'live'});const k=keychain();
  const vault=()=>createGraphVault('graph-test',{entryFactory:k.entryFactory,platform:'darwin'});
  const secret='test-graph-secret-1234567890';let invalid=false,calls=0;
  const graphOptions={fetcher:async(url,opts)=>{calls++;assert(opts.headers.Authorization.startsWith('Bearer '));if(invalid)return new Response('',{status:401});return Response.json(url.includes('/me?')?{id:'person',displayName:'User'}:{value:[]});}};
  let instance,server,headers;
  async function open(){instance=createApp({store:s,port:44313,vault:vault(),graphOptions});server=instance.app.listen(44313,'127.0.0.1');await new Promise(r=>server.once('listening',r));const state=await fetch('http://127.0.0.1:44313/api/state').then(r=>r.json());headers={'Content-Type':'application/json','X-Mytools-Token':state.csrf};return state;}
  async function close(){instance.stop();await new Promise(r=>server.close(r));}
  const post=(path,body={})=>fetch('http://127.0.0.1:44313/api'+path,{method:'POST',headers,body:JSON.stringify(body)});
  try{
    await open();assert.equal((await post('/teams/sync')).status,400);assert.equal(calls,0);
    assert.equal((await post('/graph/token',{token:secret,persist:true})).status,200);assert.equal(await vault().read(),secret);
    assert.equal((await post('/teams/sync')).status,200);
    await new Promise(r=>setTimeout(r,20));await close();const restarted=await open();assert.equal(restarted.graph.connected,false);
    const restored=await post('/graph/restore');assert.equal(restored.status,200);assert(!(await restored.text()).includes(secret));
    invalid=true;assert.equal((await post('/graph/restore')).status,401);assert.equal((await post('/teams/sync')).status,400);invalid=false;
    const expired='x.'+Buffer.from(JSON.stringify({exp:1})).toString('base64url')+'.x';assert.equal((await post('/graph/token',{token:expired,persist:true})).status,400);
    const history=await fetch('http://127.0.0.1:44313/api/activity').then(r=>r.json());assert(history.items.some(r=>r.title==='POST graph/token'));assert(!JSON.stringify(history).includes(secret));
    for(const table of ['action_events','settings','local_state','runs'])assert(!JSON.stringify(s.db.prepare(`SELECT * FROM ${table}`).all()).includes(secret));
    assert.equal((await post('/graph/forget')).status,200);assert.equal(k.entries.size,0);
  }finally{await close();s.close();}
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store, seedDemo } from '../server/store.js';
import { compare, prepareComparison } from '../server/ai.js';
import { listCards, saveCardMeta, saveDeck, listDecks, rooms, markReviewed, refreshBriefing, briefingItems } from '../server/knowledge.js';
import { createJira } from '../server/jira.js';

const args={workflow:'ask',input:'고유 첫 질문 alpha',modelIds:['fast'],effort:'low'};
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
test('history is stored but fresh calls never include it; deck and followup are explicit',async()=>{
  const s=new Store(':memory:');const first=await compare(s,args,'');const cardId=first.results[0].id;
  const next=prepareComparison(s,{...args,input:'새 질문 beta'})[0];
  assert.equal(next.body.messages.length,2);assert(!JSON.stringify(next.body).includes('alpha'));
  const deck=prepareComparison(s,{...args,input:'덱 질문',contextMode:'deck',cardIds:[cardId]})[0];
  assert.equal(deck.body.messages.length,3);assert(JSON.stringify(deck.body).includes('alpha'));
  const follow=prepareComparison(s,{...args,input:'연장 질문',contextMode:'followup',parentId:cardId})[0];
  assert.deepEqual(follow.body.messages.map(m=>m.role),['system','user','assistant','user']);
  assert.throws(()=>prepareComparison(s,{...args,contextMode:'fresh',cardIds:[cardId]}),/자동 포함/);
  const settings=s.settings();settings.mode='live';s.saveSettings(settings);
  assert.throws(()=>prepareComparison(s,{...args,contextMode:'deck',cardIds:[cardId]}),/찾을 수/);
  s.close();
});
test('card metadata, exact tags, pagination and deck ordering persist',async()=>{
  const s=new Store(':memory:');const a=await compare(s,args,''),b=await compare(s,{...args,input:'beta'},'');
  const ids=[b.results[0].id,a.results[0].id];
  saveCardMeta(s,ids[1],'demo',{title:'VPC 결정',importance:3,tags:['VPC','VPC','리포트']});
  const list=listCards(s,{mode:'demo',tag:'VPC',importance:3});assert.equal(list.total,1);assert.equal(list.items[0].question,args.input);assert.deepEqual(list.items[0].tags,['VPC','리포트']);
  assert.equal(listCards(s,{mode:'demo',tag:'VP'}).total,0);
  saveDeck(s,'demo','진행 현황',ids);assert.deepEqual(listDecks(s,'demo')[0].cardIds,ids);s.close();
});
test('review markers survive unchanged sync, catch edited old messages and concurrent arrival',()=>{
  const s=new Store(':memory:');s.upsertChat('a',{id:'c',title:'Room'});
  const message={id:'1',body:'확인해주세요',createdDateTime:'2026-01-01T00:00:00Z'};
  s.saveMessages('a','c',[message]);s.watermark('a','c','2026-10-08T00:00:00Z');
  const snapshot=rooms(s,'a')[0];assert.equal(snapshot.unreviewed,1);
  s.saveMessages('a','c',[{...message,id:'2'}]);
  markReviewed(s,'a','c',snapshot.cached_seq);assert.equal(rooms(s,'a')[0].unreviewed,1);
  markReviewed(s,'a','c',rooms(s,'a')[0].cached_seq);s.saveMessages('a','c',[message]);assert.equal(rooms(s,'a')[0].unreviewed,0);
  s.saveMessages('a','c',[{...message,body:'수정된 요청'}]);assert.equal(rooms(s,'a')[0].unreviewed,1);
  assert.equal(s.chat('a','c').watermark,'2026-10-08T00:00:00Z');assert.equal(rooms(s,'b').length,0);s.close();
});
test('briefing refresh preserves decisions and reopens a changed source',()=>{
  const s=new Store(':memory:');seedDemo(s);const scope={mode:'demo',account:'demo',emailAccount:'demo'};
  refreshBriefing(s,scope);const first=briefingItems(s,scope).find(r=>r.source==='teams');assert(first);
  s.db.prepare("UPDATE brief_items SET status='done',priority=3 WHERE id=?").run(first.id);
  refreshBriefing(s,scope);assert(!briefingItems(s,scope).some(r=>r.id===first.id));
  s.saveMessages('demo',first.chat_id,[{id:first.source_id,body:'긴급 검토 부탁드립니다. 변경된 요청',createdDateTime:first.occurred,lastModifiedDateTime:new Date().toISOString()}]);
  refreshBriefing(s,scope);const reopened=briefingItems(s,scope).find(r=>r.id===first.id);assert.equal(reopened.status,'open');assert.equal(reopened.priority,3);
  assert.equal(briefingItems(s,{...scope,account:'other',emailAccount:'other'}).length,0);s.close();
});
test('selected briefing source enters request and JIRA deduplicates across model drafts',async()=>{
  const s=new Store(':memory:');const cfg=s.settings();cfg.mode='live';cfg.jira.baseUrl='https://jira.example.test';s.saveSettings(cfg);
  s.upsertChat('a',{id:'c',title:'Project'});s.saveMessages('a','c',[{id:'m',body:'검토 부탁드립니다',createdDateTime:new Date().toISOString()}]);
  const scope={mode:'live',account:'a',emailAccount:'outlook-local'};refreshBriefing(s,scope);const source=briefingItems(s,scope)[0];
  const request={...args,workflow:'email-jira',modelIds:['fast','balanced'],briefingIds:[source.id]};
  const prepared=prepareComparison(s,request);assert(JSON.stringify(prepared[0].body.messages).includes('검토 부탁드립니다'));
  const out=await compare(s,request,'key',{fetcher:async()=>json({choices:[{message:{content:'draft'}}],usage:{prompt_tokens:10,completion_tokens:10}})});
  const draft={resultId:out.results[0].id,summary:'Task',description:'Desc',project:'VPC',issueType:'Task'};
  let calls=0;const opts={fetcher:async()=>{calls++;return json({key:'VPC-1'});}};
  await createJira(s,draft,'pat',opts);assert.equal(briefingItems(s,{...scope,status:'jira'})[0].issue_key,'VPC-1');
  await assert.rejects(()=>createJira(s,{...draft,resultId:out.results[1].id},'pat',opts),/이미/);assert.equal(calls,1);s.close();
});

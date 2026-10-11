import express from 'express';
import { randomBytes } from 'node:crypto';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Store, seedDemo, dayKey } from './store.js';
import { workflows } from '../shared/workflows.js';
import { graphGet, syncTeams, discoverChats } from './graph.js';
import { compare, prepareComparison, endpoint } from './ai.js';
import { readOutlook, threadCandidates } from './outlook.js';
import { createJira } from './jira.js';
import * as knowledge from './knowledge.js';
import * as ops from './operations.js';
import { guides,saveGuide } from './guides.js';
import { pipelineRunner, executionBoard } from './pipelines.js';
import { roomTags, saveRoomTags, tagCollection } from './tags.js';
import { auditActions, listActivity, tagActivity, activityDetail } from './activity.js';
import { createGraphVault, disabledVault } from './vault.js';

const modelSchema=z.object({id:z.string().min(1).max(80),name:z.string().min(1).max(80),model:z.string().min(1).max(150),inputPrice:z.number().min(0).max(10000),outputPrice:z.number().min(0).max(10000),effortField:z.enum(['','reasoning_effort','reasoning.effort']),effortMap:z.object({low:z.string().min(1),high:z.string().min(1),max:z.string().min(1)}),tokenField:z.enum(['max_completion_tokens','max_tokens'])});
const settingsSchema=z.object({mode:z.enum(['demo','live']),monthlyBudget:z.number().positive().max(100000),timezone:z.string().refine(x=>{try{new Intl.DateTimeFormat('en',{timeZone:x});return true;}catch{return false;}}),baseUrl:z.string().url(),protocol:z.enum(['openai','anthropic']).default('openai'),maxOutputTokens:z.number().int().min(128).max(32000),models:z.array(modelSchema).min(1).max(30).refine(a=>new Set(a.map(m=>m.id)).size===a.length,'모델 ID는 중복될 수 없습니다.'),preferences:z.record(z.object({modelIds:z.array(z.string()).max(3),effort:z.enum(['low','high','max'])})),jira:z.object({baseUrl:z.string(),project:z.string(),issueType:z.string(),apiVersion:z.enum(['2','3'])}),outlook:z.object({path:z.string(),query:z.string().max(10000)})});
const idsSchema=z.array(z.string().min(1).max(100)).max(20).refine(ids=>new Set(ids).size===ids.length);
const compareSchema=z.object({workflow:z.string(),input:z.string().trim().min(1).max(100000),guideVersion:z.number().int().positive().optional(),instruction:z.string().max(4000).default(''),modelIds:z.array(z.string()).min(1).max(3).refine(x=>new Set(x).size===x.length),effort:z.enum(['low','high','max']).default('low'),fresh:z.boolean().default(false),contextMode:z.enum(['fresh','deck','followup']).default('fresh'),cardIds:idsSchema.default([]),parentId:z.string().nullable().default(null),briefingIds:idsSchema.default([])});
const dateSchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,'올바른 날짜가 필요합니다.');
const teamSchema=z.object({day:dateSchema,person:z.string().trim().min(1).max(100),product:z.string().max(100),work:z.string().trim().min(1).max(5000),status:z.enum(['예정','진행','차단','완료','확인 필요']),due:z.union([dateSchema,z.literal('')]),source:z.string().max(500)});

export function createApp({store=new Store(join(process.env.MYTOOLS_DATA_DIR || 'data','mytools.sqlite')),port=4310,graphOptions={},aiOptions={},jiraOptions={},vault=store.path===':memory:'?disabledVault():createGraphVault(store.path)}={}) {
  seedDemo(store);
  store.db.exec('CREATE TABLE IF NOT EXISTS local_state (key TEXT PRIMARY KEY, value TEXT)');
  let graphSession=null, activeSync=null, discovering=false,jiraSyncing=false;
  let authenticating=false;
  // Startup discovers only this app's credential. No Graph call until the user continues.
  const vaultReady=vault.inspect().catch(()=>{});
  let apiKey=process.env.MYTOOLS_API_KEY || '',jiraToken=process.env.MYTOOLS_JIRA_TOKEN || '';
  const runner=pipelineRunner(store,aiOptions);
  const csrf=randomBytes(32).toString('hex');
  const origins=new Set([`http://127.0.0.1:${port}`,`http://localhost:${port}`,'http://127.0.0.1:5173','http://localhost:5173']);
  const hosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`,'127.0.0.1:5173','localhost:5173']);
  const app=express(); app.disable('x-powered-by');
  app.use((req,res,next)=>{
    if (!hosts.has(req.headers.host)) return res.status(403).json({error:'로컬 주소로 접속하세요.'});
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    if (req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control','no-store');
      if (req.headers.origin && !origins.has(req.headers.origin)) return res.status(403).json({error:'허용되지 않은 출처입니다.'});
      if (req.headers['sec-fetch-site']==='cross-site') return res.status(403).json({error:'외부 사이트에서 접근할 수 없습니다.'});
      if (!['GET','HEAD'].includes(req.method) && (req.headers['x-mytools-token']!==csrf || !req.is('application/json'))) return res.status(403).json({error:'앱을 새로고침한 후 다시 시도하세요.'});
    }
    next();
  });
  app.use(express.json({limit:'2mb'}));
  app.use(auditActions(store));
  const codeTasks={'/api/teams/discover':'teams-discover','/api/outlook/import':'outlook-import','/api/jira/sync':'jira-sync','/api/jira/issues':'jira-create'};
  app.use((req,res,next)=>{
    if(req.method==='POST'&&codeTasks[req.path]){
      const id=store.startRun(codeTasks[req.path],store.settings().mode),json=res.json.bind(res);
      res.json=body=>{store.updateRun(id,res.statusCode>=400?'error':'success',body.error||JSON.stringify(body));return json(body);};
    }
    next();
  });
  function account() { return store.settings().mode==='demo'?'demo':store.db.prepare("SELECT value FROM local_state WHERE key='account'").get()?.value || 'live-unconnected'; }
  function emailAccount() { return store.settings().mode==='demo'?'demo':'outlook-local'; }
  function graphReady(){return !!graphSession&&graphSession.acceptedDay===dayKey(store.settings().timezone)&&(!graphSession.expiresAt||Date.parse(graphSession.expiresAt)>Date.now());}
  const scheduler=ops.startScheduler({settings:()=>ops.operationsSettings(store),canRun:()=>store.settings().mode==='live'&&graphReady()&&!activeSync&&!discovering&&!authenticating,run:async()=>{await runSync().completion;}});
  app.get('/api/state',(req,res)=>{
    const settings=store.settings();
    res.json({csrf,settings,workflows,budget:store.budget(),counts:{...store.counts(account()),emails:store.counts(emailAccount()).emails},runs:store.runs(),results:store.resultSummaries(),account:account(),today:dayKey(settings.timezone),credentials:{api:!!apiKey,jira:!!jiraToken},graph:{connected:!!graphSession,acceptedDay:graphSession?.acceptedDay||null,displayName:graphSession?.displayName||'',expiresAt:graphSession?.expiresAt||null,vault:vault.status()},syncing:!!activeSync});
  });
  app.put('/api/settings',(req,res)=>{
    if(activeSync||discovering||authenticating||jiraSyncing||runner.active||store.db.prepare("SELECT 1 FROM results WHERE status='pending'").get()) return res.status(409).json({error:'진행 중인 동기화 / 인증 / AI 실행이 끝난 뒤 설정을 변경하세요.'});
    const next=settingsSchema.parse(req.body); endpoint(next.baseUrl,'chat/completions');
    if (next.jira.baseUrl) endpoint(next.jira.baseUrl,'rest/api/2/issue');
    const old=store.settings();
    if (old.baseUrl!==next.baseUrl||old.protocol!==next.protocol) apiKey='';
    if (old.jira.baseUrl!==next.jira.baseUrl) jiraToken='';
    store.saveSettings(next); res.json({ok:true});
  });
  app.post('/api/credentials',(req,res)=>{
    const b=z.object({apiKey:z.string().max(10000).optional(),jiraToken:z.string().max(10000).optional()}).parse(req.body);
    if(b.apiKey!==undefined) apiKey=b.apiKey.trim(); if(b.jiraToken!==undefined) jiraToken=b.jiraToken.trim(); res.json({ok:true});
  });
  async function acceptToken(token,persist=false){
    const clean=token.replace(/^Bearer\s+/i,'');
    const me=await graphGet('me?$select=id,displayName',clean,graphOptions);
    if (!me.id) throw new Error('Graph 계정 확인에 실패했습니다.');
    // exp is only a UX hint; Graph /me, not a decoded claim, verifies the credential.
    let expiresAt=null;
    try { const exp=JSON.parse(Buffer.from(clean.split('.')[1],'base64url')).exp; if(Number.isFinite(exp)) expiresAt=new Date(exp*1000).toISOString(); } catch { /* Opaque access tokens are valid too. */ }
    if(expiresAt&&Date.parse(expiresAt)<=Date.now())throw new Error('만료된 토큰입니다. 새 토큰을 입력하세요.');
    if(persist)await vault.write(clean);
    graphSession={token:clean,account:me.id,displayName:me.displayName,acceptedDay:dayKey(store.settings().timezone),expiresAt};
    store.db.prepare("INSERT INTO local_state VALUES('account',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(me.id);
    return {ok:true,displayName:me.displayName,saved:vault.status().saved};
  }
  app.post('/api/graph/token',async(req,res)=>{
    if(activeSync||discovering||authenticating)return res.status(409).json({error:'진행 중인 동기화/인증이 끝난 뒤 토큰을 갱신하세요.'});
    if(store.settings().mode!=='live')throw new Error('실제 모드에서만 토큰을 입력하세요.');
    const {token,persist}=z.object({token:z.string().trim().min(10).max(20000),persist:z.boolean().default(true)}).parse(req.body);
    authenticating=true;try{await vaultReady;res.json(await acceptToken(token,persist));}finally{authenticating=false;}
  });
  app.post('/api/graph/restore',async(req,res)=>{
    if(activeSync||discovering||authenticating)throw new Error('진행 중인 동기화/인증이 끝난 뒤 복원하세요.');
    if(store.settings().mode!=='live')throw new Error('실제 모드에서만 복원하세요.');
    authenticating=true;try{await vaultReady;const token=await vault.read();if(!token)throw new Error('저장된 토큰이 없습니다. 새 토큰을 입력하세요.');res.json(await acceptToken(token));}catch(e){graphSession=null;throw e;}finally{authenticating=false;}
  });
  app.post('/api/graph/forget',async(req,res)=>{if(activeSync||discovering||authenticating)throw new Error('동기화/인증 후 삭제하세요.');authenticating=true;try{await vaultReady;await vault.remove();graphSession=null;res.json({ok:true});}finally{authenticating=false;}});
  app.post('/api/graph/disconnect',(req,res)=>{if(activeSync||discovering||authenticating) return res.status(409).json({error:'동기화/인증 중에는 연결을 해제할 수 없습니다.'}); graphSession=null; res.json({ok:true});});
  function runSync(){
    if(activeSync||discovering||authenticating) throw new Error('이미 동기화/인증이 진행 중입니다.');
    const mode=store.settings().mode;
    if(mode==='live' && !graphReady()) throw new Error('Graph 토큰이 없거나 만료되었습니다. UI에서 새 토큰을 입력하세요.');
    const id=store.startRun('teams-cache',mode);
    if(mode==='demo') {store.updateRun(id,'success','데모 샘플 사용. 외부 API 및 LLM 호출 없음.');return {id,completion:Promise.resolve()};}
    activeSync=id;
    const completion=syncTeams(store,graphSession,detail=>store.updateRun(id,'running',detail),graphOptions).then(out=>{
      store.updateRun(id,out.errors.length?'partial':'success',`${out.chats}개 채팅 완료 · ${out.messages}건 처리 (중복 포함)${out.errors.length?` · ${out.errors.length}개 실패: ${out.errors.map(e=>e.error).join('; ')}`:''}`);
    }).catch(e=>{ if(e.status===401) graphSession=null; store.updateRun(id,'error',e.message); }).finally(()=>{activeSync=null;});
    return {id,completion};
  }
  app.post('/api/teams/sync',(req,res)=>res.json({id:runSync().id}));
  app.get('/api/runs/:id',(req,res)=>{const run=store.db.prepare('SELECT * FROM runs WHERE id=? AND mode=?').get(req.params.id,store.settings().mode);if(!run)return res.status(404).json({error:'실행 기록이 없습니다.'});res.json(run);});
  app.get('/api/activity',(req,res)=>{const b=z.object({tag:z.string().max(40).default(''),q:z.string().max(200).default(''),kind:z.enum(['','ai','code','action']).default(''),page:z.coerce.number().int().min(0).max(100000).default(0)}).parse(req.query);res.json(listActivity(store,b));});
  app.get('/api/activity/:kind/:id',(req,res)=>{const kind=z.enum(['ai','code','action']).parse(req.params.kind);res.json(activityDetail(store,kind,req.params.id));});
  app.put('/api/activity/:kind/:id/tags',(req,res)=>{const kind=z.enum(['ai','code','action']).parse(req.params.kind),b=z.object({tags:z.array(z.string().trim().min(1).max(40)).max(12)}).parse(req.body);res.json(tagActivity(store,kind,req.params.id,b.tags));});
  app.get('/api/messages',(req,res)=>res.json(store.search(account(),String(req.query.q||'').slice(0,500),100,String(req.query.chatId||''))));
  app.get('/api/rooms',(req,res)=>{const tags=roomTags(store,account());res.json(knowledge.rooms(store,account()).map(r=>({...r,tags:tags.get(r.id)||[],interested:ops.interested(store,account(),r.id)})));});
  app.put('/api/rooms/tags',(req,res)=>{const b=z.object({chatId:z.string(),tags:z.array(z.string().trim().min(1).max(40)).max(12)}).parse(req.body);res.json({tags:saveRoomTags(store,account(),b.chatId,b.tags)});});
  app.get('/api/rooms/collection',(req,res)=>{const b=z.object({tag:z.string().min(1).max(40),day:dateSchema}).parse(req.query);res.json(tagCollection(store,account(),b.tag,b.day));});
  app.put('/api/rooms/interest',(req,res)=>{
    const b=z.object({chatId:z.string(),interested:z.boolean()}).parse(req.body);
    if(activeSync) return res.status(409).json({error:'캐싱 완료 후 관심 설정을 변경하세요.'});
    ops.setInterest(store,account(),b.chatId,b.interested);res.json({ok:true});
  });
  app.post('/api/teams/discover',async(req,res)=>{
    if(store.settings().mode==='demo')return res.json({count:store.counts('demo').chats});
    if(!graphReady())throw new Error('Graph 토큰이 없거나 만료되었습니다. UI에서 새 토큰을 입력하세요.');
    if(activeSync||discovering||authenticating)throw new Error('이미 조회/수집/인증 중입니다.');
    discovering=true;try{res.json(await discoverChats(store,graphSession,graphOptions));}catch(e){if(e.status===401)graphSession=null;throw e;}finally{discovering=false;}
  });
  app.get('/api/rooms/daily',(req,res)=>{const b=z.object({chatId:z.string(),day:dateSchema}).parse(req.query);res.json(ops.dailyRoom(store,account(),b.chatId,b.day));});
  app.get('/api/operations',(req,res)=>res.json({settings:ops.operationsSettings(store),scheduler:scheduler.status(),connectors:store.db.prepare('SELECT * FROM connector_state').all(),jiraSyncing,due:ops.dueIssues(store)}));
  app.put('/api/operations',(req,res)=>{const b=z.object({enabled:z.boolean(),intervalMinutes:z.number().int().min(5).max(1440),jql:z.string().trim().min(1).max(4000),dateField:z.string().regex(/^(duedate|customfield_\d+)$/),dueDays:z.number().int().min(0).max(90)}).parse(req.body);if(jiraSyncing)throw new Error('JIRA 수집 중에는 설정을 변경할 수 없습니다.');store.db.prepare('UPDATE operations_settings SET json=? WHERE id=1').run(JSON.stringify(b));res.json({ok:true});});
  app.post('/api/jira/sync',async(req,res)=>{if(store.settings().mode==='demo')return res.json({count:1,demo:true});if(jiraSyncing)throw new Error('JIRA 수집 중입니다.');jiraSyncing=true;try{res.json(await ops.syncJira(store,jiraToken,jiraOptions));}finally{jiraSyncing=false;}});
  app.get('/api/guides/:workflow',(req,res)=>res.json(guides(store,req.params.workflow)));
  app.post('/api/guides/:workflow',(req,res)=>{const b=z.object({baseVersion:z.number().int().positive(),content:z.string().trim().min(1).max(20000),note:z.string().trim().min(1).max(200)}).parse(req.body);res.json(saveGuide(store,req.params.workflow,b));});
  app.get('/api/team',(req,res)=>{const b=z.object({from:dateSchema,to:dateSchema}).parse(req.query);res.json(ops.teamEntries(store,b.from,b.to));});
  function insertTeam(b){return Number(store.db.prepare('INSERT INTO team_entries(day,person,product,work,status,due,source,created,mode) VALUES(?,?,?,?,?,?,?,?,?)').run(b.day,b.person,b.product,b.work,b.status,b.due,b.source,new Date().toISOString(),store.settings().mode).lastInsertRowid);}
  app.post('/api/team',(req,res)=>res.json({id:insertTeam(teamSchema.parse(req.body))}));
  app.post('/api/team/import',(req,res)=>{
    const b=z.object({resultId:z.string(),entries:z.array(teamSchema).min(1).max(100)}).parse(req.body);
    const result=store.db.prepare("SELECT id,group_id FROM results WHERE id=? AND workflow='team-extract' AND status='success' AND mode=?").get(b.resultId,store.settings().mode);
    if(!result)throw new Error('이 모드의 직원 업무 추출 결과가 필요합니다.');
    if(store.db.prepare('SELECT t.result_id FROM team_imports t JOIN results r ON r.id=t.result_id WHERE r.group_id=?').get(result.group_id))return res.json({count:0,duplicate:true});
    store.transaction(()=>{for(const entry of b.entries)insertTeam({...entry,source:`결과:${b.resultId} ${entry.source}`.slice(0,500)});store.db.prepare('INSERT INTO team_imports VALUES(?,?)').run(b.resultId,new Date().toISOString());});res.json({count:b.entries.length});
  });
  app.get('/api/team/report',(req,res)=>{const b=z.object({from:dateSchema,to:dateSchema}).parse(req.query);const out=ops.weeklyInput(store,b.from,b.to);if(out.input.length>95000)throw new Error('입력 95,000자 한도. 기간을 줄이세요.');res.json(out);});
  app.post('/api/rooms/review',(req,res)=>{
    const b=z.object({chatId:z.string(),through:z.number().int().min(0)}).parse(req.body);
    knowledge.markReviewed(store,account(),b.chatId,b.through);res.json({ok:true});
  });
  app.get('/api/cards',(req,res)=>{
    const query=z.object({q:z.string().max(500).default(''),tag:z.string().max(40).default(''),importance:z.coerce.number().int().min(-1).max(3).default(-1),page:z.coerce.number().int().min(0).max(100000).default(0)}).parse(req.query);
    const data=knowledge.listCards(store,{...query,mode:store.settings().mode});
    res.json({...data,items:data.items.map(c=>({...c,question:c.question?.slice(0,500)||'',answer:c.answer?.slice(0,1200)||'',preview:true}))});
  });
  app.get('/api/cards/:id',(req,res)=>res.json(knowledge.getCard(store,req.params.id,store.settings().mode)));
  app.put('/api/cards/:id',(req,res)=>{
    const b=z.object({title:z.string().max(150),importance:z.number().int().min(0).max(3),tags:z.array(z.string().trim().min(1).max(40)).max(12)}).parse(req.body);
    knowledge.saveCardMeta(store,req.params.id,store.settings().mode,b);res.json({ok:true});
  });
  app.get('/api/decks',(req,res)=>res.json(knowledge.listDecks(store,store.settings().mode)));
  app.post('/api/decks',(req,res)=>{const b=z.object({name:z.string().trim().min(1).max(100),cardIds:idsSchema.refine(ids=>ids.length>0)}).parse(req.body);res.json(knowledge.saveDeck(store,store.settings().mode,b.name,b.cardIds));});
  app.get('/api/briefing',(req,res)=>{
    const b=z.object({days:z.coerce.number().int().min(1).max(3650).default(90),status:z.enum(['open','done','dismissed','jira','all']).default('open')}).parse(req.query);
    const scope={mode:store.settings().mode,account:account(),emailAccount:emailAccount()};
    const scan=knowledge.refreshBriefing(store,{...scope,days:b.days});
    res.json({items:knowledge.briefingItems(store,{...scope,status:b.status}),scan,myEmail:knowledge.profile(store,scope.mode),rooms:knowledge.rooms(store,scope.account),lastOutlook:store.db.prepare('SELECT MAX(sent_at) latest FROM emails WHERE account=?').get(scope.emailAccount).latest});
  });
  app.put('/api/briefing/profile',(req,res)=>{const b=z.object({email:z.union([z.string().email(),z.literal('')])}).parse(req.body);knowledge.setProfile(store,store.settings().mode,b.email);res.json({ok:true});});
  app.put('/api/briefing/:id',(req,res)=>{
    const b=z.object({status:z.enum(['open','done','dismissed']).optional(),priority:z.number().int().min(0).max(3).optional()}).parse(req.body);
    const item=knowledge.resolveBriefing(store,[req.params.id],store.settings().mode)[0];
    store.db.prepare('UPDATE brief_items SET status=?,priority=? WHERE id=?').run(b.status||item.status,b.priority??item.priority,item.id);res.json({ok:true});
  });
  app.get('/api/emails',(req,res)=>{
    const emails=store.emails(emailAccount()); const me=String(req.query.me||'');
    res.json(me?threadCandidates(emails,me):emails);
  });
  app.post('/api/outlook/import',(req,res)=>{
    if(store.settings().mode==='demo') return res.json({count:store.counts('demo').emails,demo:true});
    const items=readOutlook(store.settings().outlook); store.saveEmails(emailAccount(),items); res.json({count:items.length});
  });
  app.post('/api/ai/estimate',(req,res)=>{
    const entries=prepareComparison(store,compareSchema.parse(req.body));
    res.json({reserved:entries.reduce((s,e)=>s+e.reserved,0),cached:entries.filter(e=>e.cached).length,mode:store.settings().mode});
  });
  app.post('/api/ai/compare',async(req,res)=>{if(runner.active)throw new Error('배치 실행 중입니다. 완료 후 개별 실행하세요.');res.json(await compare(store,compareSchema.parse(req.body),apiKey,aiOptions));});
  const batchSchema=z.object({title:z.string().trim().min(1).max(100),concurrency:z.number().int().min(1).max(3),tasks:z.array(z.object({title:z.string().trim().min(1).max(100),request:compareSchema})).min(1).max(12)});
  app.post('/api/pipelines/estimate',(req,res)=>{const b=batchSchema.parse(req.body),entries=b.tasks.flatMap(t=>prepareComparison(store,t.request));res.json({reserved:entries.reduce((n,e)=>n+(e.mode==='live'?e.reserved:0),0),requests:entries.length,cached:entries.filter(e=>e.cached).length});});
  app.post('/api/pipelines', (req,res)=>res.status(202).json(runner.submit(batchSchema.parse(req.body),apiKey)));
  app.post('/api/pipelines/:id/cancel',(req,res)=>res.json(runner.cancel(req.params.id)));
  app.get('/api/executions',(req,res)=>res.json({...executionBoard(store),active:runner.active}));
  app.get('/api/results/:groupId',(req,res)=>res.json({
    groupId:req.params.groupId,
    ...store.db.prepare('SELECT workflow,input,instruction FROM analysis_inputs WHERE group_id=?').get(req.params.groupId),
    context:store.db.prepare('SELECT mode,card_ids,parent_id,briefing_ids FROM request_context WHERE group_id=?').get(req.params.groupId),
    results:store.db.prepare('SELECT r.*,g.version guide_version FROM results r LEFT JOIN execution_guides g ON r.group_id=g.group_id WHERE r.group_id=?').all(req.params.groupId)
  }));
  app.get('/api/reports',(req,res)=>res.json(store.db.prepare("SELECT id,workflow,model_name,content FROM results WHERE workflow IN ('weekly','monthly','scrum','meeting','chat-daily') AND mode=? AND status='success' ORDER BY created DESC LIMIT 30").all(store.settings().mode)));
  app.put('/api/preferences',(req,res)=>{
    const b=z.object({workflow:z.string(),modelIds:z.array(z.string()).min(1).max(3),effort:z.enum(['low','high','max']),resultIds:z.array(z.string()).max(3),groupId:z.string()}).parse(req.body);
    const settings=store.settings();
    if(!workflows.some(w=>w.id===b.workflow)||b.modelIds.some(id=>!settings.models.some(m=>m.id===id))) throw new Error('업무 또는 모델을 찾을 수 없습니다.');
    const group=store.db.prepare("SELECT id,model_id FROM results WHERE group_id=? AND workflow=? AND status='success'").all(b.groupId,b.workflow);
    if(b.resultIds.some(id=>!group.some(r=>r.id===id))||b.resultIds.length!==b.modelIds.length||b.modelIds.some(id=>!group.some(r=>r.model_id===id&&b.resultIds.includes(r.id)))) throw new Error('선택한 결과와 모델이 일치하지 않습니다.');
    store.transaction(()=>{
      store.db.prepare('UPDATE results SET selected=0 WHERE group_id=?').run(b.groupId);
      for(const id of b.resultIds) store.db.prepare('UPDATE results SET selected=1 WHERE id=?').run(id);
      settings.preferences[b.workflow]={modelIds:b.modelIds,effort:b.effort}; store.saveSettings(settings);
    });
    res.json({ok:true});
  });
  app.post('/api/jira/issues',async(req,res)=>{
    const draft=z.object({resultId:z.string(),summary:z.string().trim().min(1).max(255),description:z.string().trim().min(1).max(30000),project:z.string().regex(/^[A-Z][A-Z0-9_]*$/),issueType:z.string().min(1).max(100)}).parse(req.body);
    res.json(await createJira(store,draft,jiraToken,jiraOptions));
  });
  app.use('/api',(req,res)=>res.status(404).json({error:'API 경로를 찾을 수 없습니다.'}));
  const dist=resolve('dist');
  if(existsSync(dist)) {
    app.use(express.static(dist,{setHeaders:res=>res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'")}));
    app.get('/{*path}',(req,res)=>res.sendFile(join(dist,'index.html')));
  }
  app.use((err,req,res,next)=>{
    if(res.headersSent) return next(err);
    res.status(err.status && err.status>=400 && err.status<600 ? err.status:400).json({error:err instanceof z.ZodError?err.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join(' · '):err.message || '요청에 실패했습니다.'});
  });
  return {app,store,stop:()=>scheduler.stop()};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const port=Number(process.env.MYTOOLS_PORT||4310);
  const {app}=createApp({port});
  app.listen(port,'127.0.0.1',()=>console.log(`mytools local server: http://127.0.0.1:${port}`));
}

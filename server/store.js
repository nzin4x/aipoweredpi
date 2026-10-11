import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaultSettings } from '../shared/workflows.js';
import { initKnowledge, trackMessage } from './knowledge.js';
import { initOperations } from './operations.js';
import { initGuides } from './guides.js';
import { initActivity } from './activity.js';

export function monthKey(timezone = 'Asia/Seoul', date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year:'numeric', month:'2-digit' }).formatToParts(date);
  return `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}`;
}
export function dayKey(timezone = 'Asia/Seoul', date = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(date);
  return ['year','month','day'].map(t => p.find(x => x.type === t).value).join('-');
}
export class Store {
  constructor(path = 'data/mytools.sqlite') {
    this.path=path;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive:true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chats (account TEXT, id TEXT, title TEXT, watermark TEXT, PRIMARY KEY(account,id));
      CREATE TABLE IF NOT EXISTS messages (account TEXT, chat_id TEXT, id TEXT, sender TEXT, created TEXT, modified TEXT, body TEXT, deleted INTEGER, url TEXT, PRIMARY KEY(account,chat_id,id));
      CREATE INDEX IF NOT EXISTS message_date ON messages(account,modified);
      CREATE TABLE IF NOT EXISTS emails (account TEXT, id TEXT, thread_id TEXT, subject TEXT, sender TEXT, recipients TEXT, sent_at TEXT, body TEXT, PRIMARY KEY(account,id));
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, workflow TEXT, mode TEXT, status TEXT, started TEXT, finished TEXT, detail TEXT);
      CREATE TABLE IF NOT EXISTS results (id TEXT PRIMARY KEY, group_id TEXT, workflow TEXT, model_id TEXT, model_name TEXT, effort TEXT, mode TEXT, month TEXT, status TEXT, reserved REAL, cost REAL, input_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER, latency INTEGER, content TEXT, error TEXT, selected INTEGER DEFAULT 0, cache_key TEXT, cached INTEGER DEFAULT 0, created TEXT, usage_estimated INTEGER DEFAULT 0);
      CREATE INDEX IF NOT EXISTS results_cache ON results(cache_key,status);
      CREATE TABLE IF NOT EXISTS jira_links (result_id TEXT PRIMARY KEY, issue_key TEXT, url TEXT, created TEXT);
      CREATE TABLE IF NOT EXISTS analysis_inputs (group_id TEXT PRIMARY KEY, workflow TEXT, input TEXT, instruction TEXT, created TEXT);
    `);
    initKnowledge(this);
    initOperations(this);
    initGuides(this);
    initActivity(this);
    this.db.exec(`CREATE TABLE IF NOT EXISTS chat_tags(account TEXT,chat_id TEXT,tag TEXT,PRIMARY KEY(account,chat_id,tag));
      CREATE TABLE IF NOT EXISTS pipelines(id TEXT PRIMARY KEY,title TEXT,mode TEXT,status TEXT,created TEXT,started TEXT,finished TEXT,concurrency INTEGER);
      CREATE TABLE IF NOT EXISTS pipeline_jobs(id TEXT PRIMARY KEY,pipeline_id TEXT,title TEXT,position INTEGER);`);
    const columns=this.db.prepare('PRAGMA table_info(results)').all().map(c=>c.name);
    for(const column of ['started','finished']) if(!columns.includes(column)) this.db.exec(`ALTER TABLE results ADD COLUMN ${column} TEXT`);
    const recoveredAt=new Date().toISOString();
    // Queued jobs provably never entered executeEntry; do not retain their reservation.
    this.db.prepare("UPDATE results SET status='cancelled',finished=?,error='서버 재시작 전 미실행 작업. 자동 재실행하지 않습니다.' WHERE status='pending' AND started IS NULL AND id IN (SELECT id FROM pipeline_jobs)").run(recoveredAt);
    this.db.prepare("UPDATE pipelines SET status='interrupted',finished=? WHERE status IN ('queued','running')").run(recoveredAt);
    this.db.prepare("UPDATE chat_state SET sync_status='interrupted',error='서버 재시작. 마지막 성공 체크포인트부터 다시 수집하세요.' WHERE sync_status='running'").run();
    this.db.prepare('INSERT OR IGNORE INTO settings VALUES(1,?)').run(JSON.stringify(defaultSettings));
    this.db.prepare("UPDATE runs SET status='interrupted',finished=?,detail=? WHERE status='running'").run(new Date().toISOString(), '서버가 재시작되었습니다. 다시 실행하면 완료된 채팅 이후부터 이어갑니다.');
    this.db.prepare("UPDATE results SET status='uncertain',finished=?,error='서버 재시작으로 사용량 확인 불가. 예약 비용 유지.' WHERE status='pending'").run(recoveredAt);
  }
  settings() { return JSON.parse(this.db.prepare('SELECT json FROM settings WHERE id=1').get().json); }
  saveSettings(value) { this.db.prepare('UPDATE settings SET json=? WHERE id=1').run(JSON.stringify(value)); }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const value = fn(); this.db.exec('COMMIT'); return value; } catch(e) { this.db.exec('ROLLBACK'); throw e; } }
  budget() {
    const s = this.settings(), month = monthKey(s.timezone);
    const row = this.db.prepare(`SELECT COALESCE(SUM(CASE WHEN status='success' THEN cost ELSE 0 END),0) spent,
      COALESCE(SUM(CASE WHEN status IN ('pending','uncertain') THEN reserved ELSE 0 END),0) reserved,
      COALESCE(SUM(input_tokens + output_tokens),0) tokens, COUNT(*) calls FROM results WHERE mode='live' AND month=? AND cached=0`).get(month);
    return { ...row, month, limit:s.monthlyBudget, remaining:Math.max(0,s.monthlyBudget-row.spent-row.reserved) };
  }
  reserve(entries, persist=()=>{}) {
    this.transaction(() => {
      const needed = entries.filter(e => e.mode === 'live').reduce((a,e) => a+e.reserved,0);
      if (needed > this.budget().remaining) throw new Error(`이번 달 잔여 예산을 넘습니다. 필요한 예상 상한: $${needed.toFixed(4)}`);
      const stmt = this.db.prepare('INSERT INTO results(id,group_id,workflow,model_id,model_name,effort,mode,month,status,reserved,cost,input_tokens,output_tokens,reasoning_tokens,latency,content,error,cache_key,cached,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
      for (const e of entries) stmt.run(e.id,e.groupId,e.workflow,e.model.id,e.model.name,e.effort,e.mode,monthKey(this.settings().timezone),'pending',e.reserved,0,0,0,0,0,'','',e.cacheKey,0,new Date().toISOString());
      persist();
    });
  }
  finishResult(id, fields) {
    if(fields.status && fields.status!=='pending') fields={...fields,finished:new Date().toISOString()};
    const allow = ['status','cost','input_tokens','output_tokens','reasoning_tokens','latency','content','error','cached','usage_estimated','started','finished'];
    const keys = Object.keys(fields).filter(k => allow.includes(k));
    this.db.prepare(`UPDATE results SET ${keys.map(k=>`${k}=?`).join(',')} WHERE id=?`).run(...keys.map(k=>fields[k]),id);
    return this.db.prepare('SELECT * FROM results WHERE id=?').get(id);
  }
  results() { return this.db.prepare('SELECT * FROM results ORDER BY created DESC LIMIT 150').all(); }
  resultSummaries() { return this.db.prepare('SELECT id,group_id,workflow,model_id,model_name,effort,mode,status,cost,input_tokens,output_tokens,latency,selected,cached,created FROM results ORDER BY created DESC LIMIT 150').all(); }
  cached(key) { return this.db.prepare("SELECT * FROM results WHERE cache_key=? AND status='success' AND cached=0 AND error='' ORDER BY created DESC LIMIT 1").get(key); }
  startRun(workflow,mode) { const id=randomUUID(); this.db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?)').run(id,workflow,mode,'running',new Date().toISOString(),null,'준비 중'); return id; }
  updateRun(id,status,detail) { this.db.prepare('UPDATE runs SET status=?,detail=?,finished=? WHERE id=?').run(status,detail,status==='running'?null:new Date().toISOString(),id); }
  runs() { return this.db.prepare('SELECT * FROM runs ORDER BY started DESC LIMIT 40').all(); }
  chat(account,id) { return this.db.prepare('SELECT * FROM chats WHERE account=? AND id=?').get(account,id); }
  upsertChat(account,c) { this.db.prepare('INSERT INTO chats(account,id,title) VALUES(?,?,?) ON CONFLICT(account,id) DO UPDATE SET title=excluded.title').run(account,c.id,c.topic || c.title || `${c.chatType || '채팅'} · ${c.id.slice(0,14)}`); }
  saveMessages(account,chatId,items) {
    const stmt = this.db.prepare(`INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(account,chat_id,id) DO UPDATE SET sender=excluded.sender,created=excluded.created,modified=excluded.modified,body=excluded.body,deleted=excluded.deleted,url=excluded.url`);
    this.transaction(() => { for (const m of items) {
      const row={account,chat_id:chatId,id:m.id,sender:m.sender||m.from?.user?.displayName||m.from?.application?.displayName||'시스템',created:m.createdDateTime||'',modified:m.lastModifiedDateTime||m.createdDateTime||'',body:m.deletedDateTime?'':stripHtml(typeof m.body==='string'?m.body:m.body?.content||''),deleted:m.deletedDateTime?1:0,url:m.webUrl||''};
      stmt.run(row.account,row.chat_id,row.id,row.sender,row.created,row.modified,row.body,row.deleted,row.url);
      trackMessage(this,row);
    } });
  }
  watermark(account,id,value) { this.db.prepare('UPDATE chats SET watermark=? WHERE account=? AND id=?').run(value,account,id); }
  search(account,q='',limit=100,chatId='') {
    return this.db.prepare(`SELECT m.*,c.title FROM messages m LEFT JOIN chats c ON m.account=c.account AND m.chat_id=c.id WHERE m.account=? AND m.deleted=0 AND (?='' OR m.chat_id=?) AND (m.body LIKE ? ESCAPE '!' OR c.title LIKE ? ESCAPE '!') ORDER BY m.created DESC LIMIT ?`).all(account,chatId,chatId,like(q),like(q),limit);
  }
  counts(account) { return { chats:this.db.prepare('SELECT COUNT(*) n FROM chats WHERE account=?').get(account).n, messages:this.db.prepare('SELECT COUNT(*) n FROM messages WHERE account=? AND deleted=0').get(account).n, emails:this.db.prepare('SELECT COUNT(*) n FROM emails WHERE account=?').get(account).n }; }
  saveEmails(account,items) {
    const stmt = this.db.prepare('INSERT INTO emails VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(account,id) DO UPDATE SET thread_id=excluded.thread_id,subject=excluded.subject,sender=excluded.sender,recipients=excluded.recipients,sent_at=excluded.sent_at,body=excluded.body');
    this.transaction(() => { for (const e of items) stmt.run(account,e.id,e.thread_id,e.subject,e.sender,e.recipients,e.sent_at,stripHtml(e.body)); });
  }
  emails(account) { return this.db.prepare('SELECT * FROM emails WHERE account=? ORDER BY sent_at DESC LIMIT 500').all(account); }
  close() { this.db.close(); }
}
function like(q) { return `%${q.replace(/[!%_]/g, '!$&')}%`; }
export function stripHtml(value) { return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<br\s*\/?\s*>|<\/p>|<\/div>/gi,'\n').replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').trim(); }

export function seedDemo(store) {
  if (store.counts('demo').chats) return;
  const now = Date.now();
  const groups = [
    ['vpc','VPC 가산 · 실무 협의',['방화벽 정책 확인이 완료되었습니다. 테스트 결과는 내일 공유하겠습니다.','LB 헬스체크 경로는 /health로 통일하기로 했습니다.','운영 전환 전 모니터링 알림 수신자를 확정해야 합니다.']],
    ['scrum','클라우드개발팀 · 데일리 스크럼',['오늘은 테넌트 쿼타 검증을 진행합니다. 변경된 flavor 목록을 확인해주세요.','배포 체크리스트 초안을 작성했습니다. 담당자 검토가 필요합니다.','이번 주 목표는 통합 테스트 완료입니다. 일정 변경 여부는 아직 미정입니다.']],
    ['security','보안솔루션 · 구축 지원',['보안 에이전트 설치 테스트가 완료됐습니다. 결과 문서를 공유합니다.','접속 계정 승인 요청에 대한 회신을 기다리고 있습니다.']]
  ];
  groups.forEach(([id,title,texts],i) => { store.upsertChat('demo',{id,title}); store.saveMessages('demo',id,texts.map((body,j)=>({id:`demo-${i}-${j}`,body,sender:['김민수','이서연','전승호'][j%3],createdDateTime:new Date(now-(i*3+j)*3600000).toISOString()}))); });
  store.saveEmails('demo',[
    {id:'mail-1',thread_id:'thread-1',subject:'[VPC] 운영 전환 체크리스트 검토 요청',sender:'colleague@example.test',recipients:'me@example.test',sent_at:new Date(now-86400000).toISOString(),body:'운영 전환 전에 모니터링 알림 수신자를 확정하고 LB 헬스체크 경로를 확인해주세요. 검토 완료 후 회신 부탁드립니다.'},
    {id:'mail-2',thread_id:'thread-2',subject:'[보안] 접속 계정 승인 확인',sender:'me@example.test',recipients:'security@example.test',sent_at:new Date(now-2*86400000).toISOString(),body:'보안 에이전트 설치 테스트를 완료했습니다. 운영 접속 계정 승인 상태를 확인 부탁드립니다.'}
  ]);
}

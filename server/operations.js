import { dayKey } from './store.js';
import { endpoint } from './ai.js';

export function initOperations(store) {
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS chat_preferences(account TEXT,chat_id TEXT,interested INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(account,chat_id));
    CREATE TABLE IF NOT EXISTS operations_settings(id INTEGER PRIMARY KEY CHECK(id=1),json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS connector_state(key TEXT PRIMARY KEY,status TEXT,last_success TEXT,error TEXT);
    CREATE TABLE IF NOT EXISTS jira_cache(scope TEXT,key TEXT,summary TEXT,assignee TEXT,status TEXT,due TEXT,updated TEXT,url TEXT,PRIMARY KEY(scope,key));
    CREATE TABLE IF NOT EXISTS jira_snapshots(scope TEXT PRIMARY KEY,date_field TEXT,jql TEXT);
    CREATE TABLE IF NOT EXISTS team_entries(id INTEGER PRIMARY KEY AUTOINCREMENT,day TEXT,person TEXT,product TEXT,work TEXT,status TEXT,due TEXT,source TEXT,created TEXT,mode TEXT);
    CREATE TABLE IF NOT EXISTS team_imports(result_id TEXT PRIMARY KEY,created TEXT);
    CREATE INDEX IF NOT EXISTS message_created ON messages(account,chat_id,created);
  `);
  store.db.prepare('INSERT OR IGNORE INTO operations_settings VALUES(1,?)').run(JSON.stringify({enabled:false,intervalMinutes:30,jql:'project in (HMGHCLOUD, HCLOUDSR) AND statusCategory != Done ORDER BY updated DESC',dateField:'duedate',dueDays:7}));
}
export const operationsSettings=s=>JSON.parse(s.db.prepare('SELECT json FROM operations_settings WHERE id=1').get().json);
export function interested(s,account,id) {return s.db.prepare('SELECT interested FROM chat_preferences WHERE account=? AND chat_id=?').get(account,id)?.interested===1;}
export function setInterest(s,account,id,value) {
  if(!s.chat(account,id))throw new Error('먼저 채팅방 목록을 갱신하세요.');
  s.db.prepare('INSERT INTO chat_preferences VALUES(?,?,?) ON CONFLICT(account,chat_id) DO UPDATE SET interested=excluded.interested').run(account,id,Number(value));
}
export function connectorState(s,key,status,error='') {
  s.db.prepare(`INSERT INTO connector_state VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET status=excluded.status,last_success=COALESCE(excluded.last_success,connector_state.last_success),error=excluded.error`).run(key,status,status==='success'?new Date().toISOString():null,error);
}
export async function syncJira(s,token,{fetcher=fetch}={}) {
  const {jira}=s.settings(),o=operationsSettings(s),scope=jira.baseUrl;
  if(!scope||!token)throw new Error('JIRA URL과 PAT를 설정하세요.');
  if(jira.apiVersion!=='2')throw new Error('일정 수집은 사내 Jira Server/DC REST v2용입니다. Cloud 검색 어댑터는 TODO를 참고하세요.');
  const key=`jira:${scope}`;connectorState(s,key,'running');
  try {
    const all=[],seen=new Set();let startAt=0;
    for(;;) {
      const url=new URL(endpoint(scope,'rest/api/2/search'));
      url.search=new URLSearchParams({jql:o.jql,startAt:String(startAt),maxResults:'100',fields:`summary,assignee,status,updated,${o.dateField}`});
      const res=await fetcher(url,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});
      if(!res.ok)throw new Error(`JIRA 조회 HTTP ${res.status}`);
      const page=await res.json();
      if(!Array.isArray(page.issues)||!Number.isFinite(page.total))throw new Error('JIRA 검색 응답 형식 오류');
      if(page.issues.length===0&&startAt<page.total)throw new Error('JIRA 페이지가 중간에 비었습니다. 기존 캐시를 유지합니다.');
      for(const issue of page.issues){if(!issue.key||seen.has(issue.key))throw new Error('JIRA 검색 페이지가 반복/변경되었습니다. 다시 수집하세요.');seen.add(issue.key);all.push(issue);}
      startAt+=page.issues.length;if(startAt>=page.total)break;
      if(startAt>=10000)throw new Error('JIRA 10,000건 한도. JQL 범위를 줄이세요.');
    }
    s.transaction(()=>{
      s.db.prepare('DELETE FROM jira_cache WHERE scope=?').run(scope);
      const insert=s.db.prepare('INSERT INTO jira_cache VALUES(?,?,?,?,?,?,?,?)');
      for(const i of all){const f=i.fields||{};if(f.status?.statusCategory?.key==='done')continue;insert.run(scope,i.key,f.summary||'',f.assignee?.displayName||'미지정',f.status?.name||'',String(f[o.dateField]||'').slice(0,10),f.updated||'',endpoint(scope,`browse/${encodeURIComponent(i.key)}`));}
      s.db.prepare('INSERT INTO jira_snapshots VALUES(?,?,?) ON CONFLICT(scope) DO UPDATE SET date_field=excluded.date_field,jql=excluded.jql').run(scope,o.dateField,o.jql);
      connectorState(s,key,'success');
    });
    return {count:all.length};
  }catch(e){connectorState(s,key,'error',e.message);throw e;}
}
export function dueIssues(s) {
  const settings=s.settings(),o=operationsSettings(s),today=dayKey(settings.timezone);
  const through=new Date(Date.parse(today+'T00:00:00Z')+o.dueDays*86400000).toISOString().slice(0,10);
  if(settings.mode==='demo')return [{key:'DEMO-101',summary:'운영 전환 체크리스트 검토 (샘플)',assignee:'김민수',status:'진행 중',due:today,url:'',days:0}];
  const snapshot=s.db.prepare('SELECT * FROM jira_snapshots WHERE scope=?').get(settings.jira.baseUrl);
  if(!snapshot||snapshot.date_field!==o.dateField||snapshot.jql!==o.jql)return [];
  return s.db.prepare("SELECT * FROM jira_cache WHERE scope=? AND due!='' AND due<=? ORDER BY due,key").all(settings.jira.baseUrl,through).map(i=>({...i,days:Math.round((Date.parse(i.due)-Date.parse(today))/86400000)}));
}
export function dailyRoom(s,account,chatId,day) {
  const base=Date.parse(day+'T00:00:00Z'),from=new Date(base-86400000).toISOString(),to=new Date(base+2*86400000).toISOString();
  const items=s.db.prepare('SELECT * FROM messages WHERE account=? AND chat_id=? AND deleted=0 AND created>=? AND created<? ORDER BY created,id').all(account,chatId,from,to).filter(m=>dayKey(s.settings().timezone,new Date(m.created))===day);
  const input=items.map(m=>`[${m.id}] ${m.created} ${m.sender}\n${m.body}`).join('\n\n');
  if(input.length>95000)throw new Error('하루 원문이 95,000자를 넘습니다. 기간 분할 기능을 먼저 확장해야 합니다. 자동으로 잘라 요약하지 않습니다.');
  return {count:items.length,input};
}
export function teamEntries(s,from,to) {return s.db.prepare('SELECT * FROM team_entries WHERE day>=? AND day<=? AND mode=? ORDER BY day,person,id').all(from,to,s.settings().mode);}
export function weeklyInput(s,from,to) {
  const entries=teamEntries(s,from,to);
  return {count:entries.length,input:entries.map(e=>`[업무기록 ${e.id}] ${e.day} / ${e.person} / ${e.product}\n${e.work}\n상태:${e.status} 기한:${e.due||'미정'} 출처:${e.source||'직접 입력'}`).join('\n\n')};
}

// Local runtime timer: no LLM calls, no external writes; host must remain awake.
export function startScheduler({settings,canRun,run,now=Date.now,intervalMs=30000}) {
  let next=0,running=false;let lastEnabled=false;
  const tick=async()=>{
    const config=settings();
    if(!config.enabled){lastEnabled=false;next=0;return;}
    if(!lastEnabled){next=0;lastEnabled=true;}
    if(running||now()<next||!canRun())return;
    running=true;next=now()+config.intervalMinutes*60000;
    try{await run();}finally{running=false;}
  };
  const timer=setInterval(()=>tick().catch(()=>{}),intervalMs);timer.unref?.();
  return {tick,stop:()=>clearInterval(timer),status:()=>({running,nextAt:next?new Date(next).toISOString():null})};
}

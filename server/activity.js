import { randomUUID } from 'node:crypto';
import { workflows } from '../shared/workflows.js';

export function initActivity(s){
  s.db.exec(`CREATE TABLE IF NOT EXISTS action_events(id TEXT PRIMARY KEY,mode TEXT,action TEXT,status TEXT,started TEXT,finished TEXT,detail TEXT);
    CREATE TABLE IF NOT EXISTS activity_tags(mode TEXT,kind TEXT,ref TEXT,tag TEXT,PRIMARY KEY(mode,kind,ref,tag));
    CREATE INDEX IF NOT EXISTS activity_tag_lookup ON activity_tags(mode,tag);
    CREATE INDEX IF NOT EXISTS action_event_date ON action_events(mode,started);`);
  s.db.prepare("UPDATE action_events SET status='interrupted',finished=?,detail='서버 재시작. 실제 적용 여부를 확인하세요.' WHERE status='running'").run(new Date().toISOString());
}

// Never persist request bodies, credentials, response bodies or raw errors in audit events.
export function auditActions(s){return (req,res,next)=>{
  if(!['POST','PUT','DELETE'].includes(req.method)||!req.path.startsWith('/api/')||req.path.endsWith('/estimate'))return next();
  const action=req.path.replace(/\/api\//,'').replace(/(cards|briefing|pipelines|activity)\/[^/]+/,'$1/:id');
  const id=randomUUID();
  s.db.prepare('INSERT INTO action_events VALUES(?,?,?,?,?,?,?)').run(id,s.settings().mode,`${req.method} ${action}`,'running',new Date().toISOString(),null,'처리 중');
  let done=false;
  const finish=(status,detail)=>{if(done)return;done=true;s.db.prepare('UPDATE action_events SET status=?,finished=?,detail=? WHERE id=?').run(status,new Date().toISOString(),detail,id);};
  res.once('finish',()=>finish(res.statusCode>=400?'error':'success',`HTTP ${res.statusCode} · ${res.statusCode>=400?'요청 실패':'요청 처리 완료'}`));
  res.once('close',()=>{if(!res.writableFinished)finish('interrupted','연결 종료. 실제 실행 상태를 확인하세요.');});
  next();
};}

const union=`SELECT 'ai' kind,id ref,mode,workflow title,status,created,started,finished,input_tokens,output_tokens,cost,group_id,model_name,cached,usage_estimated FROM results
  UNION ALL SELECT 'code',id,mode,workflow,status,started,started,finished,0,0,0,NULL,NULL,0,0 FROM runs
  UNION ALL SELECT 'action',id,mode,action,status,started,started,finished,0,0,0,NULL,NULL,0,0 FROM action_events`;
export function activityItem(s,kind,ref){
  const row=s.db.prepare(`SELECT * FROM (${union}) WHERE kind=? AND ref=? AND mode=?`).get(kind,ref,s.settings().mode);
  if(!row)throw new Error('현재 모드의 활동을 찾을 수 없습니다.');
  return row;
}
export function listActivity(s,{tag='',q='',kind='',page=0}={}){
  const mode=s.settings().mode,pattern=`%${q.replace(/[!%_]/g,'!$&')}%`;
  const where=`a.mode=? AND (?='' OR a.kind=?) AND (a.title LIKE ? ESCAPE '!' OR a.model_name LIKE ? ESCAPE '!') AND (?='' OR EXISTS(SELECT 1 FROM activity_tags t WHERE t.mode=a.mode AND t.kind=a.kind AND t.ref=a.ref AND t.tag=?))`;
  const args=[mode,kind,kind,pattern,pattern,tag,tag];
  const items=s.db.prepare(`SELECT a.* FROM (${union}) a WHERE ${where} ORDER BY a.created DESC,a.ref DESC LIMIT 50 OFFSET ?`).all(...args,page*50);
  for(const item of items){item.label=workflows.find(w=>w.id===item.title)?.title||item.title;item.tags=s.db.prepare('SELECT tag FROM activity_tags WHERE mode=? AND kind=? AND ref=? ORDER BY tag').all(mode,item.kind,item.ref).map(r=>r.tag);}
  return {items,total:s.db.prepare(`SELECT COUNT(*) n FROM (${union}) a WHERE ${where}`).get(...args).n,tags:s.db.prepare('SELECT tag,COUNT(*) count FROM activity_tags WHERE mode=? GROUP BY tag ORDER BY tag').all(mode)};
}
export function tagActivity(s,kind,ref,tags){
  activityItem(s,kind,ref);
  const clean=[...new Set(tags.map(t=>t.trim().normalize('NFKC')).filter(Boolean))];
  if(clean.length>12||clean.some(t=>t.length>40))throw new Error('태그는 최대 12개, 각 40자입니다.');
  s.transaction(()=>{s.db.prepare('DELETE FROM activity_tags WHERE mode=? AND kind=? AND ref=?').run(s.settings().mode,kind,ref);for(const tag of clean)s.db.prepare('INSERT INTO activity_tags VALUES(?,?,?,?)').run(s.settings().mode,kind,ref,tag);});
  return {tags:clean};
}
export function activityDetail(s,kind,ref){
  const item=activityItem(s,kind,ref);
  if(kind==='ai'){
    const result=s.db.prepare('SELECT * FROM results WHERE id=?').get(ref),input=s.db.prepare('SELECT * FROM analysis_inputs WHERE group_id=?').get(item.group_id);
    const context=s.db.prepare('SELECT * FROM request_context WHERE group_id=?').get(item.group_id),guide=s.db.prepare('SELECT version FROM execution_guides WHERE group_id=?').get(item.group_id);
    return {item,input:input?.input||'',output:result.content||result.error,repeat:input?{type:'ai',request:{workflow:result.workflow,input:input.input,instruction:input.instruction,modelIds:[result.model_id],effort:result.effort,guideVersion:guide?.version,contextMode:context?.mode||'fresh',cardIds:JSON.parse(context?.card_ids||'[]'),parentId:context?.parent_id||null,briefingIds:JSON.parse(context?.briefing_ids||'[]'),fresh:false}}:null};
  }
  const detail=s.db.prepare(`SELECT detail FROM ${kind==='code'?'runs':'action_events'} WHERE id=?`).get(ref).detail;
  let route={'teams-cache':'teams','teams-discover':'rooms','outlook-import':'cache','jira-sync':'operations','jira-create':'history'}[item.title];
  if(kind==='action'){
    const action=item.title.split(' ')[1]||'';
    route=action.startsWith('graph/')||action.startsWith('teams/')?'teams':action.startsWith('rooms/')?'rooms':action.startsWith('cards/')||action.startsWith('decks')?'cards':action.startsWith('team')?'team':action.startsWith('briefing')?'briefing':action.startsWith('jira/')||action==='operations'?'operations':action.startsWith('outlook/')?'cache':action.startsWith('guides/')?'workflows':action.startsWith('pipelines')?'pipelines':action.startsWith('activity/')?'activity':action.startsWith('ai/')||action==='preferences'?'compare':'settings';
  }
  return {item,output:detail,repeat:route?{type:'navigate',route}:null};
}

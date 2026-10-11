import { endpoint } from './ai.js';
export async function createJira(store,{resultId,summary,description,project,issueType},token,{fetcher=fetch}={}) {
  const settings=store.settings();
  if (settings.mode!=='live') throw new Error('데모에서는 JIRA에 등록하지 않습니다.');
  const result=store.db.prepare("SELECT * FROM results WHERE id=? AND workflow='email-jira' AND status='success' AND mode='live'").get(resultId);
  if (!result) throw new Error('실제 모드에서 생성한 이메일 이슈 초안이 필요합니다.');
  const existing=store.db.prepare('SELECT * FROM jira_links WHERE result_id=?').get(resultId);
  if (existing?.issue_key==='__pending__') throw new Error('이전 등록의 성공 여부가 불확실합니다. JIRA에서 확인한 뒤 로컬 연결을 복구하세요. 중복 등록을 막기 위해 재전송하지 않았습니다.');
  if (existing) return existing;
  const context=store.db.prepare('SELECT briefing_ids FROM request_context WHERE group_id=?').get(result.group_id);
  const sourceIds=JSON.parse(context?.briefing_ids||'[]');
  for(const id of sourceIds) {
    const linked=store.db.prepare('SELECT j.issue_key FROM brief_jira b JOIN jira_links j ON j.result_id=b.result_id WHERE b.source_id=?').get(id);
    if(linked)throw new Error(`이 업무 후보는 이미 ${linked.issue_key==='__pending__'?'등록 확인 중':linked.issue_key+'에 연결됨'} 상태입니다. 중복 등록하지 않았습니다.`);
  }
  if (!settings.jira.baseUrl || !token) throw new Error('설정에서 JIRA URL과 PAT를 입력하세요.');
  const url=endpoint(settings.jira.baseUrl,`rest/api/${settings.jira.apiVersion}/issue`);
  const text=`${description}\n\nmytools source: ${resultId}`;
  const desc=settings.jira.apiVersion==='3'?{type:'doc',version:1,content:text.split('\n').map(t=>({type:'paragraph',content:t?[{type:'text',text:t}]:[]}))}:text;
  store.transaction(()=>{
    store.db.prepare('INSERT INTO jira_links VALUES(?,?,?,?)').run(resultId,'__pending__','',new Date().toISOString());
    for(const id of sourceIds)store.db.prepare('INSERT INTO brief_jira VALUES(?,?)').run(id,resultId);
  });
  const res=await fetcher(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({fields:{project:{key:project},issuetype:{name:issueType},summary,description:desc,labels:['ai-powered-po']}}),signal:AbortSignal.timeout(30000),redirect:'error'});
  if (!res.ok) {
    if (res.status<500)store.transaction(()=>{store.db.prepare('DELETE FROM brief_jira WHERE result_id=?').run(resultId);store.db.prepare('DELETE FROM jira_links WHERE result_id=?').run(resultId);});
    throw new Error(`JIRA 등록 실패 (HTTP ${res.status}). ${res.status>=500?'등록 여부를 JIRA에서 확인하세요.':'프로젝트·이슈 유형·PAT 권한을 확인하세요.'}`);
  }
  const issue=await res.json();
  if (!issue.key) throw new Error('JIRA 응답에 이슈 키가 없습니다. 등록 여부를 직접 확인하세요.');
  const issueUrl=endpoint(settings.jira.baseUrl,`browse/${encodeURIComponent(issue.key)}`);
  store.db.prepare('UPDATE jira_links SET issue_key=?,url=? WHERE result_id=?').run(issue.key,issueUrl,resultId);
  for(const id of sourceIds)store.db.prepare("UPDATE brief_items SET status='jira' WHERE id=?").run(id);
  return {issue_key:issue.key,url:issueUrl};
}

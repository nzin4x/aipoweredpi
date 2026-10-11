import { randomUUID } from 'node:crypto';
import { prepareComparison, persistComparison, executeEntry } from './ai.js';

// One active batch, bounded model-request workers. No automatic retries or external writes.
export function pipelineRunner(store,options={}) {
  let active=null, completion=Promise.resolve();
  function submit({title,tasks,concurrency=3},key) {
    if(active) throw new Error('진행 중인 배치가 끝난 후 새 배치를 시작하세요.');
    if(store.db.prepare("SELECT 1 FROM results WHERE status='pending'").get()) throw new Error('기존 AI 실행이 끝난 뒤 배치를 시작하세요.');
    const prepared=tasks.map(task=>({task,entries:prepareComparison(store,task.request)}));
    const entries=prepared.flatMap(p=>p.entries);
    const id=randomUUID(),now=new Date().toISOString(),mode=store.settings().mode;
    store.reserve(entries,()=>{
      store.db.prepare('INSERT INTO pipelines VALUES(?,?,?,?,?,?,?,?)').run(id,title,mode,'queued',now,null,null,concurrency);
      let position=0;
      for(const {task,entries:group} of prepared) {
        persistComparison(store,task.request,group);
        for(const e of group) store.db.prepare('INSERT INTO pipeline_jobs VALUES(?,?,?,?)').run(e.id,id,task.title,position++);
      }
    });
    active=id;
    // Schedule after the accepted response. Credentials stay only in this closure.
    completion=new Promise(resolve=>setImmediate(resolve)).then(async()=>{
      store.db.prepare("UPDATE pipelines SET status='running',started=? WHERE id=?").run(new Date().toISOString(),id);
      let cursor=0;
      async function worker(){
        while(cursor<entries.length){
          const entry=entries[cursor++];
          if(store.db.prepare('SELECT status FROM results WHERE id=?').get(entry.id).status!=='pending') continue;
          try {await executeEntry(store,entry,key,options);}
          catch {store.finishResult(entry.id,{status:'uncertain',error:'실행 처리 오류. 사용량 확인 후 수동 재실행하세요.'});}
        }
      }
      await Promise.all(Array.from({length:Math.min(concurrency,entries.length)},worker));
      const statuses=store.db.prepare('SELECT r.status FROM results r JOIN pipeline_jobs j ON r.id=j.id WHERE j.pipeline_id=?').all(id).map(r=>r.status);
      const status=statuses.every(s=>s==='success')?'success':statuses.every(s=>s==='cancelled')?'cancelled':'partial';
      store.db.prepare('UPDATE pipelines SET status=?,finished=? WHERE id=?').run(status,new Date().toISOString(),id);
    }).finally(()=>{active=null;});
    return {id};
  }
  function cancel(id){
    const p=store.db.prepare('SELECT * FROM pipelines WHERE id=? AND mode=?').get(id,store.settings().mode);
    if(!p) throw new Error('배치를 찾을 수 없습니다.');
    const out=store.db.prepare("UPDATE results SET status='cancelled',finished=?,error='사용자가 대기 작업 취소' WHERE status='pending' AND started IS NULL AND id IN (SELECT id FROM pipeline_jobs WHERE pipeline_id=?)").run(new Date().toISOString(),id);
    return {cancelled:Number(out.changes)};
  }
  return {submit,cancel,get active(){return active;},get completion(){return completion;}};
}

export function executionBoard(store){
  const mode=store.settings().mode;
  const pipelines=store.db.prepare('SELECT * FROM pipelines WHERE mode=? ORDER BY created DESC LIMIT 30').all(mode);
  const fields='r.id,r.group_id,r.workflow,r.model_name,r.effort,r.status,r.started,r.finished,r.created,r.input_tokens,r.output_tokens,r.reasoning_tokens,r.usage_estimated,r.cost,r.reserved,r.cached,r.error';
  for(const p of pipelines) p.jobs=store.db.prepare(`SELECT ${fields},j.title FROM pipeline_jobs j JOIN results r ON r.id=j.id WHERE j.pipeline_id=? ORDER BY j.position`).all(p.id);
  const singles=store.db.prepare(`SELECT ${fields} FROM results r WHERE r.mode=? AND NOT EXISTS(SELECT 1 FROM pipeline_jobs j WHERE j.id=r.id) ORDER BY r.created DESC LIMIT 100`).all(mode);
  const code=store.db.prepare('SELECT * FROM runs WHERE mode=? ORDER BY started DESC LIMIT 50').all(mode);
  return {pipelines,singles,code};
}

import { DatabaseSync } from 'node:sqlite';
import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
const emailSchema=z.object({id:z.coerce.string().min(1),thread_id:z.coerce.string().min(1),subject:z.string(),sender:z.string(),recipients:z.string(),sent_at:z.string().refine(x=>Number.isFinite(Date.parse(x)),'sent_at은 ISO 날짜로 매핑하세요.'),body:z.string().max(200000)});
export function readOutlook({path,query}) {
  if (!isAbsolute(path)) throw new Error('Outlook SQLite 파일의 절대 경로를 입력하세요.');
  if (!/^\s*(SELECT|WITH)\b/i.test(query)) throw new Error('SELECT 또는 WITH 읽기 쿼리만 허용합니다.');
  const db=new DatabaseSync(resolve(path),{readOnly:true,allowExtension:false});
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;');
    const rows=db.prepare(`SELECT * FROM (${query.trim().replace(/;\s*$/,'')}) LIMIT 501`).all();
    if (rows.length>500) throw new Error('한 번에 500건까지 가져올 수 있습니다. 날짜·ID 조건으로 범위를 좁히세요.');
    return rows.map(row=>emailSchema.parse(row));
  } finally { db.close(); }
}
export function threadCandidates(emails,myEmail) {
  const latest=new Map();
  for (const e of emails) if (!latest.has(e.thread_id)||Date.parse(e.sent_at)>Date.parse(latest.get(e.thread_id).sent_at)) latest.set(e.thread_id,e);
  return [...latest.values()].map(e=>{const addresses=e.sender.toLowerCase().match(/[^\s<>(),;"']+@[^\s<>(),;"']+/g)||[e.sender.toLowerCase().trim()];return {...e,direction:addresses.includes(myEmail.toLowerCase().trim())?'waiting':'to-reply',days:Math.max(0,Math.floor((Date.now()-Date.parse(e.sent_at))/86400000))};});
}

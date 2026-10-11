import { workflows,prompts } from '../shared/workflows.js';
export function initGuides(s) {
  s.db.exec(`CREATE TABLE IF NOT EXISTS guide_versions(workflow TEXT,version INTEGER,content TEXT,note TEXT,created TEXT,PRIMARY KEY(workflow,version));
    CREATE TABLE IF NOT EXISTS execution_guides(group_id TEXT PRIMARY KEY,workflow TEXT,version INTEGER,content TEXT);`);
  for(const w of workflows)s.db.prepare('INSERT OR IGNORE INTO guide_versions VALUES(?,?,?,?,?)').run(w.id,1,`# ${w.title}\n\n## 입력\n${w.description}\n\n## 처리 / 출력 기준\n${prompts[w.id]||'Graph 조회 → 관심 채팅만 증분 캐싱. AI 호출 없음. 체크박스와 주기는 코드 설정으로 관리합니다.'}`, '기본 가이드',new Date().toISOString());
}
export function guides(s,w){return s.db.prepare('SELECT * FROM guide_versions WHERE workflow=? ORDER BY version DESC').all(w);}
export function getGuide(s,w,version){const g=version?s.db.prepare('SELECT * FROM guide_versions WHERE workflow=? AND version=?').get(w,version):guides(s,w)[0];if(!g)throw new Error('업무 가이드를 찾을 수 없습니다.');return g;}
export function saveGuide(s,w,{baseVersion,content,note}){
  return s.transaction(()=>{const old=getGuide(s,w);if(old.version!==baseVersion)throw new Error('다른 창에서 새 버전이 저장되었습니다. 새로고침 후 비교하세요.');
    const version=old.version+1;s.db.prepare('INSERT INTO guide_versions VALUES(?,?,?,?,?)').run(w,version,content,note,new Date().toISOString());return getGuide(s,w,version);});
}

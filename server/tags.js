import { dailyRoom } from './operations.js';

export function roomTags(store,account){
  const out=new Map();
  for(const row of store.db.prepare('SELECT chat_id,tag FROM chat_tags WHERE account=? ORDER BY tag').all(account)){
    if(!out.has(row.chat_id))out.set(row.chat_id,[]);
    out.get(row.chat_id).push(row.tag);
  }
  return out;
}
export function saveRoomTags(store,account,chatId,tags){
  if(!store.chat(account,chatId))throw new Error('현재 계정의 채팅방을 찾을 수 없습니다.');
  const clean=[...new Set(tags.map(t=>t.trim().normalize('NFKC')).filter(Boolean))];
  if(clean.length>12||clean.some(t=>t.length>40))throw new Error('태그는 40자 이하, 방마다 최대 12개입니다.');
  store.transaction(()=>{
    store.db.prepare('DELETE FROM chat_tags WHERE account=? AND chat_id=?').run(account,chatId);
    for(const tag of clean)store.db.prepare('INSERT INTO chat_tags VALUES(?,?,?)').run(account,chatId,tag);
  });
  return clean;
}
export function tagCollection(store,account,tag,day){
  const rooms=store.db.prepare('SELECT c.id,c.title FROM chats c JOIN chat_tags t ON c.account=t.account AND c.id=t.chat_id WHERE t.account=? AND t.tag=? ORDER BY c.title').all(account,tag);
  if(rooms.length>100)throw new Error('태그별 모아보기는 최대 100개 방입니다. 태그를 나누세요.');
  const items=rooms.map(r=>({...r,...dailyRoom(store,account,r.id,day)}));
  if(items.reduce((n,r)=>n+r.input.length,0)>500000)throw new Error('모아보기 원문 500,000자 한도입니다. 태그를 나누세요.');
  return {tag,day,rooms:items};
}

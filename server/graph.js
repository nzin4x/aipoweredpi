import { syncState } from './knowledge.js';
import { interested } from './operations.js';
export async function discoverChats(store,session,options={}) {
  let count=0;
  for await(const list of graphPages('me/chats?$top=50',session.token,options))for(const chat of list){store.upsertChat(session.account,chat);count++;}
  return {count};
}
export class GraphError extends Error { constructor(status,message) { super(message); this.status=status; } }
export function graphUrl(value) {
  const url = new URL(value,'https://graph.microsoft.com/v1.0/');
  if (url.origin !== 'https://graph.microsoft.com' || !url.pathname.startsWith('/v1.0/') || url.username || url.password) throw new GraphError(400,'잘못된 Graph 페이지 주소입니다.');
  return url.href;
}
export async function graphGet(path,token,{fetcher=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  const url=graphUrl(path);
  for (let attempt=0;attempt<5;attempt++) {
    const res=await fetcher(url,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});
    if ([429,502,503,504].includes(res.status) && attempt<4) {
      const retry=res.headers.get('retry-after');
      const seconds = retry ? (Number.isFinite(Number(retry)) ? Number(retry) : Math.max(0,(Date.parse(retry)-Date.now())/1000)) : 2**attempt;
      if (seconds>60) throw new GraphError(res.status,`Graph가 ${Math.ceil(seconds)}초 대기를 요청했습니다. 잠시 후 다시 실행하세요.`);
      await sleep(Math.min(60,Number.isFinite(seconds)?seconds:2**attempt)*1000); continue;
    }
    if (!res.ok) throw new GraphError(res.status,res.status===401?'Graph 토큰이 만료되었거나 유효하지 않습니다. 새 토큰을 입력하세요.':res.status===403?'Graph 권한이 부족합니다. Graph Explorer의 User.Read, Chat.Read 권한을 확인하세요.':`Graph 요청 실패 (HTTP ${res.status})`);
    return res.json();
  }
}
export async function* graphPages(path,token,options) {
  let next=path; const seen=new Set();
  while(next) {
    const url=graphUrl(next); if (seen.has(url)) throw new Error('Graph 페이지가 반복되었습니다.'); seen.add(url);
    const page=await graphGet(url,token,options);
    if (!Array.isArray(page.value)) throw new Error('Graph 목록 응답 형식이 올바르지 않습니다.');
    yield page.value;
    next=page['@odata.nextLink'];
  }
}
export async function syncTeams(store,session,onProgress=()=>{},options={}) {
  const {token,account}=session; let chats=0, messages=0; const errors=[];
  for await (const list of graphPages('me/chats?$top=50',token,options)) {
    for (const chat of list) {
      const old=store.chat(account,chat.id); store.upsertChat(account,chat);
      if(!interested(store,account,chat.id))continue;
      const started=new Date().toISOString();
      syncState(store,account,chat.id,'running');
      const params=new URLSearchParams({'$top':'50','$orderby':'lastModifiedDateTime desc'});
      if (old?.watermark) params.set('$filter',`lastModifiedDateTime gt ${new Date(Date.parse(old.watermark)-5*60000).toISOString()}`);
      onProgress(`${chats}개 채팅 완료 · ${messages}건 처리 · ${chat.topic || '채팅'} 수집 중`);
      try {
        for await (const page of graphPages(`chats/${encodeURIComponent(chat.id)}/messages?${params}`,token,options)) {
          store.saveMessages(account,chat.id,page); messages+=page.length;
          onProgress(`${chats}개 채팅 완료 · ${messages}건 처리 중`);
        }
        store.watermark(account,chat.id,started); syncState(store,account,chat.id,'success'); chats++;
      } catch(e) { syncState(store,account,chat.id,'error',e.message); if (e.status===401) throw e; errors.push({chatId:chat.id,error:e.message}); }
    }
  }
  return {chats,messages,errors};
}

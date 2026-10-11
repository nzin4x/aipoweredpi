import React,{useEffect,useState} from 'react';

export function RoomTagsPanel({api,state,notify,onQueue}){
  const [rooms,setRooms]=useState([]),[roomId,setRoomId]=useState(''),[draft,setDraft]=useState(''),[tag,setTag]=useState(''),[day,setDay]=useState(state.today),[collection,setCollection]=useState(null),[busy,setBusy]=useState(false);
  async function load(){const rows=await api('/rooms');setRooms(rows);return rows;}
  useEffect(()=>{setCollection(null);setTag('');setRoomId('');setDraft('');load().catch(e=>notify(e.message));},[state.account,state.settings.mode,state.counts.chats,state.syncing]);
  const tags=[...new Set(rooms.flatMap(r=>r.tags))].sort();
  const filtered=rooms.filter(r=>!tag||r.tags.includes(tag));
  async function view(){setBusy(true);setCollection(null);try{setCollection(await api(`/rooms/collection?${new URLSearchParams({tag,day})}`));}catch(e){notify(e.message);}finally{setBusy(false);}}
  function queue(){
    const available=collection.rooms.filter(r=>r.count);
    if(available.length>12){notify('한 배치는 최대 12개 업무입니다. 태그를 나눠주세요.');return;}
    const pref=state.settings.preferences['chat-daily'];
    const ids=(pref?.modelIds||[]).filter(id=>state.settings.models.some(m=>m.id===id));
    onQueue(available.map(r=>({title:r.title,request:{workflow:'chat-daily',input:`채팅방: ${r.title}\n날짜: ${collection.day}\n${r.input}`,modelIds:ids.length?ids:[state.settings.models[0].id],effort:pref?.effort||'low'}})));
  }
  return <section className="panel tag-workspace"><div className="section-heading"><div><div className="eyebrow">LOCAL ROOM TAGS</div><h2>태그별 모아보기</h2><p>태그는 내 PC에만 저장됩니다. 관심 ON/OFF와 무관하게 이미 캐싱한 원문을 모아봅니다.</p></div><button className="button small" onClick={()=>load().catch(e=>notify(e.message))}>태그 목록 새로고침</button></div>
    <form className="tag-editor" onSubmit={async e=>{e.preventDefault();setBusy(true);try{await api('/rooms/tags',{chatId:roomId,tags:draft.split(',').map(t=>t.trim()).filter(Boolean)},'PUT');await load();setCollection(null);notify('채팅방 태그를 저장했습니다.');}catch(err){notify(err.message);}finally{setBusy(false);}}}>
      <label>태그를 편집할 채팅방<select value={roomId} onChange={e=>{setRoomId(e.target.value);setDraft(rooms.find(r=>r.id===e.target.value)?.tags.join(', ')||'');}}><option value="">채팅방 선택</option>{rooms.map(r=><option key={r.id} value={r.id}>{r.title}</option>)}</select></label>
      <label>채팅방 태그 · 쉼표로 구분<input value={draft} onChange={e=>setDraft(e.target.value)} placeholder="VPC, 운영전환, 보안" disabled={!roomId}/></label><button className="button" disabled={!roomId||busy}>태그 저장</button>
    </form>
    <div className="tag-filters"><button className={`button small ${!tag?'primary':''}`} onClick={()=>{setTag('');setCollection(null);}}>전체 {rooms.length}</button>{tags.map(t=><button className={`button small ${tag===t?'primary':''}`} key={t} onClick={()=>{setTag(t);setCollection(null);}}>#{t} · {rooms.filter(r=>r.tags.includes(t)).length}</button>)}</div>
    <div className="tag-room-list">{filtered.map(r=><div key={r.id}><b>{r.title}</b><span>{r.tags.map(t=><span className="tag" key={t}>#{t}</span>)}{!r.tags.length&&<small>태그 없음</small>}</span><small>{r.interested?'관심 ON':'관심 OFF'} · 저장 {r.message_count}건</small></div>)}</div>
    <div className="room-daily"><label>모아볼 날짜<input type="date" value={day} onChange={e=>{setDay(e.target.value);setCollection(null);}}/></label><button className="button" disabled={!tag||!day||busy} onClick={view}>태그 원문 모아보기</button><small>태그 선택 → 날짜별 원문 확인 → 방별 요약 배치 준비</small></div>
    {collection&&<div className="tag-collection"><div className="section-heading"><h3>#{collection.tag} · {collection.day} · {collection.rooms.reduce((n,r)=>n+r.count,0)}건</h3><button className="button primary" disabled={!collection.rooms.some(r=>r.count)} onClick={queue}>방별 요약 배치에 담기</button></div>{collection.rooms.map(r=><details key={r.id}><summary>{r.title} · {r.count}건</summary><pre>{r.input||'이 날짜의 캐시가 없습니다. 관심 설정과 마지막 동기화를 확인하세요.'}</pre></details>)}</div>}
  </section>;
}

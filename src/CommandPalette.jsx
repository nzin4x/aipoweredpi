import React,{useEffect,useRef,useState} from 'react';

export function CommandPalette({commands,onClose}){
  const ref=useRef(),inputRef=useRef();
  const [query,setQuery]=useState(''),[index,setIndex]=useState(0);
  const matches=commands.filter(c=>`${c.label} ${c.keywords||''}`.toLowerCase().includes(query.toLowerCase()));
  useEffect(()=>{const previous=document.activeElement;ref.current.showModal();inputRef.current.focus();return()=>previous?.focus();},[]);
  useEffect(()=>{document.getElementById(`command-${index}`)?.scrollIntoView({block:'nearest'});},[index]);
  function run(c){if(c){onClose();c.run();}}
  return <dialog ref={ref} className="command-palette" aria-label="업무 명령 팔레트" onCancel={e=>{e.preventDefault();onClose();}} onKeyDown={e=>{
    if(e.key==='ArrowDown'){e.preventDefault();setIndex(i=>Math.min(i+1,matches.length-1));}
    if(e.key==='ArrowUp'){e.preventDefault();setIndex(i=>Math.max(i-1,0));}
    if(e.key==='Enter'){e.preventDefault();run(matches[index]);}
  }}>
    <div className="row"><h2>어떤 업무를 할까요?</h2><button className="button small" onClick={onClose}>닫기 · Esc</button></div>
    <input ref={inputRef} role="combobox" aria-label="명령 검색" aria-controls="command-list" aria-expanded="true" aria-activedescendant={matches[index]?`command-${index}`:undefined} value={query} onChange={e=>{setQuery(e.target.value);setIndex(0);}} placeholder="업무 또는 화면 검색…"/>
    <div role="listbox" id="command-list" className="command-list">{matches.map((c,i)=><div role="option" id={`command-${i}`} aria-selected={i===index} key={c.id} className={i===index?'active':''} onMouseMove={()=>setIndex(i)} onClick={()=>run(c)}><span>{c.label}</span><small>{c.hint||'실행 준비 화면'}</small></div>)}{!matches.length&&<p>일치하는 명령이 없습니다.</p>}</div>
    <small>↑↓ 이동 · Enter 선택 · Ctrl+P / ⌘P · 유료 AI와 외부 등록은 실행 화면에서 확인</small>
  </dialog>;
}

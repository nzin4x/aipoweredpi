import { createHash,randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

// The manifest and ALL token fragments live only in the OS credential store.
// Small ASCII fragments avoid Windows Credential Manager's per-entry blob limit.
export function createGraphVault(scope,{entryFactory,platform=process.platform}={}){
  const service=`mytools.graph.${createHash('sha256').update(resolve(scope)).digest('hex').slice(0,24)}`;
  let factory=entryFactory,tail=Promise.resolve();
  const state={available:['win32','darwin'].includes(platform),saved:false,error:'',loading:false};
  async function entry(name){
    if(!state.available)throw new Error('macOS Keychain 또는 Windows 자격 증명 관리자가 필요합니다.');
    if(!factory){const {AsyncEntry}=await import('@napi-rs/keyring');factory=(s,n)=>new AsyncEntry(s,n);}
    return factory(service,name);
  }
  async function manifest(){
    const raw=await (await entry('manifest')).getPassword();if(!raw)return null;
    const m=JSON.parse(raw);
    if(!/^[a-f0-9-]{36}$/.test(m.id)||!Number.isInteger(m.count)||m.count<1||m.count>160||!/^[a-f0-9]{64}$/.test(m.hash))throw new Error('저장 형식 오류');
    if(m.old&&(!Array.isArray(m.old)||m.old.length>8||m.old.some(o=>!/^[a-f0-9-]{36}$/.test(o.id)||!Number.isInteger(o.count)||o.count<1||o.count>160)))throw new Error('정리 기록 오류');
    return m;
  }
  async function purge(m){if(m)for(let i=0;i<m.count;i++)await (await entry(`${m.id}.${i}`)).deletePassword();}
  function serial(fn){const result=tail.then(async()=>{state.loading=true;try{const out=await fn();state.error='';return out;}catch{state.error='OS 키체인에 접근하지 못했습니다. 잠금·권한·네이티브 모듈 설치를 확인하세요. 평문으로 대체 저장하지 않습니다.';throw new Error(state.error);}finally{state.loading=false;}});tail=result.catch(()=>{});return result;}
  return {
    status:()=>({...state}),
    inspect:()=>serial(async()=>{state.saved=!!await manifest();return {...state};}),
    read:()=>serial(async()=>{
      const m=await manifest();state.saved=!!m;if(!m)return null;
      const parts=[];for(let i=0;i<m.count;i++){const part=await (await entry(`${m.id}.${i}`)).getPassword();if(!part)throw new Error('누락된 조각');parts.push(Buffer.from(part,'base64'));}
      const token=Buffer.concat(parts).toString('utf8');if(createHash('sha256').update(token).digest('hex')!==m.hash)throw new Error('검증 실패');return token;
    }),
    write:token=>serial(async()=>{
      if(!token||token.length>20000)throw new Error('토큰 길이 오류');
      const previous=await manifest(),bytes=Buffer.from(token),m={id:randomUUID(),count:Math.ceil(bytes.length/512),hash:createHash('sha256').update(token).digest('hex')};
      // Retain cleanup references if a keychain locks between commit and deletion.
      const old=previous?[{id:previous.id,count:previous.count},...(previous.old||[])]:[];
      if(old.length>8)throw new Error('이전 토큰 정리 필요');
      let written=0;
      try{
        for(let i=0;i<m.count;i++){await (await entry(`${m.id}.${i}`)).setPassword(bytes.subarray(i*512,(i+1)*512).toString('base64'));written++;}
        await (await entry('manifest')).setPassword(JSON.stringify({...m,old}));
      }catch(e){await purge({...m,count:written}).catch(()=>{});throw e;}
      state.saved=true;for(const obsolete of old)await purge(obsolete);await (await entry('manifest')).setPassword(JSON.stringify(m));
    }),
    remove:()=>serial(async()=>{const m=await manifest();await purge(m);for(const obsolete of m?.old||[])await purge(obsolete);await (await entry('manifest')).deletePassword();state.saved=false;})
  };
}
export function disabledVault(){return {status:()=>({available:false,saved:false,loading:false,error:'테스트/메모리 DB에서는 OS 키체인을 사용하지 않습니다.'}),inspect:async()=>{},read:async()=>null,write:async()=>{throw new Error('키체인 비활성');},remove:async()=>{}};}

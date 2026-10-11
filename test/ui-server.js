import { createApp } from '../server/index.js';
import { Store } from '../server/store.js';
import { createGraphVault } from '../server/vault.js';
const secrets=new Map();
const vault=createGraphVault('ui-test',{platform:'win32',entryFactory:(service,name)=>({getPassword:async()=>secrets.get(name),setPassword:async value=>{secrets.set(name,value);},deletePassword:async()=>secrets.delete(name)})});
const graphOptions={fetcher:async(url,options)=>{
  if(options.headers.Authorization!=='Bearer ui-test-token-not-real')return new Response('',{status:401});
  return Response.json(url.includes('/me?')?{id:'ui-live-person',displayName:'테스트 계정'}:url.includes('/messages?')?{value:[{id:'mock-message',body:{content:'모의 업무 확인'},createdDateTime:new Date().toISOString()}]}:{value:[{id:'mock-room',topic:'모의 테스트 채팅'}]});
}};
const {app}=createApp({store:new Store(':memory:'),port:4311,vault,graphOptions});
app.listen(4311,'127.0.0.1');

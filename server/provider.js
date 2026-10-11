// HChat uses Bearer auth with Anthropic-shaped messages (ref/agents/po-hchat.agent.md).
// Native Anthropic thinking controls are deliberately not guessed from low/high/max.
export function providerRequest(entry,key,url) {
  if(entry.protocol!=='anthropic')return {url,headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:entry.body};
  if(entry.model.effortField)throw new Error('Anthropic 호환 모드의 추론 매핑은 미연결입니다. 모델 추론 필드를 미지원으로 설정하세요.');
  const messages=entry.body.messages.filter(m=>m.role!=='system');
  return {url,headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`,'anthropic-version':'2023-06-01'},body:{model:entry.model.model,max_tokens:entry.body[entry.model.tokenField],system:entry.body.messages.filter(m=>m.role==='system').map(m=>m.content).join('\n'),messages}};
}
export function providerResponse(protocol,data) {
  if(protocol!=='anthropic')return data;
  const u=data.usage;
  // No prompt caching requested. If gateway adds cache billing, keep liability uncertain.
  const hasCache=(u?.cache_creation_input_tokens||0)+(u?.cache_read_input_tokens||0)>0;
  return {choices:[{message:{content:data.content?.filter(b=>b.type==='text').map(b=>b.text).join('\n')},finish_reason:data.stop_reason==='max_tokens'?'length':data.stop_reason}],usage:hasCache?undefined:{prompt_tokens:u?.input_tokens,completion_tokens:u?.output_tokens}};
}

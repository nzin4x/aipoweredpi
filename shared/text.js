export function meetingInput({transcript='',notes='',agenda=''}) {
  if(!transcript.trim()&&!notes.trim())return '';
  return `## 대화록 / VTT (발언 근거)\n${transcript.trim()||'미제공'}\n\n## 내가 작성한 메모 (애매한 용어 표기 우선)\n${notes.trim()||'미제공'}\n\n## 사전 안건 (배경이며 결정 사실 아님)\n${agenda.trim()||'미제공'}`;
}
// LCS line diff; large guides use an honest whole-block replacement, not a quadratic allocation.
export function lineDiff(before,after) {
  const a=before.split('\n'),b=after.split('\n');
  if(a.length*b.length>500000)return [...a.map(text=>({kind:'remove',text})),...b.map(text=>({kind:'add',text}))];
  const rows=Array.from({length:a.length+1},()=>new Uint32Array(b.length+1));
  for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)rows[i][j]=a[i]===b[j]?rows[i+1][j+1]+1:Math.max(rows[i+1][j],rows[i][j+1]);
  let i=0,j=0;const out=[];
  while(i<a.length||j<b.length){if(i<a.length&&j<b.length&&a[i]===b[j]){out.push({kind:'same',text:a[i++]});j++;}else if(j<b.length&&(i===a.length||rows[i][j+1]>=rows[i+1][j]))out.push({kind:'add',text:b[j++]});else out.push({kind:'remove',text:a[i++]});}
  return out;
}

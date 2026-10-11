import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Store,seedDemo } from '../server/store.js';

test('MCP exposes bounded read-only search through actual stdio protocol',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'mytools-mcp-test-'));
  const store=new Store(join(dir,'mytools.sqlite'));seedDemo(store);store.close();
  const client=new Client({name:'mytools-test',version:'1.0.0'});
  const transport=new StdioClientTransport({command:process.execPath,args:[resolve('server/mcp.js')],env:{...process.env,MYTOOLS_DATA_DIR:dir},stderr:'pipe'});
  try {
    await client.connect(transport);
    const list=await client.listTools();assert.equal(list.tools.length,3);assert(list.tools.every(t=>t.annotations.readOnlyHint));
    const result=await client.callTool({name:'search_local_messages',arguments:{query:'모니터링',mode:'demo',limit:2}});
    const rows=JSON.parse(result.content[0].text);assert.equal(rows.length,1);assert(rows[0].body.includes('모니터링'));assert(rows[0].id);
  } finally {await client.close();rmSync(dir,{recursive:true,force:true});}
});

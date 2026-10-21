// Real Unix wire + existing native receipt validator. Native CLI integration
// below uses a local deterministic provider and the actual PostToolUse hook.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { SharedMcpTransport, endpoint, fileDigest } from '../runtime/shared-mcp.cjs';
import { TOOLS, validateCall } from '/home/penis/.minimax/plugins/control-task/scripts/control-task-core.mjs';
import { validatePendingReceipt, argumentDigest } from '/home/penis/.minimax/plugins/control-task/scripts/runtime/host.mjs';

const binary = process.env.MCODE_SHARED_BINARY ?? '/home/penis/projects/mcode-shared-mcp/target/release/mcode-shared-mcp';
const scratch = fs.mkdtempSync('/home/penis/tmp/mcode-shared-');
const wait = ms => new Promise(r => setTimeout(r,ms));
async function until(fn, timeout = 15000) { const end = Date.now()+timeout; while (!fn()) { if(Date.now()>end) throw Error('Timeout'); await wait(25); } }
const options = { command: binary, args:['control-task'], cwd:scratch, env:{PATH:process.env.PATH,MCODE_SHARED_MCP:'1',MCODE_SHARED_MCP_PROFILE:'receipt-v1'} };
function client() {
  const transport = new SharedMcpTransport(options), pending = new Map();
  transport.onmessage = message => { const item=pending.get(message.id); if(item) {pending.delete(message.id);item(message);} };
  return { transport, start:()=>transport.start(), close:()=>transport.close(), async call(method,params,id=1) {
    const response=new Promise(resolve=>pending.set(id,resolve)); await transport.send({jsonrpc:'2.0',id,method,...params===undefined?{}:{params}});
    return Promise.race([response,wait(5000).then(()=>{throw Error('wire timeout')})]);
  }};
}
function hosts() {
  return fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x)).flatMap(pid=>{
    try { const argv=fs.readFileSync(`/proc/${pid}/cmdline`,'utf8').split('\0'); if (argv[0]===binary && argv[1]==='control-task') return [Number(pid)]; }catch{} return [];
  });
}
function memory(pids) { return pids.reduce((total,pid)=>total+fs.readFileSync(`/proc/${pid}/smaps_rollup`,'utf8').split('\n').filter(line=>/^(Pss|SwapPss):/.test(line)).reduce((n,line)=>n+Number(line.match(/\d+/)[0]),0),0); }
let passed=0;
async function check(name,fn) {await fn();passed++;console.log('PASS '+name);}
const socket=endpoint(options).socketPath;
await check('streamed-fingerprint-content-parity-bounded-buffer-and-interpreter-generation',async()=>{
 const executable=process.execPath,expected=crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex');
 const originalRead=fs.readSync,originalReadFile=fs.readFileSync;let largest=0;
 fs.readSync=function(fd,buffer,...args){largest=Math.max(largest,buffer.length);return originalRead.call(this,fd,buffer,...args);};
 fs.readFileSync=function(file,...args){assert.notEqual(file,executable,'fingerprint must not load the entire Bun executable');return originalReadFile.call(this,file,...args);};
 try{assert.equal(fileDigest(executable),expected);}finally{fs.readSync=originalRead;fs.readFileSync=originalReadFile;}
 assert.ok(largest<=64*1024);
 const entry=path.join(scratch,'generation.mjs');fs.writeFileSync(entry,'export default 1');
 const js={command:executable,args:[entry],cwd:scratch,env:{MCODE_SHARED_MCP_PROFILE:'playwright-v1',HOME:'/fixture',__MAVIS_MCODE_TOOLS_BROKER_CAPABILITY_FILE:'/private'}};
 const first=endpoint(js);assert.deepEqual(first.environment,{MCODE_SHARED_MCP_PROFILE:'playwright-v1',HOME:'/fixture'});
 assert.equal(first.socketPath,endpoint({...js,env:{...js.env,__MAVIS_MCODE_TOOLS_BROKER_CAPABILITY_FILE:'/another'}}).socketPath);
 assert.notEqual(first.socketPath,endpoint({...js,cwd:'/'}).socketPath);
 fs.writeFileSync(entry,'export default 2');assert.notEqual(first.socketPath,endpoint(js).socketPath);
 for(const mode of ['whole','stream']){
  const code=mode==='whole'?`const fs=require('node:fs'),c=require('node:crypto');const digest=c.createHash('sha256').update(fs.readFileSync(process.execPath)).digest('hex');`:`const digest=require(${JSON.stringify(path.resolve(import.meta.dirname,'../runtime/shared-mcp.cjs'))}).fileDigest(process.execPath);`;
  const r=spawnSync(process.execPath,['-e',code+`;console.log(JSON.stringify({digest,peakRssKiB:Number(require('node:fs').readFileSync('/proc/self/status','utf8').match(/^VmHWM:\\s+(\\d+)/m)[1])}))`],{encoding:'utf8',timeout:10000});
  assert.equal(r.status,0,r.stderr);const result=JSON.parse(r.stdout);assert.equal(result.digest,expected);console.log(JSON.stringify({fingerprint:mode,peakRssKiB:result.peakRssKiB}));
 }
});
await check('peer-close-settles-write-when-runtime-callback-is-lost',async()=>{
 const opts={...options,args:['control-task','write-close-fixture',path.basename(scratch)]},file=endpoint(opts).socketPath;
 const server=net.createServer(socket=>{socket.on('error',()=>{});socket.once('data',()=>socket.destroy());});
 await new Promise(r=>server.listen(file,r));fs.chmodSync(file,0o600);
 const transport=new SharedMcpTransport(opts);
 try{
  await transport.start();const write=transport.socket.write.bind(transport.socket);
  // Inject the lost callback observed on Bun's capacity-close path. Keep real
  // peer I/O/error/close events, so the public send contract must settle on EOF.
  transport.socket.write=(bytes,_callback)=>write(bytes,()=>{});
  await assert.rejects(Promise.race([transport.send({jsonrpc:'2.0',id:1,method:'ping',params:{padding:'x'.repeat(2*1024*1024)}}),wait(2000).then(()=>{throw Error('Write did not settle after peer close');})]),/peer closed|EPIPE|ECONNRESET/);
 }finally{await transport.close();await new Promise(r=>server.close(r));if(fs.existsSync(file))fs.unlinkSync(file);}
});
await check('stdio-fallback-keeps-older-running-clients-functional',async()=>{
 const child=spawn(binary,['control-task'],{stdio:['pipe','pipe','pipe']});let output='',diagnostics='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>diagnostics+=b);
 child.stdin.end(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'control_task_get',arguments:{}}})+'\n');
 const code=await new Promise(r=>child.once('exit',r));assert.equal(code,0,diagnostics);assert.equal(JSON.parse(output).result.structuredContent.operation,'control_task_get');
});
await check('explicit-stateless-profile-strips-authority-scoped-profile-partitions-it',async()=>{
 assert.deepEqual(endpoint(options).environment,{});assert.equal(endpoint(options).cwd,'/');
 assert.equal(endpoint({...options,cwd:'/',env:{...options.env,MINIMAX_DATA_DIR:'/different',__MAVIS_MCODE_TOOLS_BROKER_CAPABILITY_FILE:'/private'}}).socketPath,socket);
 const scoped={...options,env:{...options.env,MCODE_SHARED_MCP_PROFILE:'scoped-v1'}};
 assert.notEqual(endpoint(scoped).socketPath,endpoint({...scoped,cwd:'/'}).socketPath);
 assert.notEqual(endpoint(scoped).socketPath,endpoint({...scoped,env:{...scoped.env,MINIMAX_DATA_DIR:'/different'}}).socketPath);
 const probe={...options,args:['probe','/fixture/package'],env:{...options.env,MCODE_SHARED_MCP_PROFILE:'probe-v1',MINIMAX_DATA_DIR:scratch,PROBE_LITERAL:'literal-ok',PROBE_EXPANDED:'${PLUGIN_DATA}',__MAVIS_MCODE_TOOLS_BROKER_CAPABILITY_FILE:'/private'}};
 assert.deepEqual(endpoint(probe).environment,{MINIMAX_DATA_DIR:scratch,PROBE_LITERAL:'literal-ok',PROBE_EXPANDED:'${PLUGIN_DATA}'});
 assert.equal(endpoint(probe).cwd,'/');
 assert.equal(endpoint(probe).socketPath,endpoint({...probe,cwd:'/',env:{...probe.env,__MAVIS_MCODE_TOOLS_BROKER_CAPABILITY_FILE:'/other'}}).socketPath);
 for(const [key,value] of [['MINIMAX_DATA_DIR','/other'],['PROBE_LITERAL','other'],['PROBE_EXPANDED','other']]) assert.notEqual(endpoint(probe).socketPath,endpoint({...probe,env:{...probe.env,[key]:value}}).socketPath);
 assert.notEqual(endpoint(probe).socketPath,endpoint({...probe,args:['probe','/other/package']}).socketPath);
});
await check('concurrent-cold-start-colliding-ids-catalog-hook-compatible-receipts',async()=>{
 const clients=Array.from({length:8},client);
 try {
  await Promise.all(clients.map(c=>c.start())); assert.equal(hosts().length,1);
  assert.equal(fs.readlinkSync(`/proc/${hosts()[0]}/cwd`),'/');assert.equal(fs.readFileSync(`/proc/${hosts()[0]}/environ`).length,0);
  const results=await Promise.all(clients.map((c,i)=>c.call('tools/call',{name:'control_task_set',arguments:{taskBody:`独立 ${i} 😀`,reason:'fixture'}})));
  for(let i=0;i<results.length;i++) {
   const result=results[i].result,args={taskBody:`独立 ${i} 😀`,reason:'fixture'};
   assert.equal(result.structuredContent.inputDigest,argumentDigest(args));
   const payload={hook_event_name:'PostToolUse',tool_name:'mcp__control-task__control_task_set',tool_input:args,tool_response:{details:{plugin:'control-task',server:'control-task',tool:'control_task_set',mcp:result}}};
   assert.equal(validatePendingReceipt(payload,'control-task',{tools:TOOLS,validateCall}).args.taskBody,args.taskBody);
   const hostile=structuredClone(payload);hostile.tool_input.session_id='attacker';assert.throws(()=>validatePendingReceipt(hostile,'control-task',{tools:TOOLS,validateCall}));
  }
  assert.deepEqual((await clients[0].call('tools/list')).result.tools,TOOLS);
  for(const args of [{}, {taskBody:''},{taskBody:'\u{feff}'},{taskBody:'a',sessionId:'evil'},{taskBody:'😀'.repeat(6001)},{taskBody:'ok',reviewedInputRevision:9007199254740992}]) assert.equal((await clients[0].call('tools/call',{name:'control_task_set',arguments:args})).error.code,-32602);
  for(const n of [0,-0,1,1e3,9007199254740991]) {
   const args={reviewedInputRevision:n};const reply=await clients[0].call('tools/call',{name:'control_task_confirm',arguments:args});
   assert.equal(reply.result.structuredContent.inputDigest,argumentDigest(args));
  }
  const rich={expectedRevision:1,operations:[{op:'replace',match:'\u{feff}😀',text:'A\nB\u2028中文'},{op:'add',text:'\\\"\t\r\b\f\u0000'}]};
  assert.equal((await clients[0].call('tools/call',{name:'control_task_patch',arguments:rich})).result.structuredContent.inputDigest,argumentDigest(rich));
  await clients[0].close();assert.equal((await clients[1].call('ping')).result instanceof Object,true);assert.equal(hosts().length,1);
 } finally {await Promise.all(clients.map(c=>c.close()));}
 await until(()=>hosts().length===0); assert.equal(fs.existsSync(socket),false);
});
await check('restart-stale-socket-and-unsafe-endpoint-refusal',async()=>{
 const one=client();await one.start();const pid=hosts()[0];process.kill(pid,'SIGKILL');await until(()=>hosts().length===0);await one.close();
 assert.equal(fs.lstatSync(socket).isSocket(),true);
 const two=client();await two.start();assert.notEqual(hosts()[0],pid);assert.deepEqual((await two.call('ping')).result,{});await two.close();await until(()=>hosts().length===0);
 fs.symlinkSync(path.join(scratch,'missing'),socket);
 try {await assert.rejects(()=>client().start(),/Unsafe shared MCP socket/);}finally{fs.unlinkSync(socket);}
 fs.writeFileSync(socket,'sentinel',{mode:0o600});try{await assert.rejects(()=>client().start(),/Unsafe shared MCP socket/);assert.equal(fs.readFileSync(socket,'utf8'),'sentinel');}finally{fs.unlinkSync(socket);}
});
await check('bounded-lines-invalid-json-hostile-metadata-and-draining',async()=>{
 const c=client();await c.start();
 const raw=net.createConnection(socket);await new Promise(r=>raw.once('connect',r));
 let output='';raw.on('data',b=>output+=b);
 raw.write('x'.repeat(1024*1024+1)+'\n'+JSON.stringify({jsonrpc:'2.0',id:7,method:'ping'})+'\n');
 await until(()=>output.includes('"id":7'));const replies=output.trim().split('\n').map(JSON.parse);assert.equal(replies[0].error.code,-32600);assert.deepEqual(replies[1].result,{});
 output='';raw.write('{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"control_task_set","arguments":{"taskBody":"\\ud800"}}}\n');await until(()=>output.includes('-32700'));
 output='';raw.end(JSON.stringify({jsonrpc:'2.0',id:9,method:'tools/call',params:{name:'control_task_get',arguments:{}},_meta:{session_id:'evil',cwd:'/etc'}})+'\n');
 await until(()=>output.includes('pending_host_commit'));assert.equal(JSON.parse(output).result.structuredContent.operation,'control_task_get');await c.close();await until(()=>hosts().length===0);
});

if(process.argv[2]) {
 const cli=path.resolve(process.argv[2]), baseline=process.argv[3];
 const source='/home/penis/.minimax/plugins/control-task';
 async function native(label, executable, shared, killFirst=false) {
  const root=path.join(scratch,label),data=path.join(root,'data'),workspace=path.join(root,'workspace');fs.mkdirSync(workspace,{recursive:true});fs.mkdirSync(data);
  fs.cpSync(source,path.join(data,'plugins','control-task'),{recursive:true});
  const definition=path.join(data,'plugins','control-task','control-task.mcp.json');
  fs.writeFileSync(definition,JSON.stringify({schemaVersion:1,mcpServers:{'control-task':{type:'stdio',command:shared?path.basename(binary):'bun',args:shared?['control-task']:['./scripts/control-task.mjs'],...shared?{env:{MCODE_SHARED_MCP:'1',MCODE_SHARED_MCP_PROFILE:'receipt-v1',PATH:path.dirname(binary)+':'+process.env.PATH}}:{}}}}));
  const stages=new Map(),held=new Map(),observations=[],children=[];
  let fatal;
  const provider=http.createServer(async(req,res)=>{
   try {
    let body='';for await(const bytes of req)body+=bytes;const input=JSON.parse(body);
    if(req.url.endsWith('/count_tokens')){res.writeHead(200,{'content-type':'application/json'});res.end('{"input_tokens":256}');return;}
    const id=JSON.stringify(input.messages).includes('actor-ALPHA')?'ALPHA':'BETA';
    const stage=stages.get(id)??0;stages.set(id,stage+1);
    if(stage===0){const schemas=input.tools.filter(t=>t.name.startsWith('mcp__control-task__'));assert.equal(schemas.length,4,JSON.stringify({toolNames:input.tools.map(t=>t.name),messageCount:input.messages.length}));}
    if(stage===2) {
     const all=JSON.stringify(input.messages);assert.ok(all.includes(`durable-${id}`));assert.ok(all.includes('definitive operation result'));assert.ok(!all.includes(`durable-${id==='ALPHA'?'BETA':'ALPHA'}`));
     observations.push({id,hookRead:true});held.set(id,()=>respond());return;
    }
    respond();
    function respond(){
     res.writeHead(200,{'content-type':'text/event-stream'});
     const send=(event,data)=>res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
     send('message_start',{type:'message_start',message:{id:`msg-${id}-${stage}`,type:'message',role:'assistant',content:[],model:'probe',stop_reason:null,stop_sequence:null,usage:{input_tokens:1,output_tokens:0}}});
     if(stage<2){
      const name=`mcp__control-task__control_task_${stage===0?'set':'get'}`,args=stage===0?{taskBody:`durable-${id} 😀`}:{};
      send('content_block_start',{type:'content_block_start',index:0,content_block:{type:'tool_use',id:`call-${stage}`,name,input:{}}});
      send('content_block_delta',{type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify(args)}});
     }else{
      send('content_block_start',{type:'content_block_start',index:0,content_block:{type:'text',text:''}});
      send('content_block_delta',{type:'content_block_delta',index:0,delta:{type:'text_delta',text:`complete-${id}`}});
     }
     send('content_block_stop',{type:'content_block_stop',index:0});send('message_delta',{type:'message_delta',delta:{stop_reason:stage<2?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:20}});send('message_stop',{type:'message_stop'});res.end();
    }
   }catch(error){fatal=error;res.destroy();}
  });
  await new Promise(r=>provider.listen(0,'127.0.0.1',r));
  const config=path.join(data,'config.yaml');fs.writeFileSync(config,`dataDir: ${data}\nlogLevel: info\ndataContribution:\n  enabled: false\nmemory:\n  enabled: false\npermissionMode: bypassPermissions\ndefaultModel: custom_provider:probe/probe\ncustom_provider:\n  probe:\n    name: probe\n    kind: custom\n    enabled: true\n    api: anthropic-messages\n    options:\n      apiKey: synthetic-local-fixture\n      baseURL: http://127.0.0.1:${provider.address().port}\n      authMode: api-key\n    models:\n      probe:\n        reasoning: false\n        limit:\n          context: 131072\n          output: 4096\n`);
  const outputs=[];
  // Initialize the fixture's native database/catalog before its simultaneous
  // clients, as in an installed mcode data root. MCP hosts still start cold.
  const preflight=spawnSync(executable,['plugin','list','--marketplace','local','--available','--json'],{cwd:workspace,env:{...process.env,MINIMAX_DATA_DIR:data,MCODE_CONFIG_DIR:data},encoding:'utf8',timeout:15000});
  assert.equal(preflight.status,0,preflight.error?.message||preflight.stderr);assert.ok(preflight.stdout.includes('control-task'),preflight.stdout);
  try {
   for(const id of ['ALPHA','BETA']) {
    const child=spawn(executable,['exec','--cwd',workspace,'--config',config,'--model','custom_provider:probe/probe','--permission','full','--timeout','60s','--output-format','stream-json',`actor-${id}`],{cwd:workspace,env:{...process.env,MINIMAX_DATA_DIR:data,MCODE_CONFIG_DIR:data,MCODE_NO_MODIFY_PATH:'1'}});
    children.push(child);const out={stdout:'',stderr:'',exit:null};outputs.push(out);child.stdout.on('data',b=>out.stdout+=b);child.stderr.on('data',b=>out.stderr+=b);child.once('exit',(code,signal)=>out.exit={code,signal});
   }
   await until(()=>{if(fatal)throw fatal;if(outputs.some(o=>o.exit))throw Error(JSON.stringify(outputs));return held.size===2;},45000);
   const pids=shared?hosts():fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x)).flatMap(pid=>{try{const argv=fs.readFileSync(`/proc/${pid}/cmdline`,'utf8');if(argv.includes(path.join(data,'plugins','control-task','scripts','control-task.mjs')))return[Number(pid)];}catch{}return[];});
   assert.equal(pids.length,shared?1:2);console.log(JSON.stringify({label,pids,pssSwapPssKiB:memory(pids),observations}));
   if(killFirst)children[0].kill('SIGKILL');else held.get('ALPHA')();
   await until(()=>outputs[0].exit!==null);if(!killFirst)assert.equal(outputs[0].exit.code,0,outputs[0].stderr);
   if(shared){assert.deepEqual(hosts(),pids);assert.equal(children[1].exitCode,null);}
   held.get('BETA')();await until(()=>outputs[1].exit!==null);assert.equal(outputs[1].exit.code,0,outputs[1].stderr);
   if(shared)await until(()=>hosts().length===0);
   const logs=path.join(data,'v2','observability','logs');assert.ok(fs.existsSync(logs));
   const messages=fs.readdirSync(logs).map(f=>fs.readFileSync(path.join(logs,f),'utf8')).join('\n');
   assert.ok(!/Failed to connect MCP server|MCP tool call failed/.test(messages));
   for(let i=0;i<outputs.length;i++){fs.writeFileSync(path.join(root,`${i}.stdout.jsonl`),outputs[i].stdout);fs.writeFileSync(path.join(root,`${i}.stderr`),outputs[i].stderr);}
  }finally{for(const c of children)if(c.exitCode===null&&c.signalCode===null)c.kill('SIGKILL');provider.closeAllConnections();await new Promise(r=>provider.close(r));}
 }
 if(baseline)await check('baseline-two-native-cli-clients',()=>native('baseline',baseline,false));
 await check('two-native-cli-clients-hooks-isolation-one-release',()=>native('native',cli,true));
 await check('killed-native-client-release-restart',()=>native('killed',cli,true,true));
}
console.log(`Shared MCP: ${passed} passed; fixture: ${scratch}`);

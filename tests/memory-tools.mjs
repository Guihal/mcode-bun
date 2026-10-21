// Compare the actual pinned local registry in owned, physical packages.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { inventory, files, transform } from '../scripts/build.mjs';
import { extractLocalTools, extractBaseTools } from '../scripts/lazy-tools-repair.mjs';
import { localToolDescriptors } from '../scripts/local-tool-descriptors.mjs';
import { lazyTool } from '../runtime/lazy-tool.mjs';

const pristine = path.resolve(process.argv[2] ?? ''), candidate = path.resolve(process.argv[3] ?? '');
if (!process.argv[2] || !process.argv[3]) throw Error('Usage: bun tests/memory-tools.mjs <pristine-package> <candidate-package>');
inventory(pristine);
const scratch = fs.mkdtempSync(path.join(process.env.MCODE_TEST_TMP ?? os.tmpdir(), 'mcode-local-tools-'));
const common = 'chunks/chunk-47KWM23C.js';
const resources = {};
const expected = transform(common, fs.readFileSync(path.join(pristine, common), 'utf8'), resources);
assert.equal(fs.readFileSync(path.join(candidate, common), 'utf8'), expected);
const localResources = () => Object.entries(resources).filter(([name]) => name.startsWith('lazy-tools/'));
assert.equal(localResources().length, 24);
assert.equal(new Set(localResources().map(([name]) => name.toLowerCase())).size, 24, 'resource names must survive case-folded filesystems/module caches');
for (const [name, source] of localResources()) assert.equal(fs.readFileSync(path.join(candidate, name), 'utf8'), source, name);
assert.throws(() => extractLocalTools(expected), /Lazy tool anchor drift|Unsupported lazy tool source/);
for (const descriptor of [...localToolDescriptors.classes, ...localToolDescriptors.helpers, ...localToolDescriptors.closures]) {
  // Each individual source hash is a fail-closed version guard.
  assert.equal(typeof descriptor.hash, 'string');
  if (descriptor.kind === 'class') assert.equal(expected.includes(descriptor.name + '=(()=>{'), false);
}
const mutated = fs.readFileSync(path.join(pristine, common), 'utf8').replace('this.eventSink=s', 'this.eventSink= s');
assert.throws(() => transform(common, mutated), /Unsupported pristine upstream/);
// The portable Windows-trash launch boundary is the only pre-extraction edit
// within these owners. Exercise the lazy extraction guards independently too.
const extractionInput = fs.readFileSync(path.join(pristine, common), 'utf8').replace('launcher:process.execPath,argv:[t.scriptPath', 'launcher:__mcodeRuntime,argv:[t.scriptPath');
assert.equal(Object.keys(extractLocalTools(extractionInput).resources).length, 24);
for (const needle of ['this.eventSink=s', 'function Jhn(e){', 'execute:async(r,i,s)=>{']) assert.throws(() => extractLocalTools(extractionInput.replace(needle, needle + ' ')), /Unsupported lazy tool source|Lazy tool anchor drift/);
const baseName = 'chunks/chunk-ZPSMBMGA.js';
assert.equal(fs.readFileSync(path.join(candidate, baseName), 'utf8'), transform(baseName, fs.readFileSync(path.join(pristine, baseName), 'utf8'), resources));
assert.equal(localResources().length, 28);
assert.throws(() => extractBaseTools(fs.readFileSync(path.join(pristine, baseName), 'utf8').replace('let{path:c,edits:u}=_6(i)', 'let{path:c,edits:u}= _6(i)')), /Unsupported lazy tool source/);

// Initialization is once per owner, retries after failed load, and never tied to
// an individual caller's signal. Execution errors keep their original identity.
let loads = 0, constructions = 0, calls = 0, release;
const ready = new Promise(resolve => release = resolve), failure = Error('execution fixture');
const load = async () => { loads++; await ready; return { default: (_deps, [tag]) => { constructions++; return { execute: async (_ctx, input) => { calls++; if (input.fail) throw failure; return tag; } }; } }; };
const first = lazyTool('fixture', load, () => ({}), ['first']);
const canceled = new AbortController(); canceled.abort();
await assert.rejects(first.execute({}, {}, canceled.signal), /Operation aborted/); assert.equal(loads, 0);
const during = new AbortController(), pending = first.execute({}, {}, during.signal), success = first.execute({}, {});
during.abort(); release();
await assert.rejects(pending, /Operation aborted/); assert.equal(await success, 'first');
assert.equal(loads, 1); assert.equal(constructions, 1); assert.equal(calls, 1);
await assert.rejects(first.execute({}, { fail: true }), error => error === failure);
assert.equal(await first.execute({}, {}), 'first'); assert.equal(constructions, 1);
const second = lazyTool('fixture', load, () => ({}), ['second']);
assert.equal(await second.execute({}, {}), 'second'); assert.equal(constructions, 2);
let attempts = 0;
const retry = lazyTool('fixture-retry', async () => { if (++attempts === 1) throw Error('missing resource'); return load(); }, () => ({}), ['retry']);
await assert.rejects(retry.execute({}, {}), /native tool fixture-retry: missing resource/);
assert.equal(await retry.execute({}, {}), 'retry'); assert.equal(attempts, 2);

const probe = String.raw`
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {heapStats}from'bun:jsc';
const stage=process.cwd(),candidate=process.argv[2]==='candidate',events=[];
const sample=()=>{Bun.gc(true);const h=heapStats();return{rss:process.memoryUsage().rss,heapSize:h.heapSize,heapCapacity:h.heapCapacity}};
const before=sample(),started=performance.now();
const c=await import('./package/chunks/chunk-47KWM23C.js');
const loaded=sample(),loadMs=performance.now()-started;
if(candidate)assert.deepEqual(c.mcodeTestCold(),{dispatcher:'undefined',formatter:'undefined',schemas:'undefined',handlers:'undefined',estimator:'undefined'});else assert.deepEqual(c.mcodeTestCold(),{dispatcher:'function',formatter:'function',schemas:'object',handlers:'object',estimator:'object'});
const normalize=x=>{
 if(typeof x==='function')return {function:x.toString()};if(typeof x==='symbol')return String(x);
 if(typeof x==='string')return x.replaceAll(stage,'<root>');if(!x||typeof x!=='object')return x;
 if(Array.isArray(x))return x.map(normalize);
 return Object.fromEntries(Reflect.ownKeys(x).filter(k=>k!=='durationMs').map(k=>[String(k),normalize(x[k])]));
};
const task={taskId:'task-1',kind:'bash',status:'running',metadata:{}},ctx={sessionId:'fixture-session',turnId:'fixture-turn',toolCallId:'fixture-tool',agentName:'fixture-agent',loadedSkills:new Set,canConsumeBackgroundTaskOutput:false,canConsumeBackgroundBashOutput:false};
const record=(name,result)=>{events.push(name);return result};
const cronAdapter=new Proxy({resolveModel:async()=>({kind:'resolved',model:'fixture-model'}),setSelfReminder:async()=>record('reminder',{taskId:'reminder-1'}),cancelSelfReminder:async()=>record('reminder-cancel',{})},{get:(target,key)=>target[key]??(async()=>record('cron:'+String(key),{taskId:'cron-1',id:'cron-1',tasks:[],items:[],total:0}))});
const options={workspaceRoot:stage,bashEnvPolicy:{mode:'scrub'},
 skillReader:{readSkill:async()=>record('skill',{content:'skill-ok',location:'fixture',sourceKind:'local'})},
 memoryAdapter:{execute:async()=>record('memory',{text:'memory-ok',details:{found:true}})},
 codeReviewAdapter:{run:async()=>record('review',{status:'prepared',mode:'all',instruction:'review-ok'})},
 mavisAgentAdapter:new Proxy({},{get:(_,key)=>async()=>record('mavis:'+String(key),[])}),mavisCronAdapter:cronAdapter,mavisSessionAdapter:{},mavisMcpAdapter:{},
 askUserAdapter:{begin:async()=>record('ask',{requestId:'request-1',schemaVersion:1,stepCount:1})},
 webFetchAdapter:{fetch:async()=>record('fetch',{content:'fetch-ok',status:200,base_resp:{status_code:0}})},
 webSearchAdapter:{search:async()=>record('search',{content:[{type:'text',text:'search-ok'}],text:'search-ok'})},
 taskAdapter:{runForeground:async()=>record('task',{status:'succeeded',taskId:'task-1',requestedAgentName:'fixture-agent',resolvedAgentName:'fixture-agent',finalText:'task-ok'})},
 taskAppendAdapter:{append:async()=>record('append',{taskId:'task-1',mode:'queued'})},
 taskControlAdapter:{get:async()=>record('get',task),list:async()=>({items:[task]}),readOutput:async()=>record('output',{status:'running',task,content:'output-ok',nextOffset:9}),stop:async()=>record('stop',{...task,status:'stopped'})},
 websiteDeployAdapter:{deploy:async()=>record('deploy',{cdn_url:'https://example.invalid/fixture',node_id:'fixture-node',base_resp:{status_code:0}})},
 workspaceSemanticSearchAdapter:{search:async()=>record('semantic',{revisionId:'revision-1',results:[{path:'example.txt',startLine:1,endLine:2,score:1,snippet:'semantic-ok'}]})},
 todoEventSink:{emitTodoUpdated:async()=>record('todo',true)},
};
const registry=c.mcodeTestRegistry(options),catalog=[...registry].map(([name,t])=>({name,definition:normalize(t.def)}));assert.equal(registry.size,27);
const fallback=c.mcodeTestFallback(stage,[],ctx),fallbackCatalog=fallback.map(tool=>({name:tool.name,label:tool.label,description:tool.description,parameters:normalize(tool.parameters),executionMode:tool.executionMode,prepare:normalize(tool.prepareArguments)}));assert.equal(fallback.length,4);
assert.equal(c.mcodeTestFallback(stage,[],ctx,{disableBuiltinFallback:true}).length,0);
const precedence=c.mcodeTestFallback(stage,[registry.get('read')],ctx);assert.equal(precedence.length,4);assert.equal(precedence.find(tool=>tool.name==='read').description,registry.get('read').def.description);
if(candidate)assert.deepEqual(globalThis.mcodeLocalLoads,{});
const call=(name,args,signal)=>registry.get(name).impl.execute(ctx,args,signal);
fs.writeFileSync(path.join(stage,'example.txt'),'alpha beta\nsecond line\n');fs.mkdirSync(path.join(stage,'site'));fs.writeFileSync(path.join(stage,'site/index.html'),'site');fs.mkdirSync(path.join(stage,'source'));
const canceled=new AbortController();canceled.abort();if(candidate){await assert.rejects(call('read',{path:'example.txt'},canceled.signal),/Operation aborted/);await assert.rejects(fallback.find(tool=>tool.name==='write').execute('canceled',{path:'fallback-before-load',content:'never'},canceled.signal),/Operation aborted/);assert.deepEqual(globalThis.mcodeLocalLoads,{});assert.equal(fs.existsSync(path.join(stage,'fallback-before-load')),false)}
if(candidate){const resource=path.join(stage,'package/lazy-tools/local-00.mjs');fs.renameSync(resource,resource+'.saved');try{await assert.rejects(call('read',{path:'example.txt'}),/Unable to initialize native tool read:.*local-00/);assert.deepEqual(globalThis.mcodeLocalLoads,{})}finally{fs.renameSync(resource+'.saved',resource)}}
const results={};
results.read=await call('read',{path:'example.txt'});
results.readMissing=await call('read',{path:'does-not-exist'}).then(value=>value,error=>({error:error.message,code:error.code}));
results.write=await call('write',{path:'written.txt',content:'write-ok\n'});assert.equal(fs.readFileSync(path.join(stage,'written.txt'),'utf8'),'write-ok\n');
results.edit=await call('edit',{file_path:'written.txt',old_string:'write-ok',new_string:'edit-ok'});assert.equal(fs.readFileSync(path.join(stage,'written.txt'),'utf8'),'edit-ok\n');
results.editAll=await call('edit',{file_path:'written.txt',old_string:'edit',new_string:'all',replace_all:true});assert.equal(fs.readFileSync(path.join(stage,'written.txt'),'utf8'),'all-ok\n');
results.editAllInvalid=await call('edit',{file_path:'written.txt',old_string:'',new_string:'never',replace_all:true}).then(value=>value,error=>({error:error.message,code:error.code}));assert.match(results.editAllInvalid.error,/old_string must be non-empty/);
results.bash=await call('bash',{command:process.platform==='win32'?"Write-Output 'bash-ok'":'printf bash-ok',description:'fixture shell'});assert.match(results.bash.text,/bash-ok/);
results.grep=await call('grep',{pattern:'alpha',path:'example.txt',output_mode:'content'});assert.match(results.grep.text,/alpha/);
results.grepInvalid=await call('grep',{pattern:'[',path:'example.txt',output_mode:'content'});assert.equal(results.grepInvalid.isError,true);
results.glob=await call('glob',{pattern:'example.txt'});assert.match(results.glob.text,/example.txt/);
results.skill=await call('skill',{name:'fixture'});
results.memory=await call('memory',{command:'search',query:'fixture'});
results.review=await call('code_review',{mode:'all'});
results.mavis=await call('mavis',{command:'invalid-fixture-command'});
results.mavisList=await call('mavis',{command:'agent list',args:{}});assert.notEqual(results.mavisList.isError,true);assert.ok(events.includes('mavis:listAgents'));
results.mavisInvalidArgs=await call('mavis',{command:'agent get',args:{}});assert.equal(results.mavisInvalidArgs.isError,true);
for(const command of ['agent help','session help','mcp help']){results[command]=await call('mavis',{command,args:{}});assert.notEqual(results[command].isError,true)}
results.ask=await call('ask_user',{questions:[]});results.feature=await call('request_feature_enable',{featureKey:'fixture'});
results.fetch=await call('web_fetch',{url:'https://example.invalid'});results.search=await call('web_search',{query:'fixture'});
const adapterFailure=Error('adapter-fixture-failure'),originalFetch=options.webFetchAdapter.fetch;options.webFetchAdapter.fetch=async()=>{throw adapterFailure};await assert.rejects(call('web_fetch',{url:'https://example.invalid'}),error=>error===adapterFailure);options.webFetchAdapter.fetch=originalFetch;await call('web_fetch',{url:'https://example.invalid'});
results.task=await call('task',{agent_name:'fixture-agent',prompt:'fixture',run_in_background:false});
results.append=await call('task_append',{task_id:'task-1',content:'fixture'});
results.query=await call('task_query',{task_id:'task-1'});
results.output=await call('task_output',{task_id:'task-1',offset:0});results.outputAgain=await call('task_output',{task_id:'task-1',offset:0});assert.match(results.outputAgain.text,/unchanged since/);
results.stop=await call('task_stop',{task_id:'task-1'});
results.deploy=await call('website_deploy',{path:'site',source_path:'source'});assert.equal(results.deploy.details.ok,true);
results.semantic=await call('workspace_semantic_search',{query:'fixture'});
results.todo=await call('todowrite',{todos:[{id:'todo-1',content:'fixture',status:'pending',priority:'medium'}]});
for(const name of ['cron_create','cron_read','cron_update','cron_delete'])results[name]=await call(name,name==='cron_create'?{name:'fixture',prompt:'fixture',schedule:'0 0 * * *'}:{cron_id:'cron-1'});
results.cronList=await call('cron_read',{view:'list'});assert.notEqual(results.cronList.isError,true);assert.ok(events.includes('cron:listCrons'));
results.reminder=await call('self_reminder',{action:'set',delay_seconds:10,prompt:'fixture'});
assert.ok(events.includes('reminder'));
for(const event of ['skill','memory','review','ask','fetch','search','task','append','get','output','stop','deploy','semantic','todo'])assert.ok(events.includes(event),event);
if(candidate){assert.equal(Object.keys(globalThis.mcodeLocalLoads).length,28);assert.ok(Object.values(globalThis.mcodeLocalLoads).every(n=>n===1))}
const fallbackCall=(name,args,signal,update)=>fallback.find(tool=>tool.name===name).execute('fallback-call',args,signal,update);
results.fallbackRead=await fallbackCall('read',{path:'example.txt'});assert.match(results.fallbackRead.content[0].text,/alpha/);
results.fallbackWrite=await fallbackCall('write',{path:'fallback.txt',content:'fallback-write'});
results.fallbackEdit=await fallbackCall('edit',{path:'fallback.txt',edits:[{oldText:'fallback-write',newText:'fallback-edit'}]});assert.equal(fs.readFileSync(path.join(stage,'fallback.txt'),'utf8'),'fallback-edit');
let updates=0;results.fallbackBash=await fallbackCall('bash',{command:process.platform==='win32'?"Write-Output 'fallback-bash'":'printf fallback-bash'},undefined,()=>{updates++});assert.match(results.fallbackBash.content[0].text,/fallback-bash/);assert.ok(updates>0);
await assert.rejects(fallbackCall('write',{path:'fallback-canceled',content:'never'},canceled.signal),/Operation aborted/);assert.equal(fs.existsSync(path.join(stage,'fallback-canceled')),false);
const other=path.join(stage,'other');fs.mkdirSync(other);fs.writeFileSync(path.join(other,'example.txt'),'other-owner');
const isolated=c.mcodeTestRegistry({...options,workspaceRoot:other});const secondRead=await isolated.get('read').impl.execute(ctx,{path:'example.txt'});assert.match(secondRead.text,/other-owner/);
const secondOutput=await isolated.get('task_output').impl.execute(ctx,{task_id:'task-1',offset:0});assert.doesNotMatch(secondOutput.text,/unchanged since/);
const managed={runManagedForeground:async()=>({status:'completed',text:'managed-ok',details:{envSanitized:['FIXTURE_REMOVED']}})},managedCtx={...ctx,canConsumeBackgroundBashOutput:true};
const managedOwner=c.mcodeTestRegistry({...options,bashAdapter:managed}),managedOther=c.mcodeTestRegistry({...options,bashAdapter:managed});
const managedCall=owner=>owner.get('bash').impl.execute(managedCtx,{command:'fixture',description:'fixture state'});
assert.deepEqual((await managedCall(managedOwner)).details.envSanitized,['FIXTURE_REMOVED']);assert.equal((await managedCall(managedOwner)).details.envSanitized,undefined);assert.deepEqual((await managedCall(managedOther)).details.envSanitized,['FIXTURE_REMOVED']);
const after=sample();
console.log(JSON.stringify({catalog,fallbackCatalog,results:normalize(results),events,memory:{before,loaded,after,loadMs},loads:globalThis.mcodeLocalLoads}));
`;

const outputs = {};
for (const [label, input] of [['baseline', pristine], ['candidate', candidate]]) {
  const stage = path.join(scratch, label), pkg = path.join(stage, 'package'); fs.mkdirSync(stage);
  fs.cpSync(input, pkg, { recursive: true });
  fs.cpSync(path.join(candidate, '..', 'runtime'), path.join(stage, 'runtime'), { recursive: true });
  if (!fs.existsSync(path.join(pkg, 'node_modules'))) fs.cpSync(path.join(candidate, 'node_modules'), path.join(pkg, 'node_modules'), { recursive: true });
  const file = path.join(pkg, common);
  if (label === 'baseline') fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('import C5 from"better-sqlite3"', 'import C5 from"../../runtime/sqlite.cjs"'));
  else for (const [name] of localResources()) {
    const resource = path.join(pkg, name);
    fs.writeFileSync(resource, 'globalThis.mcodeLocalLoads??={};globalThis.mcodeLocalLoads[' + JSON.stringify(name) + ']=(globalThis.mcodeLocalLoads[' + JSON.stringify(name) + ']??0)+1;\n' + fs.readFileSync(resource, 'utf8'));
  }
  fs.appendFileSync(file, '\nexport{ygi as mcodeTestRegistry,rWe as mcodeTestFallback};export function mcodeTestCold(){return{dispatcher:typeof fpe,formatter:typeof ppe,schemas:typeof __n,handlers:typeof v_n,estimator:typeof Gwn}};\n');
  fs.writeFileSync(path.join(stage, 'probe.mjs'), 'globalThis.mcodeLocalLoads={};\n' + probe);
  const data = path.join(stage, 'data'); fs.mkdirSync(data);
  const run = spawnSync(process.execPath, [path.join(stage, 'probe.mjs'), label], { cwd: stage, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, MINIMAX_DATA_DIR: data, MCODE_CONFIG_DIR: data, NODE_ENV: 'test' } });
  fs.writeFileSync(path.join(stage, 'stderr.txt'), run.stderr ?? '');
  assert.equal(run.status, 0, label + ': ' + (run.stderr || String(run.error)));
  assert.doesNotMatch(run.stderr, /Unhandled|ReferenceError|TypeError|SyntaxError/);
  fs.writeFileSync(path.join(stage, 'result.json'), run.stdout);
  outputs[label] = JSON.parse(run.stdout);
}
assert.deepEqual(outputs.candidate.catalog, outputs.baseline.catalog, 'complete catalog, schema symbols and preparation hooks');
assert.deepEqual(outputs.candidate.fallbackCatalog, outputs.baseline.fallbackCatalog, 'base fallback metadata and permission preparation');
// Shell execution timing is observation data, rather than stable output content.
function untimed(value) {
  if (Array.isArray(value)) return value.map(untimed);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['timing','durationMs'].includes(key)).map(([key,x]) => [key,untimed(x)]));
}
assert.deepEqual(untimed(outputs.candidate.results), untimed(outputs.baseline.results));
assert.deepEqual(outputs.candidate.events, outputs.baseline.events);
console.log(JSON.stringify({ passed: '27 registered tools + 4 direct fallbacks: metadata/first-use, filesystem/shell, adapters, precedence, owner isolation, cancellation, retry', baseline: outputs.baseline.memory, candidate: outputs.candidate.memory, fixture: scratch }, null, 2));

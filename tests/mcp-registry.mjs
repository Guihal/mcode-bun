// Exercise the actual pinned allocator and bundled proper-lockfile, not a copy.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { repairMcpRegistry } from '../scripts/mcp-registry-repair.mjs';

const wait = ms => new Promise(resolve => setTimeout(resolve,ms));
async function until(predicate,timeout=10000) {
  const deadline=performance.now()+timeout;
  while(!predicate()) { if(performance.now()>=deadline)throw Error('Registry fixture timeout');await wait(10); }
}
const mode=process.argv[2];
if(mode==='hold'||mode==='allocate') {
  const {Registry,lockfile}=await import(pathToFileURL(process.argv[3]).href);
  const file=process.argv[4];
  if(mode==='hold') {
    const release=lockfile.lockSync(file,{realpath:false,retries:0});
    fs.writeFileSync(process.argv[6],'ready');
    await wait(Number(process.argv[5]));release();process.exit(0);
  }
  const actor=process.argv[5];await until(()=>fs.existsSync(process.argv[6]));
  const registry=new Registry(file),key=JSON.stringify(['configured',actor]);
  const servers=registry.assignServers([{key,name:'same server'}]);
  const tools=registry.assignTools(key,['first tool','first@tool']);
  fs.writeFileSync(file+'.'+actor+'.result.json',JSON.stringify({server:servers.names.get(key),tools:[...tools.names]}));
  process.exit(0);
}

const root=path.resolve(import.meta.dirname,'..');
const latest=JSON.parse(fs.readFileSync(path.join(root,'.build/latest.json')));
const sourceFile=process.env.MCODE_REGISTRY_SOURCE??path.join(path.dirname(latest.output),'package/chunks/chunk-5ADYFF2U.js');
const source=fs.readFileSync(sourceFile,'utf8');
const scratch=fs.mkdtempSync('/home/penis/tmp/mcode-registry-');
function extract(text,file) {
  const names=new Set(['hh','zr']),imports=[];
  for(const match of text.matchAll(/import\{([^}]+)\}from"([^"]+)";/g)) {
    const selected=match[1].split(',').filter(spec=>names.has(spec.split(' as ').at(-1)));
    if(selected.length) {
      for(const spec of selected)names.delete(spec.split(' as ').at(-1));
      imports.push(`import {${selected.join(',')}} from ${JSON.stringify(pathToFileURL(path.resolve(path.dirname(sourceFile),match[2])).href)};`);
    }
  }
  assert.equal(names.size,0,'Pinned allocator dependency imports changed');
  const start=text.indexOf('function KK(t,e)'),end=text.indexOf('var Jjr=4',start);
  assert.ok(start>=0&&end>start&&text.slice(start,end).includes('yp=class'));
  fs.writeFileSync(file,imports.join('\n')+'\n'+text.slice(start,end)+'\nexport {yp as Registry,C9e as lockfile};\n');
}
const original=path.join(scratch,'original.mjs'),fixed=path.join(scratch,'fixed.mjs');
extract(source,original);extract(repairMcpRegistry(source),fixed);
const old=await import(pathToFileURL(original).href),patched=await import(pathToFileURL(fixed).href);
const children=new Set();
function child(args) {
  const proc=spawn(process.execPath,[import.meta.filename,...args],{env:{...process.env,MINIMAX_DATA_DIR:path.join(scratch,'data')},stdio:['ignore','ignore','pipe']});
  let diagnostics='';proc.stderr.on('data',b=>diagnostics+=b);
  proc.done=new Promise((resolve,reject)=>{proc.once('error',reject);proc.once('exit',(code,signal)=>{children.delete(proc);code===0?resolve():reject(Error(`Registry child ${code}/${signal}: ${diagnostics}`));});});
  // Attach a rejection observer even while the main thread is in lockSync.
  proc.done.catch(()=>{});children.add(proc);return proc;
}
async function held(file,ms,fn) {
  const marker=file+'.held';const proc=child(['hold',fixed,file,String(ms),marker]);
  try { await until(()=>{if(proc.exitCode!==null)throw Error('Locker exited early');return fs.existsSync(marker);});return await fn(); }
  finally { await proc.done; }
}
let passed=0;async function check(name,fn){await fn();passed++;console.log('PASS '+name);}
try {
await check('original-fails-real-contention-fixed-acquires-once',async()=>{
  const before=path.join(scratch,'before.json');
  await held(before,250,()=>{const t=performance.now();assert.throws(()=>new old.Registry(before).transaction(()=>{}),{code:'ELOCKED'});assert.ok(performance.now()-t<150);});
  const after=path.join(scratch,'after.json');let calls=0;
  await held(after,250,()=>{const t=performance.now();new patched.Registry(after).transaction(()=>calls++);assert.equal(calls,1);assert.ok(performance.now()-t>=150);});
});
await check('concurrent-real-processes-keep-every-allocation-and-stable-collisions',async()=>{
  const file=path.join(scratch,'concurrent.json'),barrier=file+'.go';
  const procs=['alpha','beta'].map(actor=>child(['allocate',fixed,file,actor,barrier]));
  fs.writeFileSync(barrier,'go');await Promise.all(procs.map(p=>p.done));
  const state=JSON.parse(fs.readFileSync(file));assert.equal(state.servers.length,2);
  assert.equal(new Set(state.servers.map(s=>s.segment)).size,2);
  for(const s of state.servers){assert.equal(s.tools.length,2);assert.equal(new Set(s.tools.map(t=>t.segment)).size,2);}
  const snapshot=fs.readFileSync(file,'utf8'),registry=new patched.Registry(file);
  const servers=registry.assignServers(state.servers.map(s=>({key:s.key,name:s.raw})));
  for(const s of state.servers){assert.equal(servers.names.get(s.key),s.segment);registry.assignTools(s.key,s.tools.map(t=>t.raw));}
  assert.equal(fs.readFileSync(file,'utf8'),snapshot);
});
await check('acquisition-deadline-is-bounded-with-live-owner',async()=>{
  const file=path.join(scratch,'deadline.json');let calls=0;
  await held(file,6200,()=>{const t=performance.now();assert.throws(()=>new patched.Registry(file).transaction(()=>calls++),{code:'ELOCKED'});const elapsed=performance.now()-t;assert.ok(elapsed>=4900&&elapsed<5800,`deadline ${elapsed} ms`);assert.equal(calls,0);});
});
await check('callback-errors-never-replay-and-release-owner-lock',async()=>{
  const file=path.join(scratch,'callback.json'),registry=new patched.Registry(file);let calls=0;
  const failure=Object.assign(Error('callback failure'),{code:'ELOCKED'}),t=performance.now();
  assert.throws(()=>registry.transaction(()=>{calls++;throw failure;}),error=>error===failure);assert.equal(calls,1);assert.ok(performance.now()-t<150);
  registry.assignServers([{key:'valid',name:'valid'}]);assert.equal(JSON.parse(fs.readFileSync(file)).servers.length,1);
});
await check('invalid-storage-and-source-drift-fail-without-callback-or-overwrite',async()=>{
  const file=path.join(scratch,'invalid.json');fs.writeFileSync(file,'{broken');let calls=0;const t=performance.now();
  assert.throws(()=>new patched.Registry(file).transaction(()=>calls++),SyntaxError);assert.equal(calls,0);assert.equal(fs.readFileSync(file,'utf8'),'{broken');assert.ok(performance.now()-t<150);
  const directory=path.join(scratch,'directory');fs.mkdirSync(directory);
  assert.throws(()=>new patched.Registry(directory).transaction(()=>calls++));assert.equal(calls,0);
  assert.throws(()=>repairMcpRegistry(''),/Unsupported upstream/);assert.throws(()=>repairMcpRegistry(source+source),/Unsupported upstream/);
});
} finally { for(const proc of children)if(proc.exitCode===null)proc.kill('SIGTERM'); }
console.log(`MCP registry: ${passed} passed; fixture: ${scratch}`);

// Actual upstream owners in disposable physical packages and compiled programs.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { compile, files, inventory, transform } from '../scripts/build.mjs';
import { repairStartupMemory } from '../scripts/startup-memory-repair.mjs';

const pristine = process.argv[2] && path.resolve(process.argv[2]);
const candidate = process.argv[3] && path.resolve(process.argv[3]);
if (!pristine || !candidate) throw Error('Usage: bun tests/memory-startup.mjs <pristine-package> <candidate-package>');
const scratch = fs.mkdtempSync(path.join(process.env.MCODE_TEST_TMP ?? os.tmpdir(), 'mcode-startup-'));
const common = 'chunks/chunk-47KWM23C.js', runtime = 'chunks/chunk-5ADYFF2U.js';
const discovery = inventory(pristine); // Exhaustive executable identity, not a reference-count safety claim.
assert.equal(discovery.graphHash, '2520a62f1acb553e4c581aa633a357f2513ccc4538a4124bf2922f8136892d02');
let inspected = 0;
for (const file of files(pristine)) {
  const name = path.relative(pristine, file).replaceAll(path.sep, '/');
  if (!/\.(?:[cm]?js)$/.test(name) || name.startsWith('assets/')) continue;
  const source = fs.readFileSync(file, 'utf8');
  if (name !== 'verify-native-install.mjs') {
    const output = transform(name, source);
    new Bun.Transpiler({ loader: 'js' }).scanImports(output.replace(/^#![^\n]*\n/, ''));
    if ([common, runtime].includes(name)) assert.equal(fs.readFileSync(path.join(candidate, name), 'utf8'), output, name);
  }
  inspected++;
}
assert.equal(inspected, 98);
for (const name of [common, runtime]) {
  const source = fs.readFileSync(path.join(pristine, name), 'utf8');
  assert.throws(() => repairStartupMemory(name, source.replace(name === common ? 'WRn=Es(ctt(),1)' : 'countTokens:kf', 'changed_anchor')), /Startup repair anchor drift/);
  if (name === common) assert.throws(() => repairStartupMemory(name, source.replace('ctt=Ne(($_i,att)=>', 'ctt=Ne(($_i,att)=> ')), /Unsupported unused startup vendor loaders/);
  assert.throws(() => repairStartupMemory(name, repairStartupMemory(name, source)), /Startup repair anchor drift|Unsupported unused startup vendor loaders/);
}

const entry = String.raw`
import fs from 'node:fs';import path from 'node:path';import {createRequire}from'node:module';import {heapStats}from'bun:jsc';
const sample=()=>{Bun.gc(true);const h=heapStats(),m=process.memoryUsage();return{rss:m.rss,heapSize:h.heapSize,heapCapacity:h.heapCapacity,extraMemorySize:h.extraMemorySize}};
const before=sample(),started=performance.now(),fetchBefore=globalThis.fetch,errorHook=Error.prepareStackTrace,limit=Error.stackTraceLimit;
const c=await import('./package/chunks/chunk-47KWM23C.js'),r=await import('./package/chunks/chunk-5ADYFF2U.js');
const loaded=sample(),loadMs=performance.now()-started,cold=c.mcodeTestCold();
const extensions=createRequire(import.meta.url).extensions;
const catalogOptions={workspaceRoot:process.cwd(),skillReader:{},memoryAdapter:{},codeReviewAdapter:{},mavisAgentAdapter:{},mavisCronAdapter:{},mavisSessionAdapter:{},mavisMcpAdapter:{},askUserAdapter:{},webFetchAdapter:{},webSearchAdapter:{},taskAdapter:{},taskAppendAdapter:{},taskControlAdapter:{},websiteDeployAdapter:{},workspaceSemanticSearchAdapter:{}};
const catalog=[...c.mcodeTestRegistry(catalogOptions)].map(([name,tool])=>({name,definition:tool.def,prepare:typeof tool.def.prepareArguments,classifier:typeof tool.def.operationClassifier}));

const result=fn=>{try{return{value:fn()}}catch(e){return{error:e.name+': '+e.message,code:e.code}}};
const extensionTemplate=result(()=>{const module={exports:{}};extensions['.hbs'](module,path.join(process.cwd(),'fixture.hbs'));return module.exports({name:'hook-ok'})});
const texts=['','hello world','Привет, мир!','你好，世界！','مرحبا بالعالم','हैलो दुनिया','const f = (x) => x?.value ?? 42;\n','\u0000\r\n\t','👩‍💻😀🇷🇺','e\u0301 é 𝄞','\ud800','\udc00','<|endoftext|>','<|endofprompt|>','a<|endoftext|>b','<|fim_prefix|> <|fim_middle|> <|fim_suffix|>','<|im_start|>user\nhi<|im_end|>'];
let state=1729;for(let i=0;i<160;i++){let text='';for(let n=0;n<i+1;n++){state=(Math.imul(state,1664525)+1013904223)>>>0;text+=String.fromCodePoint([32,97,10,0x441,0x4e2d,0x1f600,0x301][state%7])}texts.push(text)}
const policies=[()=>undefined,()=>({allowedSpecial:'all'}),()=>({disallowedSpecial:new Set}),()=>({allowedSpecial:new Set(['<|endoftext|>'])}),()=>({allowedSpecial:'all',disallowedSpecial:'all'}),()=>({disallowedSpecial:'all'})];
const counts=texts.map(t=>policies.map(p=>result(()=>r.mcodeTestMemoryCount(t,p()))));
const primary=texts.map(t=>policies.map(p=>result(()=>c.mcodeTestRaw(t,p()))));
const invalid=[null,undefined,1,{},[],[{role:'user',content:'hello'}]].map(t=>result(()=>r.mcodeTestMemoryCount(t)));
const estimate=c.mcodeTestEstimator();
const context=texts.map(t=>estimate.estimateContextTokens([{role:'user',content:t,timestamp:0},{role:'assistant',content:[{type:'text',text:t}],usage:{input:3,output:2,cacheRead:0,cacheWrite:0,totalTokens:5},stopReason:'stop',timestamp:1},{role:'toolResult',content:[{type:'text',text:t}],timestamp:2}]));
const trim=texts.map(t=>result(()=>r.mcodeTestTrim(t)));
const documents=[{text:'plain'},{text:'<|endoftext|>'},{text:'😀'},{}].map(x=>r.mcodeTestDocument(x,10000));
const prompt=[result(()=>c.mcodeTestRender('Hi {{name}} {{#if enabled}}{{value}}{{/if}}',{name:'<world>',enabled:true,value:'ok'},'probe')),result(()=>c.mcodeTestRender('{{missing.value}}',{},'probe')),result(()=>c.mcodeTestCheck('{{#if value}}')),result(()=>c.mcodeTestCheck('{{value}}'))];
const ajv=c.mcodeTestValidator(),validate=ajv.compile({type:'object',required:['value'],additionalProperties:false,properties:{value:{type:'integer',minimum:1},email:{type:'string',format:'email'}}});
const validation=[{value:1,email:'a@example.org'},{value:0},{},{value:2,extra:true},{value:1,email:'invalid'}].map(x=>({valid:validate(x),errors:validate.errors?.map(e=>({keyword:e.keyword,instancePath:e.instancePath,message:e.message}))}));
const after=c.mcodeTestCold(),used=sample();
console.log(JSON.stringify({catalog,counts,primary,invalid,context,trim,documents,prompt,validation,extensionTemplate,cold,after,secondary:r.mcodeTestSecondary(),effects:{fetch:fetchBefore===globalThis.fetch,errorHook:errorHook===Error.prepareStackTrace,stackLimit:limit===Error.stackTraceLimit,hbs:typeof extensions['.hbs'],handlebars:typeof extensions['.handlebars']},memory:{before,loaded,used,loadMs,accounting:'RSS and JSC live heap/capacity/extra are separate overlapping measurements; do not sum them'}}));
`;

const outputs = {};
for (const [label, input] of [['baseline', pristine], ['candidate', candidate]]) {
  const stage = path.join(scratch, label), pkg = path.join(stage, 'package');
  fs.mkdirSync(stage);
  fs.cpSync(input, pkg, { recursive: true });
  fs.cpSync(path.join(candidate, '..', 'runtime'), path.join(stage, 'runtime'), { recursive: true });
  if (!fs.existsSync(path.join(pkg, 'node_modules'))) fs.cpSync(path.join(candidate, 'node_modules'), path.join(pkg, 'node_modules'), { recursive: true });
  if (label === 'baseline') {
    const file = path.join(pkg, common), source = fs.readFileSync(file, 'utf8');
    assert.equal(source.split('import C5 from"better-sqlite3"').length, 2);
    // Only the existing runtime compatibility boundary; tokenizer/vendor bytes stay original.
    fs.writeFileSync(file, source.replace('import C5 from"better-sqlite3"', 'import C5 from"../../runtime/sqlite.cjs"'));
    const runtimeFile = path.join(pkg, runtime), runtimeSource = fs.readFileSync(runtimeFile, 'utf8');
    assert.equal(runtimeSource.split('import("@larksuiteoapi/node-sdk")').length, 3);
    fs.writeFileSync(runtimeFile, runtimeSource.replaceAll('import("@larksuiteoapi/node-sdk")', 'import(import.meta.resolve("@larksuiteoapi/node-sdk",__mavis_tuiPackageEntryUrl))'));
  }
  fs.appendFileSync(path.join(pkg, common), '\nexport{rGe as mcodeTestRaw,df as mcodeTestEstimator,Z9 as mcodeTestRender,ZVn as mcodeTestCheck,nCn as mcodeTestValidator};export{ygi as mcodeTestRegistry};export const mcodeTestCold=()=>({validator:typeof PXe!=="undefined",prompt:typeof dVn!=="undefined",precompile:typeof fft!=="undefined",tokenizer:typeof wln!=="undefined"});\n');
  fs.appendFileSync(path.join(pkg, runtime), '\nexport{kf as mcodeTestMemoryCount,CUt as mcodeTestTrim,HY as mcodeTestDocument};export const mcodeTestSecondary=()=>typeof bzn!=="undefined";\n');
  const source = path.join(stage, 'probe.mjs'), executable = path.join(stage, process.platform === 'win32' ? 'probe.exe' : 'probe');
  fs.writeFileSync(source, entry);
  fs.writeFileSync(path.join(stage, 'fixture.hbs'), 'Hello {{name}}');
  compile(source, executable);
  const data = path.join(stage, 'data'); fs.mkdirSync(data);
  const run = spawnSync(executable, [], { cwd: stage, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, MINIMAX_DATA_DIR: data, MCODE_CONFIG_DIR: data, MCODE_NO_MODIFY_PATH: '1' } });
  assert.equal(run.status, 0, run.stderr || String(run.error));
  assert.doesNotMatch(run.stderr, /Unhandled|ReferenceError|TypeError|SyntaxError/);
  fs.writeFileSync(path.join(stage, 'result.json'), run.stdout);
  outputs[label] = JSON.parse(run.stdout);
}
for (const property of ['catalog', 'counts', 'primary', 'invalid', 'context', 'trim', 'documents', 'prompt', 'validation', 'effects', 'extensionTemplate']) assert.deepEqual(outputs.candidate[property], outputs.baseline[property], property);
assert.equal(outputs.candidate.catalog.length, 27);
assert.deepEqual(outputs.candidate.extensionTemplate, { value: 'Hello hook-ok' });
assert.deepEqual(outputs.baseline.effects, { fetch: true, errorHook: true, stackLimit: true, hbs: 'function', handlebars: 'function' });
assert.deepEqual(outputs.baseline.cold, { validator: true, prompt: true, precompile: true, tokenizer: true });
assert.deepEqual(outputs.candidate.cold, { validator: false, prompt: false, precompile: true, tokenizer: false });
assert.deepEqual(outputs.candidate.after, { validator: true, prompt: true, precompile: true, tokenizer: true });
assert.equal(outputs.baseline.secondary, true);
assert.equal(outputs.candidate.secondary, false);
assert.ok(outputs.baseline.counts.some(row => row.some(value => value.error?.includes('Disallowed special token'))));
assert.equal(outputs.candidate.validation[0].valid, true);
assert.ok(outputs.candidate.validation.slice(1).every(value => !value.valid));
console.log(JSON.stringify({ ok: true, executableFiles: inspected, tokenCases: outputs.candidate.counts.length * 6, baseline: outputs.baseline.memory, candidate: outputs.candidate.memory, fixture: scratch }));

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { compile, exact, inventory, root, sha256, transform } from '../scripts/build.mjs';

const latestFile = path.join(root, '.build', 'latest.json');
const latest = fs.existsSync(latestFile) ? JSON.parse(fs.readFileSync(latestFile)) : undefined;
if (!process.argv[2] && !latest) throw Error('Pass an extracted distribution root or build a candidate first.');
const input = path.resolve(process.argv[2] ?? latest.output);
const scratch = fs.mkdtempSync(path.join(process.env.MCODE_TEST_TMP ?? os.tmpdir(), 'mcd-'));
const relocated = path.join(scratch, 'MCode relocated проба space');
fs.mkdirSync(relocated);
// Exercise actual archive extraction, then relocate it away from the build tree.
if (!process.argv[2]) {
  const r = spawnSync(process.platform === 'win32' ? 'tar.exe' : 'tar', [process.platform === 'win32' ? '-xf' : '-xzf', latest.archive, '-C', relocated], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
} else fs.cpSync(input, relocated, { recursive: true, dereference: false });
const cli = path.join(relocated, process.platform === 'win32' ? 'mcode.exe' : 'mcode');
const bun = path.join(relocated, 'runtime', process.platform === 'win32' ? 'bun.exe' : 'bun');
const data = path.join(scratch, 'data'), workspace = path.join(scratch, 'workspace');
fs.mkdirSync(data); fs.mkdirSync(workspace);
const osPath = process.platform === 'win32' ? `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0` : path.join(scratch, 'os-bin');
if (process.platform !== 'win32') {
  fs.mkdirSync(osPath);
  for (const command of ['bash', 'sh', 'uname', 'dirname', 'basename', 'date', 'mkdir', 'mv', 'sed', 'tr', 'cat', 'ps', 'sleep', 'env']) {
    const system = ['/usr/bin', '/bin'].map(p => path.join(p, command)).find(p => fs.existsSync(p));
    if (system) fs.symlinkSync(system, path.join(osPath, command));
  }
}
const environment = { ...process.env, PATH: osPath, MINIMAX_DATA_DIR: data, MCODE_CONFIG_DIR: data, MCODE_NO_MODIFY_PATH: '1', MCODE_TEST_TMP: scratch, MCODE_FIXTURE_ROOT: scratch };
for (const key of Object.keys(environment)) if (key.toLowerCase() === 'path' && key !== 'PATH') delete environment[key];
delete environment.BUN_BE_BUN; delete environment.MAVIS_SQLITE3_MODULE_PATH;
let passed = 0;
const check = async (name, fn) => { await fn(); console.log('PASS ' + name); passed++; };
const invoke = (exe, args, options = {}) => spawnSync(exe, args, { cwd: workspace, env: environment, encoding: 'utf8', timeout: 45000, maxBuffer: 2 * 1024 * 1024, ...options });
const good = (exe, args) => { const r = invoke(exe, args); assert.equal(r.status, 0, r.stderr || String(r.error)); return r.stdout.trim(); };
await check('relocated-version-help-invalid-option-without-system-runtime', () => {
  assert.equal(good(cli, ['--version']), '0.6.12');
  for (const args of [['--help'], ['exec', '--help'], ['app-server', '--help'], ['acp', '--help']]) assert.match(good(cli, args), /Usage:/);
  const invalid = invoke(cli, ['--not-a-distribution-option']); assert.notEqual(invalid.status, 0); assert.notEqual(invalid.status, null);
  assert.equal(good(bun, [path.join(relocated, 'package', 'mcode-tools.js'), '--version']), '0.0.6');
});
await check('payload-hashes-no-links-source-drift-refusal', () => {
  assert.equal(fs.readFileSync(cli).includes(Buffer.from(root)), false, 'compiled app must not embed its maintainer checkout path');
  const manifest = JSON.parse(fs.readFileSync(path.join(relocated, 'manifest.json')));
  for (const [name, expected] of Object.entries(manifest.files)) {
    const file = path.join(relocated, ...name.split('/'));
    assert.equal(fs.lstatSync(file).isSymbolicLink(), false);
    assert.equal(sha256(fs.readFileSync(file)), expected.sha256, name);
  }
  assert.throws(() => transform('chunks/chunk-47KWM23C.js', 'unknown source'), /Unsupported upstream|Unsupported pristine/);
  assert.throws(() => exact('source drift', 'missing anchor', 'replacement'), /Unsupported upstream/);
  const unknown = path.join(scratch, 'unknown-source'); fs.mkdirSync(unknown);
  fs.writeFileSync(path.join(unknown, 'cli.mjs'), 'const load=require;load(process.env.MANDATORY_DEPENDENCY)');
  assert.throws(() => inventory(unknown), /Unclassified executable graph/);
});
await check('incomplete-archive-fails-before-cli-routing', () => {
  const wasm = path.join(relocated, 'package', 'photon_rs_bg.wasm'), saved = wasm + '.saved';
  fs.renameSync(wasm, saved);
  try { const r = invoke(cli, ['--version']); assert.notEqual(r.status, 0); assert.match(r.stderr, /Incomplete or corrupt.*photon_rs_bg.wasm/); }
  finally { fs.renameSync(saved, wasm); }
});
await check('same-size-resource-corruption-fails-before-cli-routing', () => {
  const wasm = path.join(relocated, 'package', 'photon_rs_bg.wasm'), original = fs.readFileSync(wasm);
  const corrupt = Buffer.from(original); corrupt[0] ^= 255; fs.writeFileSync(wasm, corrupt);
  try { const r = invoke(cli, ['--version']); assert.notEqual(r.status, 0); assert.match(r.stderr, /Incomplete or corrupt.*photon_rs_bg.wasm/); }
  finally { fs.writeFileSync(wasm, original); }
});

// Compile the same transformed implementations with temporary private exports.
// Production archive bytes above are checked before any test instrumentation.
const extras = {
  'chunks/chunk-5ADYFF2U.js': 'export {uGt as toolsHost,X_t as optional,BUt as matrix,wGr as miniApp,l4e as seedTrash,hN as trashProbe};',
  'chunks/chunk-47KWM23C.js': 'export {bpe as windowsTrash};',
  'chunks/launcher-AVQRYDKB.js': 'export {k2 as image};',
  'chunks/chunk-VAVHH4XP.js': 'export {le as clipboard};',
};
for (const [name, extra] of Object.entries(extras)) fs.appendFileSync(path.join(relocated, 'package', name), '\n' + extra);
// Generate a tiny deterministic PNG, without external image tools.
function chunk(type, bytes) {
  const content = Buffer.concat([Buffer.from(type), bytes]); let crc = 0xffffffff;
  for (const byte of content) { crc ^= byte; for (let n = 0; n < 8; n++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4); length.writeUInt32BE(bytes.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, content, checksum]);
}
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(32); ihdr.writeUInt32BE(16, 4); ihdr[8] = 8; ihdr[9] = 2;
const rows = Buffer.alloc(16 * (1 + 32 * 3)); for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) rows[y * 97 + 1 + x * 3] = 255;
fs.writeFileSync(path.join(scratch, 'image.png'), Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]));
const fixtureEntry = path.join(relocated, '.fixture.mjs');
fs.writeFileSync(fixtureEntry, String.raw`
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import{spawnSync}from'node:child_process';import{pathToFileURL}from'node:url';
const root=path.dirname(process.execPath),dir=process.env.MCODE_FIXTURE_ROOT,entry=path.join(root,'package','cli.js'),privateBun=path.join(root,'runtime',process.platform==='win32'?'bun.exe':'bun');
process.argv.splice(1,1,entry);
try {
if(process.env.MCODE_CAPTURE_RESTART){fs.writeFileSync(path.join(dir,'restart.json'),JSON.stringify({argv:process.argv,execPath:process.execPath}));process.exit(0)}
const launcher=await import('./package/chunks/launcher-AVQRYDKB.js'),runtime=await import('./package/chunks/chunk-5ADYFF2U.js');
const{r:operations,s:shellTool}=await import('./package/chunks/chunk-ZPSMBMGA.js');const{clipboard}=await import('./package/chunks/chunk-VAVHH4XP.js');const{h:Updater}=await import('./package/chunks/chunk-X7FQ5SBJ.js');
const pass=async(name,fn)=>{await fn();console.log('PASS '+name)};
if(process.argv[2]==='parent-death'){
 const op=operations({parentDeathGuard:true});await op.exec(process.platform==='win32'?'Write-Output $PID; Start-Sleep 40':'printf "%s\\n" "$$"; exec sleep 40',dir,{onData:bytes=>{const pid=Number(bytes.toString().trim());if(pid>0)fs.writeFileSync(path.join(dir,'death-pid'),String(pid))}});process.exit(0);
}
await pass('compiled-physical-package-native-clipboard-lazy-optional',async()=>{
 const api=await clipboard();assert.equal(typeof api.hasImage,'function');assert.equal(typeof api.getImageBinary,'function');
 await assert.rejects(()=>runtime.optional({}),e=>/Cannot find (package|module)/.test(e.message)&&e.message.includes('@larksuiteoapi/node-sdk'));
 assert.equal(runtime.miniApp({}).execPath,privateBun);assert.throws(()=>runtime.matrix({workspaceDir:dir}),/entrypoint is unavailable/);
});
await pass('compiled-image-worker-and-wasm',async()=>{const output=await launcher.image(fs.readFileSync(path.join(dir,'image.png')),'image/png',16,new AbortController().signal);const png=Buffer.from(output,'base64');assert.equal(png.readUInt32BE(16),16);assert.equal(png.readUInt32BE(20),8)});
await pass('compiled-managed-shell-success-failure-timeout-cancellation',async()=>{
 const op=operations({parentDeathGuard:true}),tool=shellTool(dir,{operations:op});
 const result=await tool.execute('fixture',{command:process.platform==='win32'?"Write-Output 'guardian-ok'":'printf guardian-ok',timeout:5});assert.equal(result.details.execution.status,'succeeded');assert.match(result.content[0].text,/guardian-ok/);
 const failure=await op.exec(process.platform==='win32'?'cmd.exe /d /c exit 23':'exit 23',dir,{onData:()=>{}});assert.equal(failure.exitCode,23);
 await assert.rejects(()=>op.exec(process.platform==='win32'?'Start-Sleep 30':'exec sleep 30',dir,{timeout:.1,onData:()=>{}}),e=>e.details?.execution?.reason==='command_timeout');
 const controller=new AbortController();let pid;await assert.rejects(()=>op.exec(process.platform==='win32'?'Write-Output $PID; Start-Sleep 30':'printf "%s\\n" "$$"; exec sleep 30',dir,{signal:controller.signal,onData:bytes=>{const n=Number(bytes.toString().trim());if(n>0){pid=n;controller.abort('fixture')}}}),e=>e.details?.execution?.status==='canceled');assert.ok(pid);assert.throws(()=>process.kill(pid,0));
});
await pass('tools-broker-private-interpreter-and-cleanup',async()=>{
 let disposed=false;const env={...process.env},old={...env};const session={watch:()=>()=>{disposed=true},getStatus:async()=>({status:'unauthenticated',generation:0}),getAccessToken:async()=>{throw Error('No fixture credentials')},handleUnauthorized:async()=> 'stop'};
 const host=await runtime.toolsHost({requested:true,buildEnv:'prod',entryUrl:pathToFileURL(entry).href,dataDir:path.join(dir,'broker-data'),region:'en',session,environment:env});
 try{assert.equal(host.ready,true,host.category);assert.equal(host.version,'0.0.6');assert.equal(env.__MAVIS_MCODE_TOOLS_RUNTIME_EXECUTABLE,privateBun)}finally{await host.dispose()}assert.equal(disposed,true);assert.equal(env.PATH,old.PATH);
});
await pass('manual-updater-no-application-or-npm-mutation',async()=>{
 const updater=new Updater({currentVersion:'0.6.12'}),plan=await updater.inspect();assert.equal(plan.kind,'manual');assert.match(plan.command,/Guihal\/mcode-bun/);const result=await updater.apply({kind:'available',latestVersion:'99.0.0'});assert.equal(result.applied,false);assert.match(result.message,/installer/);assert.equal(fs.existsSync(path.join(root,'install.json')),false);
});
await pass('real-compiled-restart-arguments-and-pending-journal-isolation',async()=>{
 const args=['--append-system-prompt','text with spaces and "quotes" проба'];process.argv=[process.execPath,entry,...args];process.env.MCODE_CAPTURE_RESTART='1';
 fs.writeFileSync(path.join(root,'.mcode-update-pending.json'),'invalid upstream journal must not be opened');
 try{await launcher.restartTuiProcess('fixture-session','en','fixture prompt')}finally{delete process.env.MCODE_CAPTURE_RESTART;fs.unlinkSync(path.join(root,'.mcode-update-pending.json'))}
 const child=JSON.parse(fs.readFileSync(path.join(dir,'restart.json')));assert.equal(child.execPath,process.execPath);assert.deepEqual(child.argv.slice(2),[...args,'--session','fixture-session','fixture prompt']);
});
if(process.platform==='win32')await pass('windows-trash-probe-recycle-outside-protected-refusal',async()=>{
 const data=path.join(dir,'trash-data');runtime.seedTrash(data);assert.equal(runtime.trashProbe(data).available,true);
 const{windowsTrash}=await import('./package/chunks/chunk-47KWM23C.js');const target=path.join(dir,'recycle-me.txt');fs.writeFileSync(target,'fixture');
 const call=targets=>windowsTrash({runtime:{platform:'win32',scriptPath:path.join(data,'bin','mavis-trash.js'),readExecution:()=>({targets})},toolInput:{command:'mavis-trash --'},workspaceRoot:dir,timeoutSeconds:20});
 const ok=await call([target]);assert.equal(ok.isError,undefined,ok.text);assert.equal(fs.existsSync(target),false);
 const outside=path.join(root,'outside-sentinel');fs.writeFileSync(outside,'safe');assert.equal((await call([outside])).details.status,'windows_trash_target_rejected');assert.equal(fs.readFileSync(outside,'utf8'),'safe');
 assert.equal((await call([process.env.SystemRoot])).details.status,'windows_trash_target_rejected');
});
} catch(error) { fs.writeSync(2, String(error.stack ?? error)+'\n'); process.exit(1); }
`);
const contract = path.join(relocated, process.platform === 'win32' ? '.contract.exe' : '.contract');
compile(fixtureEntry, contract);
await check('compiled-runtime-boundaries', () => { const r = invoke(contract, []); process.stdout.write(r.stdout ?? ''); assert.equal(r.status, 0, r.stderr || String(r.error)); });
await check('parent-death-guardian-owned-child-cleanup', async () => {
  const child = spawn(contract, ['parent-death'], { cwd: workspace, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', bytes => stderr += bytes);
  const file = path.join(scratch, 'death-pid'), deadline = Date.now() + 15000;
  try {
    while (!fs.existsSync(file)) { if (Date.now() > deadline || child.exitCode !== null) throw Error('Guardian fixture failed: ' + stderr); await new Promise(r => setTimeout(r, 30)); }
    const pid = Number(fs.readFileSync(file, 'utf8')); child.kill('SIGKILL');
    while (true) {
      let alive = true; try { process.kill(pid, 0); if (process.platform === 'linux' && fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(' ')[2] === 'Z') alive = false; } catch { alive = false; }
      if (!alive) break;
      if (Date.now() > deadline) throw Error('Owned shell survived parent death: ' + pid);
      await new Promise(r => setTimeout(r, 30));
    }
  } finally { if (child.exitCode === null) child.kill('SIGKILL'); }
});

await check('real-daemon-bootstrap-status-restart-stop-manual-updater', async () => {
  const socket = path.join(scratch, 'daemon.sock');
  const args = action => ['app-server', 'daemon', action, '--data-dir', data, '--workspace', workspace, '--sock', socket];
  if (process.platform === 'win32') { const r = invoke(cli, args('bootstrap')); assert.notEqual(r.status, 0); assert.match(r.stderr, /Unix-like remote host/); return; }
  let pid;
  try {
    const first = JSON.parse(good(cli, args('bootstrap'))); assert.equal(first.state.status, 'ready'); assert.equal(first.updater.status, 'stopped'); pid = first.state.pid;
    assert.equal(fs.readlinkSync(`/proc/${pid}/exe`), cli); assert.match(fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'), /app-server/);
    const status = JSON.parse(good(cli, args('status'))); assert.equal(status.state.pid, pid); assert.equal(status.state.launcherPath, cli);
    const response = await new Promise((resolve, reject) => { const request = http.get({ socketPath: socket, path: '/healthz' }, r => { let body='';r.on('data',bytes=>body+=bytes);r.on('end',()=>resolve({status:r.statusCode,body})) });request.on('error',reject);request.setTimeout(10000,()=>request.destroy(Error('health timeout'))); });
    assert.equal(response.status, 200); assert.match(response.body, /0.6.12/);
    const restarted = JSON.parse(good(cli, args('restart'))); assert.equal(restarted.state.status, 'ready'); assert.notEqual(restarted.state.pid, pid); pid = restarted.state.pid;
    const stopped = JSON.parse(good(cli, args('stop'))); assert.equal(stopped.state.status, 'stopped'); assert.equal(stopped.updater.status, 'stopped');
    assert.equal(fs.existsSync(path.join(data, 'packages', 'app-server-daemon')), false);
    const updateLoop = invoke(cli, args('update-loop')); assert.notEqual(updateLoop.status, 0); assert.match(updateLoop.stderr, /Guihal\/mcode-bun/);
    assert.equal(fs.existsSync(path.join(relocated, 'install.json')), false);
  } finally {
    const r = invoke(cli, args('stop'));
    if (r.status !== 0) {
      // A failed state-schema probe must not leave its proven owned process.
      if (pid && fs.existsSync(`/proc/${pid}`) && fs.readlinkSync(`/proc/${pid}/exe`) === cli) {
        const argv = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
        if (argv.includes('app-server') && argv.includes(data)) process.kill(pid, 'SIGTERM');
      }
      throw Error('Owned daemon cleanup failed: '+r.stderr);
    }
  }
});
console.log(`Distribution: ${passed} passed, 0 failed; fixture: ${scratch}`);

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isBuiltin } from 'node:module';
import { spawnSync } from 'node:child_process';
import { repair } from './retry-repair.mjs';
import { repairSharedMcp } from './shared-mcp-repair.mjs';
import { repairMcpRegistry } from './mcp-registry-repair.mjs';
import { repairEditorMemory } from './editor-memory-repair.mjs';
import { repairHistoryMemory } from './history-memory-repair.mjs';
import { repairImageMemory } from './image-memory-repair.mjs';
import { repairStartupMemory } from './startup-memory-repair.mjs';
import { repairLazyTools } from './lazy-tools-repair.mjs';
import { repairLazyCapabilities } from './lazy-capabilities-repair.mjs';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
export const pin = metadata.mcode;
export const targetPlatform = process.argv.find(arg => arg.startsWith('--target='))?.slice(9).replace(/-x64$/, '') ?? process.platform;
export const windows = targetPlatform === 'win32';
export const executableName = windows ? 'mcode.exe' : 'mcode';
export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw Error(`${path.basename(command)} ${args.slice(0, 3).join(' ')}: ${result.error ?? result.stderr ?? result.stdout}`);
  return result.stdout;
}
export function exact(source, from, to, count = 1) {
  if (source.split(from).length - 1 !== count) throw Error(`Unsupported upstream anchor: ${from.slice(0, 100)}`);
  return source.replaceAll(from, to);
}
function replaceFunction(source, from, to, replacement) {
  const a = source.indexOf(from), b = source.indexOf(to, a);
  if (a < 0 || b < 0 || source.indexOf(from, a + 1) >= 0) throw Error(`Unsupported function boundary: ${from}`);
  return source.slice(0, a) + replacement + source.slice(b);
}
export function files(directory) {
  const result = [];
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isSymbolicLink()) throw Error(`Distribution contains a link: ${file}`);
    if (item.isDirectory()) result.push(...files(file));
    else if (item.isFile()) result.push(file);
    else throw Error(`Distribution contains a special file: ${file}`);
  }
  return result.sort();
}
const header = 'import { createRequire as __mavis_cR } from "module"; import { basename as __mavis_basename, dirname as __mavis_dirname, join as __mavis_join } from "path"; import { fileURLToPath as __mavis_fileURLToPath, pathToFileURL as __mavis_pathToFileURL } from "url"; const __mavis_tuiCurrentModuleDir = __mavis_dirname(__mavis_fileURLToPath(import.meta.url)); const __mavis_tuiPackageRoot = __mavis_basename(__mavis_tuiCurrentModuleDir) === "chunks" ? __mavis_dirname(__mavis_tuiCurrentModuleDir) : __mavis_tuiCurrentModuleDir; const __mavis_tuiPackageEntryUrl = __mavis_pathToFileURL(__mavis_join(__mavis_tuiPackageRoot, "cli.js")).href; const require = __mavis_cR(__mavis_tuiPackageEntryUrl); const __dirname = __mavis_tuiPackageRoot;';
const portableHeader = `import {createRequire as __mavis_cR} from 'node:module'; import {dirname as __mavis_dirname,basename as __mavis_basename,join as __mavis_join} from 'node:path'; import {fileURLToPath as __mavis_fileURLToPath,pathToFileURL as __mavis_pathToFileURL} from 'node:url'; const __mavis_tuiCurrentModuleDir=__mavis_dirname(__mavis_fileURLToPath(import.meta.url)); const __mavis_tuiPackageRoot=typeof __MCODE_COMPILED__!=='undefined'&&__MCODE_COMPILED__?__mavis_join(__mavis_dirname(process.execPath),'package'):(__mavis_basename(__mavis_tuiCurrentModuleDir)==='chunks'?__mavis_dirname(__mavis_tuiCurrentModuleDir):__mavis_tuiCurrentModuleDir); const __mavis_tuiPackageEntryUrl=__mavis_pathToFileURL(__mavis_join(__mavis_tuiPackageRoot,'cli.js')).href; const require=__mavis_cR(__mavis_tuiPackageEntryUrl); const __dirname=__mavis_tuiPackageRoot; const __mcodeRuntime=__mavis_join(__mavis_tuiPackageRoot,'..','runtime',process.platform==='win32'?'bun.exe':'bun'); const __mcodeInstallation=()=>require(__mavis_join(__mavis_tuiPackageRoot,'..','runtime','installation.cjs')).resolve(); const __mcodeManualUpdate='Update MCode Bun by rerunning its installer: https://github.com/Guihal/mcode-bun/releases/latest';`;

// This generated boundary projects an archive into the existing daemon manager.
// It never impersonates npm ownership or creates a second daemon/update service.
const licenseSources = [
  [
    "boringssl-LICENSE",
    "https://raw.githubusercontent.com/oven-sh/boringssl/41bf9b59c2ebf277a7aa427e1ecad5cc80dd4d4f/LICENSE",
    "827c8d8fc207c2392794eef9e00fe246f9f61fdcc132556c275be3dd8c3cd97f"
  ],
  [
    "brotli-LICENSE",
    "https://raw.githubusercontent.com/google/brotli/028fb5a23661f123017c060daa546b55cf4bde29/LICENSE",
    "3d180008e36922a4e8daec11c34c7af264fed5962d07924aea928c38e8663c94"
  ],
  [
    "cares-LICENSE.md",
    "https://raw.githubusercontent.com/c-ares/c-ares/c7a3138dcfe3bb0eaaf10c0c24c36dc66dc790ab/LICENSE.md",
    "460f5e768fda3752ca2169a95df062578a10fb126bfd65f3b9b1a1bed2f84807"
  ],
  [
    "hdrhistogram-LICENSE.txt",
    "https://raw.githubusercontent.com/HdrHistogram/HdrHistogram_c/18c7a324383dded1451d15621cd018b0048057d0/LICENSE.txt",
    "93a583ec58cd981232ec6fab797ff6f17f350c97b83ae0700b2d9350c91028af"
  ],
  [
    "highway-LICENSE",
    "https://raw.githubusercontent.com/google/highway/2607d3b5b0113992fe84d3848859eae13b3b52c1/LICENSE",
    "e340270d4f64384569a91d546acb5b094d69ce47f0c015db77abb74dc6f815af"
  ],
  [
    "libarchive-COPYING",
    "https://raw.githubusercontent.com/libarchive/libarchive/27cbc7827172698143e440801fc0ba39ccb4f1f5/COPYING",
    "30e556b3959e3985d66efefec5eaac51d4995053caa1d3cffe6eb916f146f229"
  ],
  [
    "libdeflate-COPYING",
    "https://raw.githubusercontent.com/ebiggers/libdeflate/92e6a0db9fa848d742f9eb286c92afc60f2c3dda/COPYING",
    "4ad69099cb4374836fd27583d9991e2838cd86b6e4666ab26b2d32582c91e73a"
  ],
  [
    "libjpeg-turbo-LICENSE.md",
    "https://raw.githubusercontent.com/libjpeg-turbo/libjpeg-turbo/c85e6b905bf237038faa936dab160ebfc5da0344/LICENSE.md",
    "ba6bceebcba0fdd35488477c2cca8c4632ce82c74dbfbc87d886ce6fc4433579"
  ],
  [
    "libspng-LICENSE",
    "https://raw.githubusercontent.com/randy408/libspng/fb768002d4288590083a476af628e51c3f1d47cd/LICENSE",
    "0622b0794d0fecde47d743f1bb70a03e6fdf082be8e71f39de672ed995d96ff9"
  ],
  [
    "libuv-LICENSE",
    "https://raw.githubusercontent.com/oven-sh/libuv/8023581113b276e7c1aee3f82da57ca0893faab1/LICENSE",
    "16de0c32b265cb7d46a6d3bd614f259dd4d693a5e26b3407b04aae8d73041f0c"
  ],
  [
    "lolhtml-LICENSE",
    "https://raw.githubusercontent.com/oven-sh/lol-html/725ce499aa9b71e38b7a2d0a9fbb6d7294a4079e/LICENSE",
    "e4ddaa9d7391bb9536fcb8c59b570a8b85a0bf6da54df5b3b26f098f6f99c9cc"
  ],
  [
    "lshpack-LICENSE",
    "https://raw.githubusercontent.com/litespeedtech/ls-hpack/cf0f70dd10b352194c97448eb5d00b4aa484f531/LICENSE",
    "0490f9666828ad1b6b5503102e7ebbe491451b7174511f3b6255caa967caf955"
  ],
  [
    "lsqpack-LICENSE",
    "https://raw.githubusercontent.com/litespeedtech/ls-qpack/91567706c41c0d97ab8dc576873ecd472d7869fa/LICENSE",
    "bf66df64b9819a4f2b7093332e35111f16a1c013180b2c30dd456f682a9c63fd"
  ],
  [
    "lsquic-LICENSE",
    "https://raw.githubusercontent.com/litespeedtech/lsquic/f812ceb9529e26717df78c6064a2ff648b949f3e/LICENSE",
    "9bc22643b3ea2b55c547c83e332253d04ba3df4f26696091e6fa9f7a1ccc65ef"
  ],
  [
    "lsquic-LICENSE.chrome",
    "https://raw.githubusercontent.com/litespeedtech/lsquic/f812ceb9529e26717df78c6064a2ff648b949f3e/LICENSE.chrome",
    "85d5dcb0d30ea89fa5922451957ff2a1a2c3c24f1ad2bb9ab23b5d6080763fc9"
  ],
  [
    "mimalloc-LICENSE",
    "https://raw.githubusercontent.com/oven-sh/mimalloc/92ef6587c57b262f6e6abf513f7776a2f8d12aeb/LICENSE",
    "82ade5d7d9b029044b5fbbc326207fc47c2d44ee4dd71e8a559c36d728217de9"
  ],
  [
    "tinycc-COPYING",
    "https://raw.githubusercontent.com/oven-sh/tinycc/05f0fafaa3be31e31d7b4b5c17dc60f62c991171/COPYING",
    "512d2d21b6b3384ba64781abb0208a1b87740bc31e2df48e2b206ddb7e4d5779"
  ],
  [
    "zlib-LICENSE.md",
    "https://raw.githubusercontent.com/zlib-ng/zlib-ng/12731092979c6d07f42da27da673a9f6c7b13586/LICENSE.md",
    "6c9f0d975b41afaa34d22f55bb8986ce69e5cb7ad327cb2b28820cd425edf5ee"
  ],
  [
    "zstd-LICENSE",
    "https://raw.githubusercontent.com/facebook/zstd/f8745da6ff1ad1e7bab384bd1f9d742439278e99/LICENSE",
    "7055266497633c9025b777c78eb7235af13922117480ed5c674677adc381c9d8"
  ],
  [
    "zstd-COPYING",
    "https://raw.githubusercontent.com/facebook/zstd/f8745da6ff1ad1e7bab384bd1f9d742439278e99/COPYING",
    "f9c375a1be4a41f7b70301dd83c91cb89e41567478859b77eef375a52d782505"
  ],
  [
    "Bun-LICENSE.md",
    "https://raw.githubusercontent.com/oven-sh/bun/c6da4a4d3010e5553438c60f6bd76d981976867c/LICENSE.md",
    "056696884250b0d682365260cf1487a6501b1665a343ec60e23a1e647043c572"
  ],
  [
    "MiniMax-Code-LICENSE",
    "https://raw.githubusercontent.com/MiniMax-AI/minimax-code/5821f7c9b0363a9b97a57fff3deaa4cd2da165a4/LICENSE",
    "28bb5c2948742f9f8d27ed84882844d09dff07cb5df64f20729875e8582a18ea"
  ],
  [
    "JavaScriptCore-LGPL",
    "https://raw.githubusercontent.com/oven-sh/WebKit/0c06faadf65bf8e8c8ad3a5a8aca83e1e9ed653f/Source/JavaScriptCore/COPYING.LIB",
    "5094ecb9c9dcd0eadc34f3c11511d9b5535063032bc150164ecd1a5d5a445547"
  ],
  [
    "Bun-uSockets-LICENSE",
    "https://raw.githubusercontent.com/oven-sh/bun/c6da4a4d3010e5553438c60f6bd76d981976867c/packages/bun-usockets/LICENSE",
    "c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4"
  ],
  [
    "Bun-uWebSockets-LICENSE",
    "https://raw.githubusercontent.com/oven-sh/bun/c6da4a4d3010e5553438c60f6bd76d981976867c/packages/bun-uws/LICENSE",
    "c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4"
  ],
  [
    "picohttpparser-header",
    "https://raw.githubusercontent.com/h2o/picohttpparser/f4d94b48b31e0abae029ebeafcfd9ca0680ede58/picohttpparser.h",
    "1fc9074dd12418b2b91e55ef3a8279bccf8d3577b790dea6f2f908ab2a157f1c"
  ],
  [
    "libwebp-COPYING",
    "https://raw.githubusercontent.com/webmproject/libwebp/v1.6.0/COPYING",
    "5aec868f669e384a22372a4e8a1a6cd7d44c64cd451f960ca69cc170d1e13acf"
  ],
  [
    "ripgrep-MIT",
    "https://raw.githubusercontent.com/BurntSushi/ripgrep/15.0.0/LICENSE-MIT",
    "0f96a83840e146e43c0ec96a22ec1f392e0680e6c1226e6f3ba87e0740af850f"
  ],
  [
    "ripgrep-UNLICENSE",
    "https://raw.githubusercontent.com/BurntSushi/ripgrep/15.0.0/UNLICENSE",
    "7e12e5df4bae12cb21581ba157ced20e1986a0508dd10d0e8a4ab9a4cf94e85c"
  ],
  [
    "ICU-LICENSE",
    "https://raw.githubusercontent.com/unicode-org/icu/release-78.1/LICENSE",
    "e55522d81edc687a341a4411e0776e54ca654e90147f354a90458aaced4116af"
  ],
  [
    "PCRE2-LICENCE",
    "https://raw.githubusercontent.com/PCRE2Project/pcre2/pcre2-10.45/LICENCE.md",
    "9cf7ac6976099a1d856826d3ef1b093bd6b84489dc6100628ac79e740cf9885a"
  ],
  [
    "libjpeg-turbo-README.ijg",
    "https://raw.githubusercontent.com/libjpeg-turbo/libjpeg-turbo/c85e6b905bf237038faa936dab160ebfc5da0344/README.ijg",
    "75815e3bf6484201a3c3d17a1bbf10f2e8e3237f84df10a2357ea896db2a81d6"
  ]
];
const installationSource = `const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function digest(file){
 const hash=crypto.createHash('sha256'),buffer=Buffer.allocUnsafe(65536),fd=fs.openSync(file,'r');
 try{let size;while((size=fs.readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,size));return hash.digest('hex')}finally{fs.closeSync(fd)}
}
function resolve(){
 const root=fs.realpathSync(path.join(__dirname,'..'));
 const fail=message=>{throw Error('Incomplete or corrupt MCode Bun archive: '+message+'; rerun the distribution installer.')};
 const inside=relative=>{
  if(typeof relative!=='string'||!relative||relative.includes('\\\\')||relative.split('/').some(p=>!p||p==='.'||p==='..')||path.isAbsolute(relative))return fail('invalid manifest path');
  const file=path.join(root,...relative.split('/'));
  let stat,real;try{stat=fs.lstatSync(file);real=fs.realpathSync(file)}catch{return fail(relative+' is missing')}
  if(!stat.isFile()||stat.isSymbolicLink()||path.relative(root,real)!==path.relative(root,file))return fail(relative+' is redirected');
  return file;
 };
 let manifest;try{manifest=JSON.parse(fs.readFileSync(inside('manifest.json'),'utf8'))}catch(error){return fail(error.message)}
 if(manifest.schemaVersion!==1||manifest.distribution!=='mcode-bun'||manifest.upstreamVersion!=='0.6.12'||manifest.bunVersion!=='1.4.3'||manifest.target!==process.platform+'-'+process.arch)return fail('unsupported identity or target');
 const packageFile=inside('package/package.json'),pkg=JSON.parse(fs.readFileSync(packageFile,'utf8'));
 if(pkg.name!=='@minimax-ai/code'||pkg.version!==manifest.upstreamVersion)return fail('package identity');
 for(const relative of manifest.required){const file=inside(relative),expected=manifest.files[relative];if(!expected||fs.statSync(file).size!==expected.size||digest(file)!==expected.sha256)return fail(relative+' has changed')}
 const launcherPath=inside(process.platform==='win32'?'mcode.exe':'mcode'),runtimeExecutable=inside('runtime/'+(process.platform==='win32'?'bun.exe':'bun')),entryFile=inside('package/cli.js');
 return {prefix:root,releasePrefix:root,releaseKey:manifest.release,launcherPath,entryFile,packageName:pkg.name,version:pkg.version,runtimeExecutable,distTag:'latest',manifest};
}
module.exports={resolve};
`;

export function transform(name, source, resources) {
  // The embedded tools manifest hashes the original CLI, including its shebang.
  // It is interpreted by the private Bun and must remain byte-for-byte intact.
  if (name.startsWith('embedded/')) return source;
  let s = source.replace(/^#![^\n]*\n/, '');
  if (name.endsWith('.js') && !name.startsWith('embedded/')) s = exact(s, header, portableHeader);
  if (name === 'chunks/chunk-KTNHM6NK.js') {
    // Bun otherwise injects the build host's absolute __filename for Undici's
    // diagnostic stack filtering. Keep that module identity archive-relative.
    s = exact(s, portableHeader, portableHeader + ` const __filename=__mavis_join(__mavis_tuiPackageRoot,'chunks','chunk-KTNHM6NK.js');`);
  }
  if (name === 'chunks/chunk-U5SHMJ7Y.js') {
    // Auxiliary calls can omit the application's payload transform entirely.
    s = exact(s, 'a.messages.create({...l,stream:!0},m)', 'a.messages.create({...l,stream:!0,service_tier:"priority"},m)');
  }
  if (name === 'chunks/chunk-GMLXHJYG.js') {
    s = repairImageMemory(source).replace(/^#![^\n]*\n/, '');
    s = exact(s, header, portableHeader);
  }
  if (name === 'chunks/chunk-47KWM23C.js') {
    // Retry repair must see the pristine request owner, before any other edit.
    s = repairHistoryMemory(repair(source)).replace(/^#![^\n]*\n/, '');
    s = exact(s, header, portableHeader);
    // Apply after configured payload patches and before the body-size guard.
    // This owner serves agent, checkpoint and auxiliary generation requests.
    s = exact(s, 'return knr(e.payload,e.maxRequestBodyBytes),t||n||r?e.payload:void 0', 'return e.payload.service_tier="priority",knr(e.payload,e.maxRequestBodyBytes),e.payload');
    s = exact(s, 'import C5 from"better-sqlite3"', 'import C5 from"../../runtime/sqlite.cjs"');
    s = exact(s, '("better-sqlite3")', '(__mavis_join(__mavis_tuiPackageRoot,"..","runtime","sqlite.cjs"))', 3);
    s = exact(s, 'auto:["pwsh","windows-powershell","git-bash"]', 'auto:["windows-powershell","pwsh","git-bash"]');
    s = exact(s, 'launcher:process.execPath,argv:[t.scriptPath', 'launcher:__mcodeRuntime,argv:[t.scriptPath');
  }
  if (name === 'chunks/chunk-5ADYFF2U.js') {
    s = repairSharedMcp(s);
    s = repairMcpRegistry(s);
    // Token counting builds a separate body, including its prepared-payload path.
    s = exact(s, 'unsupportedCacheKey:`messages:${i}`,body:s,headers:', 'unsupportedCacheKey:`messages:${i}`,body:{...s,service_tier:"priority"},headers:');
    s = exact(s, '("better-sqlite3")', '(__mavis_join(__mavis_tuiPackageRoot,"..","runtime","sqlite.cjs"))', 2);
    s = exact(s, 'import("@larksuiteoapi/node-sdk")', 'import(import.meta.resolve("@larksuiteoapi/node-sdk",__mavis_tuiPackageEntryUrl))', 2);
    for (const [from, to] of [
      ['function nIr(t=process.execPath)', 'function nIr(t=__mcodeRuntime)'],
      ['function sIr(t=process.execPath)', 'function sIr(t=__mcodeRuntime)'],
      ['execPath:process.execPath,runnerPath:', 'execPath:__mcodeRuntime,runnerPath:'],
      ['type:"stdio",command:process.execPath,args:[s]', 'type:"stdio",command:__mcodeRuntime,args:[s]'],
      ['{runtimeExecutable:process.execPath,brokerEndpoint:', '{runtimeExecutable:__mcodeRuntime,brokerEndpoint:'],
    ]) s = exact(s, from, to);
  }
  if (name === 'chunks/chunk-ZPSMBMGA.js') {
    s = exact(s, 'function Z8(){try{', 'function Z8(){const builtin=gk.win32.join(process.env.SystemRoot??process.env.windir??"C:\\\\Windows","System32","WindowsPowerShell","v1.0","powershell.exe");if(zi(builtin))return{shell:builtin,args:Gu,type:"powershell"};try{');
    s = exact(s, 'Ek(process.execPath,["--input-type=module","--eval",ej', 'Ek(__mcodeRuntime,["--input-type=module","--eval",ej');
    s = exact(s, 'Vu(process.execPath,["--input-type=module","--eval",hj', 'Vu(__mcodeRuntime,["--input-type=module","--eval",hj');
  }
  if (name === 'chunks/launcher-AVQRYDKB.js') {
    s = repairEditorMemory(source).replace(/^#![^\n]*\n/, '');
    s = exact(s, header, portableHeader);
    s = exact(s, 'let s=aK(n),r=e.slice(s?2:1)', 'let s=aK(n),compiled=!s&&e[1]===__mavis_join(__mavis_tuiPackageRoot,"cli.js"),r=e.slice(s||compiled?2:1)');
  }
  if (name === 'chunks/chunk-DCFP5ZHZ.js') {
    s = replaceFunction(s, 'async function me(', 'function ve(', 'async function me(){return!1}');
  }
  if (name === 'chunks/chunk-X7FQ5SBJ.js') {
    s = replaceFunction(s, 'async inspect(t={}){', 'async apply(t,r={}){', 'async inspect(){return{kind:"manual",source:"unsupported",currentVersion:this.currentVersion,command:__mcodeManualUpdate}}');
    s = replaceFunction(s, 'async apply(t,r={}){', 'async applyNpmPrefixUpdate(', 'async apply(){return{applied:!1,message:__mcodeManualUpdate}}');
    s = replaceFunction(s, 'async applyNpmPrefixUpdate(', '};function gt(', 'async applyNpmPrefixUpdate(){throw Error(__mcodeManualUpdate)}');
  }
  if (name === 'chunks/run-app-server-command-DEX4FRZJ.js') {
    s = exact(s, 'async function Hs(t,e,r={}){', 'async function Hs(t,e,r={}){if(t.mode==="daemon"&&t.daemonAction==="update-loop")throw Error(__mcodeManualUpdate);r={resolveOfficialInstallation:()=>__mcodeInstallation(),prepareServerInstallation:async(d,i,p)=>{if(p==="win32")throw Error("The app-server daemon requires a Unix-like remote host.");return __mcodeInstallation()},resolveServerInstallation:()=>__mcodeInstallation(),managedUpdaterEnabled:!1,...r};');
  }
  return repairLazyCapabilities(name, repairLazyTools(name, repairStartupMemory(name, s), resources), resources);
}

export function compile(entry, output, options = {}) {
  const extra = options.target ? [`--target=${options.target}`, `--compile-executable-path=${options.executablePath}`] : [];
  if (options.bytecodeOrder) extra.push(`--bytecode-order=${options.bytecodeOrder}`);
  console.log(run(process.execPath, ['build', entry, '--compile', '--bytecode', '--format=esm', '--define', '__MCODE_COMPILED__=true', ...extra, '--outfile', output]).trim());
}

async function windowsRuntime(directory, output) {
  const archive = path.join(directory, 'bun-windows.zip');
  const response = await fetch(`https://github.com/oven-sh/bun/releases/download/bun-v${pin.bunVersion}/bun-windows-x64-baseline.zip`);
  if (!response.ok) throw Error(`Windows Bun download: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== 'd7a7d3eb216614544aab0cde2d8d9f2e4e87839bf5a30a1cd11d077f02d84e0c') throw Error('Windows Bun digest mismatch');
  fs.writeFileSync(archive, bytes);
  const member = 'bun-windows-x64-baseline/bun.exe';
  if (process.platform === 'win32') {
    const script = path.join(directory, 'extract-bun.ps1');
    fs.writeFileSync(script, 'param($Archive,$Member,$Target)\n$ErrorActionPreference="Stop"\nAdd-Type -AssemblyName System.IO.Compression.FileSystem\n$zip=[IO.Compression.ZipFile]::OpenRead($Archive)\ntry{$entry=$zip.GetEntry($Member);if(-not $entry){throw "Missing pinned Bun executable"};[IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$Target)}finally{$zip.Dispose()}\n');
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Archive', archive, '-Member', member, '-Target', output]);
  } else run('python3', ['-c', 'import zipfile,sys,pathlib\nwith zipfile.ZipFile(sys.argv[1]) as z: pathlib.Path(sys.argv[3]).write_bytes(z.read(sys.argv[2]))', archive, member, output]);
  return output;
}

async function acquire(directory) {
  const archive = path.join(directory, 'upstream.tgz');
  const response = await fetch(pin.upstreamUrl);
  if (!response.ok) throw Error(`Upstream download: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== pin.upstreamSha256) throw Error('Upstream digest mismatch');
  fs.writeFileSync(archive, bytes);
  run('tar', ['-xzf', archive, '-C', directory]);
  return path.join(directory, 'package');
}

// All shipped executable source is pinned by the verified tarball. Syntax-aware
// import discovery includes embedded workers; optional skill toolchains are data.
export function inventory(pkg) {
  const scanner = new Bun.Transpiler({ loader: 'js', target: 'bun' });
  const executableFiles = files(pkg).filter(file => /\.(?:[cm]?js)$/.test(file) && !path.relative(pkg, file).split(path.sep).includes('assets'));
  // This is an exact-version audit, not a general JavaScript sandbox. Pin the
  // complete executable graph, including computed/aliased loaders and embedded
  // script templates. A new file or a change outside scanImports (for example
  // const load=require;load(variable)) must reopen the audit, never pass empty
  // import discovery. The npm tarball hash independently authenticates acquisition.
  const graph = executableFiles.map(file => [path.relative(pkg, file).replaceAll(path.sep, '/'), sha256(fs.readFileSync(file))]);
  const graphHash = sha256(JSON.stringify(graph));
  if (graph.length !== 98 || graphHash !== '2520a62f1acb553e4c581aa633a357f2513ccc4538a4124bf2922f8136892d02') throw Error('Unclassified executable graph: aliased/computed runtime boundaries require review');
  const imports = [], boundaries = [], nativeBindings = [];
  const owners = {
    'chunks/chunk-334CV6RF.js': 'upstream npm metadata fallback; archive projection bypasses npm layout',
    'chunks/chunk-47KWM23C.js': 'provider SDK builtins; configured tool/shell commands; private-Bun Windows trash; clipboard physical loader',
    'chunks/chunk-5ADYFF2U.js': 'Git operations and optional SDK/IDE/browser/sandbox/plugin commands; bundled ripgrep; private-Bun tools/trash/child runners',
    'chunks/chunk-DCFP5ZHZ.js': 'upstream activation template; disabled archive activation owner',
    'chunks/chunk-GMLXHJYG.js': 'physical image worker/WASM, with executable/cwd fallback lookup',
    'chunks/chunk-X7FQ5SBJ.js': 'upstream installer functions; archive inspect/apply refuses upstream updates',
    'chunks/chunk-ZPSMBMGA.js': 'OS shells, taskkill and optional terminal probes; private-Bun guardian/eval; physical ripgrep',
    'chunks/launcher-AVQRYDKB.js': 'compiled application restart; physical native console/worker; configured editor/hook/notification commands',
    'chunks/run-app-server-command-DEX4FRZJ.js': 'existing daemon manager with archive launcher projection; updater loop refused',
    'chunks/chunk-25R53L7J.js': 'bundled Commander loader and external-subcommand capability',
    'chunks/chunk-AMLNR7IO.js': 'optional Google executable authentication and OS credential facilities',
    'chunks/chunk-HQ2U4QVQ.js': 'bundled cross-spawn command adapter',
    'chunks/chunk-I2T4QMR7.js': 'bundled logging/thread-stream worker support',
    'chunks/chunk-I7MLO7YD.js': 'OS process inspection',
    'chunks/chunk-QXUSWEWV.js': 'OS URL/file opener',
    'chunks/chunk-VAVHH4XP.js': 'bundled clipboard native loader and OS clipboard fallbacks',
    'chunks/chunk-X3PES5WL.js': 'optional Git metadata',
    'embedded/mcode-tools/cli.mjs': 'integrity-preserved broker CLI; bundled SDK builtins and optional OS proxy lookup',
    'image-preview-worker.js': 'physical worker using private Bun worker_threads',
  };
  for (const file of executableFiles) {
    const name = path.relative(pkg, file).replaceAll(path.sep, '/');
    if (!/\.(?:[cm]?js)$/.test(name) || name.startsWith('assets/')) continue;
    const source = fs.readFileSync(file, 'utf8').replace(/^#![^\n]*\n/, '');
    for (const ref of scanner.scanImports(source)) {
      if (isBuiltin(ref.path) || ref.path.startsWith('bun:')) continue;
      if (ref.path.startsWith('.')) {
        if (!fs.existsSync(path.resolve(path.dirname(file), ref.path))) throw Error(`Unresolved relative import ${name}: ${ref.path}`);
      } else if (!['better-sqlite3', '@mariozechner/clipboard', '@larksuiteoapi/node-sdk'].includes(ref.path)) throw Error(`Unclassified import ${name}: ${ref.path}`);
      imports.push({ file: name, ...ref });
    }
    // Follow the pinned minified native-import aliases as well as spelled-out
    // calls. The graph pin covers generated script bodies and bundled CommonJS
    // require aliases, whose owners are recorded above rather than guessed from
    // the spelling of an individual call.
    for (const match of source.matchAll(/import\{([^}]+)\}from["'](?:node:)?(child_process|worker_threads)["']/g)) {
      const owner = owners[name];
      if (!owner) throw Error(`Unclassified native runtime owner: ${name}`);
      for (const binding of match[1].split(',')) {
        const parts = binding.trim().split(/\s+as\s+/);
        nativeBindings.push({ file: name, module: match[2], imported: parts[0], local: parts.at(-1), owner });
      }
    }
    // Exact pinned bytes prohibit new hidden/dynamic relations. Keep every
    // process/resource boundary in the build report for review and drift checks.
    const pattern = /(?:process\.(?:execPath|argv)|\b(?:spawn|fork|Worker|execFile|createRequire|require|import)\s*\(|--eval|--input-type|\.node["']|\.wasm["']|__mavis_tuiPackageEntryUrl)/g;
    for (const match of source.matchAll(pattern)) boundaries.push({ file: name, offset: match.index, token: match[0], owner: owners[name] ?? 'pinned module loader/CLI arguments or bundled SDK builtin; package entry resolves from physical archive' });
  }
  return { graphHash, imports, boundaries, nativeBindings };
}

async function copyLicenses(output) {
  const destination = path.join(output, 'licenses');
  fs.mkdirSync(destination);
  for (let i = 0; i < licenseSources.length; i += 4) {
    await Promise.all(licenseSources.slice(i, i + 4).map(async ([name, url, digest]) => {
      const response = await fetch(url);
      if (!response.ok) throw Error(`License download ${name}: HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (sha256(bytes) !== digest) throw Error(`License source drift: ${name}`);
      fs.writeFileSync(path.join(destination, name), bytes);
    }));
  }
  for (const file of files(path.join(output, 'package'))) {
    if (/(?:LICENSE|LICENCE|COPYING|NOTICE)(?:[.\-_]|$)/i.test(path.basename(file))) {
      const name = path.relative(path.join(output, 'package'), file).replaceAll(path.sep, '--');
      fs.copyFileSync(file, path.join(destination, name));
    }
  }
  // Clipboard's npm archives declare MIT in package.json but omit a license
  // file. Retain that declaration and supplement it with the standard MIT text.
  fs.copyFileSync(path.join(output, 'package', 'node_modules', '@mariozechner', 'clipboard', 'package.json'), path.join(destination, 'clipboard-package.json'));
  const mit = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8').replace(/^Copyright .*\n/m, '');
  fs.writeFileSync(path.join(destination, 'clipboard-MIT.txt'), 'The distributed @mariozechner/clipboard package declares MIT in its package.json.\nNo separate copyright/license notice was supplied in its npm archive.\n\n' + mit);
  fs.writeFileSync(path.join(destination, 'sources.json'), JSON.stringify(licenseSources.map(([file, url, sha256]) => ({ file, url, sha256 })), null, 2));
}

export async function build() {
  if (Bun.version !== pin.bunVersion || pin.upstreamVersion !== '0.6.12' || process.arch !== 'x64' || !['linux', 'win32'].includes(process.platform) || !['linux', 'win32'].includes(targetPlatform) || (targetPlatform !== process.platform && !windows)) throw Error('Build requires pinned Bun 1.4.3 on Windows/Linux x64; supported cross-target: win32-x64');
  const directory = path.join(root, '.build', crypto.randomUUID());
  fs.mkdirSync(directory, { recursive: true });
  const pkg = await acquire(directory);
  const identity = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json')));
  if (identity.name !== '@minimax-ai/code' || identity.version !== pin.upstreamVersion) throw Error('Upstream package identity mismatch');
  const discovery = inventory(pkg);
  fs.writeFileSync(path.join(directory, 'inventory.json'), JSON.stringify(discovery, null, 2));
  const release = `mcode-${metadata.version}-${targetPlatform}-${process.arch}`;
  const output = path.join(directory, release);
  fs.mkdirSync(path.join(output, 'runtime'), { recursive: true });
  fs.cpSync(pkg, path.join(output, 'package'), { recursive: true, dereference: false });
  const localToolResources = {};
  for (const file of files(path.join(output, 'package'))) {
    const name = path.relative(path.join(output, 'package'), file).replaceAll(path.sep, '/');
    if (/\.(?:[cm]?js)$/.test(name) && !name.startsWith('assets/') && name !== 'verify-native-install.mjs') fs.writeFileSync(file, transform(name, fs.readFileSync(file, 'utf8'), localToolResources));
  }
  for (const [name, source] of Object.entries(localToolResources)) {
    const file = path.join(output, 'package', name);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, source);
  }
  fs.copyFileSync(path.join(root, 'runtime', 'lazy-tool.mjs'), path.join(output, 'runtime', 'lazy-tool.mjs'));
  fs.copyFileSync(path.join(root, 'runtime', 'image-resize-worker.mjs'), path.join(output, 'package', 'image-resize-worker.js'));
  let dependencyRoot = root;
  if (targetPlatform !== process.platform) {
    dependencyRoot = path.join(directory, 'dependencies'); fs.mkdirSync(dependencyRoot);
    for (const name of ['package.json', 'bun.lock']) fs.copyFileSync(path.join(root, name), path.join(dependencyRoot, name));
    console.log(run(process.execPath, ['install', '--cwd', dependencyRoot, '--frozen-lockfile', '--ignore-scripts', '--os=win32', '--cpu=x64']).trim());
  }
  fs.cpSync(path.join(dependencyRoot, 'node_modules'), path.join(output, 'package', 'node_modules'), { recursive: true, dereference: true });
  // Every dependency must have an exact locked identity; no optional SQLite or
  // lifecycle installer is part of the consumer dependency graph.
  const modules = path.join(output, 'package', 'node_modules');
  const clipboardName = `@mariozechner/clipboard-${windows ? 'win32-x64-msvc' : 'linux-x64-gnu'}`;
  const ripgrepName = `@vscode/ripgrep-${targetPlatform}-x64`;
  for (const [name, version] of [['@mariozechner/clipboard', '0.3.9'], [clipboardName, '0.3.9'], ['@vscode/ripgrep', '1.18.0'], [ripgrepName, '1.18.0']]) {
    const p = JSON.parse(fs.readFileSync(path.join(modules, name, 'package.json')));
    if (p.name !== name || p.version !== version) throw Error(`Dependency identity mismatch: ${name}`);
  }
  const privateRuntime = path.join(output, 'runtime', windows ? 'bun.exe' : 'bun');
  if (windows) await windowsRuntime(directory, privateRuntime);
  else fs.copyFileSync(process.execPath, privateRuntime);
  const compileOptions = windows ? { target: 'bun-windows-x64-baseline', executablePath: privateRuntime } : {};
  fs.copyFileSync(path.join(root, 'runtime', 'sqlite.cjs'), path.join(output, 'runtime', 'sqlite.cjs'));
  fs.copyFileSync(path.join(root, 'runtime', 'shared-mcp.cjs'), path.join(output, 'runtime', 'shared-mcp.cjs'));
  fs.writeFileSync(path.join(output, 'runtime', 'installation.cjs'), installationSource);
  const bootstrap = path.join(directory, 'bootstrap.mjs');
  fs.writeFileSync(bootstrap, `import path from 'node:path'; import {createRequire} from 'node:module';const root=path.dirname(process.execPath);createRequire(path.join(root,'package','cli.js'))(path.join(root,'runtime','installation.cjs')).resolve();process.argv.splice(1,1,path.join(root,'package','cli.js'));await import('./${release}/package/cli.js');`);
  compile(bootstrap, path.join(output, executableName), compileOptions);
  if (windows) {
    const shimEntry = path.join(directory, 'command-shim.mjs');
    fs.writeFileSync(shimEntry, `import fs from 'node:fs';import path from 'node:path';import{createRequire}from'node:module';import{spawnSync}from'node:child_process';
const bin=path.dirname(process.execPath),root=path.dirname(bin);
try{
 if(fs.readFileSync(path.join(root,'.mcode-bun-owner'),'utf8').trim()!=='Guihal/mcode-bun;schema=1')throw Error('Invalid command-shim owner');
 const key=fs.readFileSync(path.join(root,'current'),'utf8').trim();if(!/^0\\.6\\.12-bun\\.[0-9]+-[0-9a-f]{16}$/.test(key))throw Error('Invalid MCode Bun selection');
 const payload=path.join(root,'releases',key);if(fs.lstatSync(payload).isSymbolicLink()||fs.realpathSync(payload)!==payload)throw Error('Redirected MCode Bun payload');
 const installation=createRequire(path.join(payload,'package','cli.js'))(path.join(payload,'runtime','installation.cjs')).resolve();
 const tools=path.basename(process.execPath).toLowerCase()==='mcode-tools.exe';const command=tools?installation.runtimeExecutable:installation.launcherPath;const args=tools?[path.join(payload,'package','mcode-tools.js'),...process.argv.slice(2)]:process.argv.slice(2);
 const result=spawnSync(command,args,{stdio:'inherit',windowsHide:false});if(result.error)throw result.error;process.exit(result.status??1);
}catch(error){console.error('MCode Bun: '+error.message+'; rerun the installer.');process.exit(127)}
`);
    compile(shimEntry, path.join(output, 'runtime', 'command-shim.exe'), compileOptions);
    fs.writeFileSync(path.join(output, 'mcode-tools.cmd'), '@echo off\r\n"%~dp0runtime\\bun.exe" "%~dp0package\\mcode-tools.js" %*\r\nexit /b %errorlevel%\r\n');
  } else fs.writeFileSync(path.join(output, 'mcode-tools'), '#!/bin/sh\nset -eu\nroot=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)\nexec "$root/runtime/bun" "$root/package/mcode-tools.js" "$@"\n', { mode: 0o755 });
  for (const name of ['README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'install.ps1']) fs.copyFileSync(path.join(root, name), path.join(output, name));
  await copyLicenses(output);
  const manifest = { schemaVersion: 1, distribution: 'mcode-bun', release: metadata.version, upstreamVersion: pin.upstreamVersion, bunVersion: pin.bunVersion, target: `${targetPlatform}-${process.arch}`, files: {}, required: [executableName, `runtime/${windows ? 'bun.exe' : 'bun'}`, 'runtime/sqlite.cjs', 'runtime/shared-mcp.cjs', 'package/cli.js', 'package/package.json', 'package/image-preview-worker.js', 'package/image-resize-worker.js', 'package/photon_rs_bg.wasm', 'package/embedded/mcode-tools/cli.mjs'] };
  manifest.required.push('runtime/lazy-tool.mjs', ...Object.keys(localToolResources).map(name => 'package/' + name));
  for (const file of files(output)) manifest.files[path.relative(output, file).replaceAll(path.sep, '/')] = { size: fs.statSync(file).size, sha256: sha256(fs.readFileSync(file)) };
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
  if (targetPlatform === 'linux' && targetPlatform === process.platform) {
    // Train on owned startup and useful work, never on a personal session/profile.
    // Keep cross-target/Windows builds on the existing full-depth layout.
    const startupOrder = path.join(directory, 'startup.order');
    run(path.join(output, executableName), ['--help'], { env: { ...process.env, BUN_BYTECODE_ORDER_OUT: startupOrder } });
    const profile = run(process.execPath, [path.join(root, 'tests', 'native-retry.mjs'), path.join(output, executableName), 'recover'], {
      env: { ...process.env, MCODE_TEST_TMP: directory, BUN_BYTECODE_ORDER_OUT: path.join(directory, 'useful-%p.order') },
    });
    const pid = JSON.parse(profile).memory.phases[0]?.pid;
    if (!Number.isInteger(pid) || pid <= 0) throw Error('Useful-work bytecode profile has no CLI process identity');
    const usefulOrder = path.join(directory, `useful-${pid}.order`);
    for (const file of [startupOrder, usefulOrder]) if (!fs.statSync(file).isFile() || !fs.statSync(file).size) throw Error('Missing bytecode profile: ' + file);
    compile(bootstrap, path.join(output, executableName), { ...compileOptions, bytecodeOrder: [usefulOrder, startupOrder].join(',') });
    const executable = path.join(output, executableName);
    manifest.files[executableName] = { size: fs.statSync(executable).size, sha256: sha256(fs.readFileSync(executable)) };
    fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
  }
  if (targetPlatform === process.platform) run(path.join(output, executableName), ['--version']);
  if (windows) for (const relative of [executableName, 'runtime/bun.exe', 'runtime/command-shim.exe', `package/node_modules/${clipboardName}/clipboard.win32-x64-msvc.node`, `package/node_modules/${ripgrepName}/bin/rg.exe`]) {
    const bytes = fs.readFileSync(path.join(output, relative)), pe = bytes.readUInt32LE(0x3c);
    if (bytes.readUInt16LE(0) !== 0x5a4d || pe + 6 > bytes.length || bytes.readUInt32LE(pe) !== 0x4550 || bytes.readUInt16LE(pe + 4) !== 0x8664) throw Error(`Expected Windows x64 PE: ${relative}`);
  }
  const dist = path.join(root, 'dist'); fs.mkdirSync(dist, { recursive: true });
  const archive = path.join(dist, `${release}.${windows ? 'zip' : 'tar.gz'}`);
  if (windows && process.platform === 'win32') {
    const script = path.join(directory, 'archive.ps1');
    fs.writeFileSync(script, 'param([string]$Source,[string]$Target)\n$ErrorActionPreference="Stop"\nAdd-Type -AssemblyName System.IO.Compression.FileSystem\n[System.IO.Compression.ZipFile]::CreateFromDirectory($Source,$Target)\n');
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Source', output, '-Target', archive]);
  }
  else if (windows) run('python3', ['-c', 'import zipfile,pathlib,sys\nroot=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED,compresslevel=6) as z:\n for file in sorted(root.rglob("*")):\n  if file.is_file(): z.write(file,file.relative_to(root).as_posix())', output, archive]);
  else run('tar', ['-czf', archive, '-C', output, '.']);
  fs.writeFileSync(archive + '.sha256', `${sha256(fs.readFileSync(archive))}  ${path.basename(archive)}\n`);
  fs.writeFileSync(path.join(root, '.build', 'latest.json'), JSON.stringify({ output, archive, discovery: path.join(directory, 'inventory.json') }));
  console.log(`Built ${archive}\nExtracted candidate: ${output}`);
  return { output, archive };
}
if (import.meta.main) await build();

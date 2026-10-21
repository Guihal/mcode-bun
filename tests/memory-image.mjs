import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { repairImageMemory } from '../scripts/image-memory-repair.mjs';

if (process.argv[2] === '--measure') {
  const module = await import(pathToFileURL(process.argv[3]).href);
  const bytes = fs.readFileSync(process.argv[4]);
  Bun.gc(true);
  const before = process.memoryUsage(), started = performance.now();
  console.log(JSON.stringify({ phase: 'before', memory: before }));
  await Promise.all(Array.from({ length: 4 }, async (_, i) => {
    const result = await module.b(bytes, 'image/png', { maxWidth: 800, maxHeight: 800, maxBytes: 250000 });
    assert.ok(result?.wasResized);
    assert.ok(result.width <= 800 && result.height <= 800);
    console.log(JSON.stringify({ phase: 'resize', iteration: i, memory: process.memoryUsage() }));
  }));
  Bun.gc(true);
  await new Promise(resolve => setTimeout(resolve, 100));
  console.log(JSON.stringify({ phase: 'idle', memory: process.memoryUsage(), elapsedMs: performance.now() - started, runtimeLoaded: module.imageFixtureRuntime() }));
  process.exit(0);
}

const pristine = path.resolve(process.argv[2] ?? ''), candidate = path.resolve(process.argv[3] ?? '');
if (!process.argv[2] || !process.argv[3]) throw Error('Usage: bun tests/memory-image.mjs <pristine-package> <candidate-package>');
const scratch = fs.mkdtempSync(path.join(process.env.MCODE_TEST_TMP ?? os.tmpdir(), 'mcode-image-'));
const name = 'chunks/chunk-GMLXHJYG.js';
const original = fs.readFileSync(path.join(pristine, name), 'utf8');
const repaired = repairImageMemory(original);
assert.throws(() => repairImageMemory(original + '\n'), /Unsupported pristine/);
assert.throws(() => repairImageMemory(repaired), /Unsupported pristine/);

function fixture(sourceRoot, label, source, worker = true) {
  const pkg = path.join(scratch, label);
  fs.mkdirSync(path.join(pkg, 'chunks'), { recursive: true });
  for (const file of ['package.json', 'cli.js', 'photon_rs_bg.wasm', 'chunks/photon_rs-G4OEF2QT.js', 'chunks/chunk-D76SO2ME.js']) fs.copyFileSync(path.join(sourceRoot, file), path.join(pkg, file));
  // Private fixture exports never enter production package bytes.
  fs.writeFileSync(path.join(pkg, name), source + '\nexport {D as imageFixtureMain};export const imageFixturePhoton=value=>{I=value;k=null};export const imageFixtureRuntime=()=>I!==null||k!==null;');
  if (worker) fs.copyFileSync(path.join(candidate, 'image-resize-worker.js'), path.join(pkg, 'image-resize-worker.js'));
  return pkg;
}
const beforePkg = fixture(pristine, 'before', original, false);
const afterPkg = fixture(candidate, 'after', fs.readFileSync(path.join(candidate, name), 'utf8'));
const before = await import(pathToFileURL(path.join(beforePkg, name)).href);
const after = await import(pathToFileURL(path.join(afterPkg, name)).href);
let passed = 0;
async function check(label, fn) { await fn(); console.log('PASS ' + label); passed++; }
function comparable(result) { return result && { ...result, data: createHash('sha256').update(result.data).digest('hex') }; }
function equalImage(actual, expected, message) { assert.deepEqual(comparable(actual), comparable(expected), message); }

function pngChunk(type, bytes) {
  const content = Buffer.concat([Buffer.from(type), bytes]); let crc = 0xffffffff;
  for (const byte of content) { crc ^= byte; for (let n = 0; n < 8; n++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4); length.writeUInt32BE(bytes.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, content, checksum]);
}
function png(width, height, noise = false) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const stride = 1 + width * 4, rows = Buffer.alloc(stride * height); let random = 0x87654321;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
    const offset = y * stride + 1 + x * 4;
    rows[offset] = noise ? random & 255 : 210; rows[offset + 1] = noise ? random >>> 8 & 255 : 35;
    rows[offset + 2] = noise ? random >>> 16 & 255 : 120; rows[offset + 3] = 255;
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(rows)), pngChunk('IEND', Buffer.alloc(0))]);
}
const solid = png(96, 64), noisy = png(96, 64, true);
await check('real-Photon-selection-bytes-MIME-dimensions-and-null-parity', async () => {
  for (const bytes of [solid, noisy]) for (const options of [undefined, { maxWidth: 48, maxHeight: 40 }, { maxWidth: 48, maxBytes: 4000 }, { maxBytes: 1600 }, { maxBytes: 500 }, { maxBytes: 1 }]) {
    equalImage(await after.imageFixtureMain(bytes, 'image/png', options), await before.imageFixtureMain(bytes, 'image/png', options));
  }
  for (const bytes of [new Uint8Array(), Buffer.from('invalid image')]) assert.equal(await after.imageFixtureMain(bytes, 'image/png'), null);
  const passthrough = await after.imageFixtureMain(solid, 'image/png');
  assert.deepEqual(Buffer.from(passthrough.data, 'base64'), solid); assert.equal(passthrough.wasResized, false);
});

await check('all-eight-EXIF-orientations-preserve-original-selection', async () => {
  const photon = (await import(pathToFileURL(path.join(beforePkg, 'chunks/photon_rs-G4OEF2QT.js')).href)).default;
  const image = photon.PhotonImage.new_from_byteslice(noisy);
  let jpeg; try { jpeg = Buffer.from(image.get_bytes_jpeg(85)); } finally { image.free(); }
  for (let orientation = 1; orientation <= 8; orientation++) {
    const exif = Buffer.alloc(36); exif[0] = 255; exif[1] = 225; exif.writeUInt16BE(34, 2); exif.write('Exif', 4); exif.write('II', 10);
    exif.writeUInt16LE(42, 12); exif.writeUInt32LE(8, 14); exif.writeUInt16LE(1, 18); exif.writeUInt16LE(274, 20); exif.writeUInt16LE(3, 22); exif.writeUInt32LE(1, 24); exif.writeUInt16LE(orientation, 28);
    const bytes = Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]);
    const options = { maxWidth: 40, maxHeight: 40, maxBytes: 10000 };
    const expected = await before.imageFixtureMain(bytes, 'image/jpeg', options), actual = await after.imageFixtureMain(bytes, 'image/jpeg', options);
    assert.ok(expected); equalImage(actual, expected, 'orientation ' + orientation);
    assert.equal(actual.originalWidth, orientation >= 5 ? 64 : 96);
    assert.equal(actual.originalHeight, orientation >= 5 ? 96 : 64);
  }
});

function fakePhoton(selected, calls, sizes = {}) {
  let allocated = 0, freed = 0;
  const make = (width = 16, height = 12) => {
    allocated++; let disposed = false;
    return { get_width: () => width, get_height: () => height, get_raw_pixels: () => new Uint8Array(width * height * 4),
      get_bytes: () => { calls.push(['png', width, height]); return new Uint8Array(sizes.png ?? (selected === 'png' ? 3 : 9)); },
      get_bytes_jpeg: quality => { calls.push([quality, width, height]); return new Uint8Array(sizes[quality] ?? (selected === quality ? 3 : 9)); },
      free: () => { assert.equal(disposed, false, 'double-free'); disposed = true; freed++; },
    };
  };
  function Image(pixels, width, height) { return make(width, height); }
  Image.new_from_byteslice = () => make();
  return { PhotonImage: Image, resize: (_, width, height) => make(width, height), SamplingFilter: { Lanczos3: 3 }, counts: () => ({ allocated, freed }) };
}
await check('strict-byte-boundary-quality-order-dedup-and-no-later-encodes', async () => {
  for (const quality of [80, 85]) for (const selected of ['png', ...new Set([quality, 85, 70, 55, 40]), 'none']) {
    const calls = [], photon = fakePhoton(selected, calls); after.imageFixturePhoton(photon);
    const priorCalls = [], prior = fakePhoton(selected, priorCalls); before.imageFixturePhoton(prior);
    const options = { maxWidth: 8, maxHeight: 8, maxBytes: 8, jpegQuality: quality };
    const expected = await before.imageFixtureMain(new Uint8Array(20), 'image/png', options);
    equalImage(await after.imageFixtureMain(new Uint8Array(20), 'image/png', options), expected);
    assert.deepEqual(photon.counts(), { allocated: photon.counts().allocated, freed: photon.counts().allocated });
    const order = ['png', ...new Set([quality, 85, 70, 55, 40])];
    if (selected !== 'none') assert.deepEqual(calls.map(x => x[0]), order.slice(0, order.indexOf(selected) + 1));
    else { assert.equal(expected, null); assert.ok(calls.some(x => x[1] === 1 && x[2] === 1)); }
  }
  const calls = [], photon = fakePhoton(80, calls, { png: 6 }); after.imageFixturePhoton(photon);
  const output = await after.imageFixtureMain(new Uint8Array(20), 'image/png', { maxWidth: 8, maxBytes: 8 });
  assert.equal(output.mimeType, 'image/jpeg', 'equal base64 byte size must be rejected'); assert.deepEqual(calls.map(x => x[0]), ['png', 80]);
});

await check('native-resources-free-on-encoding-and-orientation-failure', async () => {
  const calls = [], photon = fakePhoton('none', calls); let frees = 0;
  photon.resize = () => ({ get_bytes: () => { throw Error('encode fixture'); }, free: () => { frees++; } });
  after.imageFixturePhoton(photon);
  assert.equal(await after.imageFixtureMain(new Uint8Array(20), 'image/png', { maxWidth: 8 }), null);
  assert.equal(frees, 1); assert.deepEqual(photon.counts(), { allocated: 1, freed: 1 });
  for (const orientation of [2, 5, 7]) {
    const broken = fakePhoton('png', []); broken.fliph = () => { throw Error('orientation fixture'); };
    const bytes = Buffer.alloc(40); bytes[0] = 255; bytes[1] = 216; bytes[2] = 255; bytes[3] = 225; bytes.writeUInt16BE(34, 4); bytes.write('Exif', 6); bytes.write('II', 12); bytes.writeUInt32LE(8, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(274, 22); bytes.writeUInt16LE(orientation, 30);
    after.imageFixturePhoton(broken); assert.equal(await after.imageFixtureMain(bytes, 'image/jpeg'), null);
    assert.deepEqual(broken.counts(), { allocated: orientation === 2 ? 1 : 2, freed: orientation === 2 ? 1 : 2 });
  }
});

await check('normal-physical-worker-preserves-caller-buffer-and-parent-runtime-unloaded', async () => {
  const pkg = fixture(candidate, 'normal-worker', fs.readFileSync(path.join(candidate, name), 'utf8'));
  const module = await import(pathToFileURL(path.join(pkg, name)).href);
  const backing = Buffer.alloc(solid.length + 16, 21), bytes = backing.subarray(8, 8 + solid.length); bytes.set(solid); const saved = Buffer.from(backing);
  const result = await module.b(bytes, 'image/png', { maxWidth: 48 });
  assert.ok(result.wasResized); assert.equal(result.width, 48); assert.deepEqual(backing, saved);
  assert.equal(module.imageFixtureRuntime(), false);
  const fresh = fixture(pristine, 'normal-before', original, false);
  equalImage(result, await (await import(pathToFileURL(path.join(fresh, name)).href)).imageFixtureMain(bytes, 'image/png', { maxWidth: 48 }));
});

await check('Promise-all-image-batch-has-one-live-worker-including-termination', async () => {
  let source = fs.readFileSync(path.join(candidate, name), 'utf8');
  source = source.replace('function ot(t){return new nt(t)}', `function ot(t){globalThis.imageActive=(globalThis.imageActive??0)+1;globalThis.imagePeak=Math.max(globalThis.imagePeak??0,globalThis.imageActive);const worker=new nt(t),terminate=worker.terminate.bind(worker);worker.terminate=async()=>{try{return await terminate()}finally{globalThis.imageActive--}};return worker}`);
  const pkg = fixture(candidate, 'batch-worker', source);
  const module = await import(pathToFileURL(path.join(pkg, name)).href);
  const results = await Promise.all(Array.from({ length: 6 }, () => module.b(noisy, 'image/png', { maxWidth: 48 })));
  for (const result of results) equalImage(result, results[0]);
  assert.equal(globalThis.imagePeak, 1); assert.equal(globalThis.imageActive, 0); assert.equal(module.imageFixtureRuntime(), false);
});

await check('worker-startup-fallback-processing-errors-and-bounded-deadline', async () => {
  const source = fs.readFileSync(path.join(candidate, name), 'utf8');
  const missing = fixture(candidate, 'missing-worker', source, false);
  const missingModule = await import(pathToFileURL(path.join(missing, name)).href);
  assert.ok((await missingModule.b(solid, 'image/png', { maxWidth: 48 })).wasResized);
  const failures = [
    ['startup-error', 'throw Error("startup fixture")', false],
    ['process-error', 'import{parentPort as p}from"node:worker_threads";p.once("message",()=>{throw Error("processing fixture")});p.postMessage({ready:true});', /processing fixture/],
    ['invalid-response', 'import{parentPort as p}from"node:worker_threads";p.once("message",()=>p.postMessage(42));p.postMessage({ready:true});', /Invalid image resize worker response/],
    ['unexpected-exit', 'import{parentPort as p}from"node:worker_threads";p.once("message",()=>process.exit(9));p.postMessage({ready:true});', /exited with code 9/],
    ['timeout', 'import{parentPort as p}from"node:worker_threads";p.once("message",()=>{for(;;){}});p.postMessage({ready:true});', /timed out/],
    ['startup-timeout', 'for(;;){}', /timed out/],
  ];
  for (const [label, workerSource, error] of failures) {
    // Shorten only the test copy's deadline to avoid 60s fault fixtures.
    const pkg = fixture(candidate, label, source.replace(')),30000)', ')),120)'));
    fs.writeFileSync(path.join(pkg, 'image-resize-worker.js'), workerSource);
    const module = await import(pathToFileURL(path.join(pkg, name)).href);
    const start = performance.now();
    if (error) { await assert.rejects(() => module.b(solid, 'image/png', { maxWidth: 48 }), error); assert.equal(module.imageFixtureRuntime(), false); }
    else assert.ok((await module.b(solid, 'image/png', { maxWidth: 48 })).wasResized);
    assert.ok(performance.now() - start < 3000, label + ' did not terminate');
  }
});

await check('unavailable-Photon-passthrough-and-typed-error-preserved', async () => {
  const pkg = fixture(candidate, 'unavailable-photon', fs.readFileSync(path.join(candidate, name), 'utf8'));
  fs.unlinkSync(path.join(pkg, 'chunks/photon_rs-G4OEF2QT.js'));
  const module = await import(pathToFileURL(path.join(pkg, name)).href);
  const result = await module.b(solid, 'image/png'); assert.equal(result.wasResized, false);
  assert.deepEqual(Buffer.from(result.data, 'base64'), solid);
  await assert.rejects(() => module.b(solid, 'image/png', { maxWidth: 48 }), error => error instanceof module.a);
  assert.equal(module.imageFixtureRuntime(), false);
});

async function measure(pkg, label, image) {
  const child = spawn(process.execPath, [import.meta.filename, '--measure', path.join(pkg, name), image], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', peak = { rssKiB: 0, pssKiB: 0, privateKiB: 0 };
  child.stdout.on('data', bytes => stdout += bytes); child.stderr.on('data', bytes => stderr += bytes);
  const timer = setInterval(() => {
    if (process.platform !== 'linux') return;
    try {
      const text = fs.readFileSync(`/proc/${child.pid}/smaps_rollup`, 'utf8');
      const value = key => Number(new RegExp('^' + key + ':\\s+(\\d+)', 'm').exec(text)?.[1] ?? 0);
      peak.rssKiB = Math.max(peak.rssKiB, value('Rss')); peak.pssKiB = Math.max(peak.pssKiB, value('Pss'));
      peak.privateKiB = Math.max(peak.privateKiB, value('Private_Clean') + value('Private_Dirty'));
    } catch {}
  }, 10);
  const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  clearInterval(timer); assert.equal(code, 0, stderr);
  const phases = stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(phases.at(-1).runtimeLoaded, label === 'baseline');
  console.log(JSON.stringify({ label, workload: '1600x1000 noise PNG; Promise.all batch of four resizes to <=800x800/<250000 base64 bytes', peak, phases, accounting: 'RSS/PSS/private include worker threads in this process; no child processes; heap/external are parent-isolate samples' }));
}
const largeImage = path.join(scratch, 'large.png'); fs.writeFileSync(largeImage, png(1600, 1000, true));
await measure(beforePkg, 'baseline', largeImage); await measure(afterPkg, 'candidate', largeImage);
console.log(`Image memory: ${passed} passed, 0 failed; fixture: ${scratch}`);

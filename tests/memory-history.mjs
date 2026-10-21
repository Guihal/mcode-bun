// Exercise the real pinned owners in disposable package copies, never user data.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { repair } from '../scripts/retry-repair.mjs';
import { repairHistoryMemory } from '../scripts/history-memory-repair.mjs';
import { transform } from '../scripts/build.mjs';

const [pristine, candidate] = process.argv.slice(2);
if (!pristine || !candidate) throw Error('Usage: bun tests/memory-history.mjs <pristine-package> <candidate-package>');
const root = fs.mkdtempSync(path.join(process.env.MCODE_TEST_TMP ?? os.tmpdir(), 'mcode-memory-history-'));
const original = fs.readFileSync(path.join(pristine, 'chunks/chunk-47KWM23C.js'), 'utf8');
const optimized = repairHistoryMemory(repair(original));
assert.equal(fs.readFileSync(path.join(candidate, 'chunks/chunk-47KWM23C.js'), 'utf8'), transform('chunks/chunk-47KWM23C.js', original), 'Candidate differs from the checked build transformation');
assert.throws(() => repairHistoryMemory(original), /Unsupported post-retry/);
assert.throws(() => repairHistoryMemory(repair(original) + ' '), /Unsupported post-retry/);
if (!process.env.MCODE_HISTORY_CHILD) {
  const results = {};
  for (const mode of ['baseline', 'candidate']) {
    const dir = path.join(root, mode), pkg = path.join(dir, 'package');
    fs.mkdirSync(path.join(pkg, 'chunks'), { recursive: true });
    fs.writeFileSync(path.join(pkg, 'package.json'), '{"type":"module"}');
    fs.cpSync(path.join(candidate, '../runtime'), path.join(dir, 'runtime'), { recursive: true });
    fs.cpSync(path.join(candidate, 'node_modules'), path.join(pkg, 'node_modules'), { recursive: true });
    for (const name of fs.readdirSync(path.join(candidate, 'chunks'))) fs.copyFileSync(path.join(candidate, 'chunks', name), path.join(pkg, 'chunks', name));
    const source = (mode === 'candidate' ? optimized : original).replace('import C5 from"better-sqlite3"', 'import C5 from"../../runtime/sqlite.cjs"').replaceAll(/from\s*"node:fs\/promises"/g, 'from"../fs-probe.mjs"');
    fs.writeFileSync(path.join(pkg, 'fs-probe.mjs'), 'export * from "node:fs/promises";export {default} from "node:fs/promises";export const {open,readFile,rename}=globalThis.__mcodeHistoryProbe;');
    const symbols = ['X$n','dU','rE','tvt','U7','yU','vj','lr','Zr','fd','cfr','F_t','Ty','$C','Xk','QBr'];
    fs.writeFileSync(path.join(pkg, 'chunks/chunk-47KWM23C.js'), source + '\nexport {' + symbols.map((name, index) => `${name} as history${index}`).join(',') + '};');
    const result = spawnSync(process.execPath, [import.meta.path, pristine, candidate], { env: { ...process.env, MCODE_HISTORY_CHILD: mode, MCODE_HISTORY_PACKAGE: pkg, MCODE_HISTORY_ROOT: dir }, encoding: 'utf8', timeout: 180000, maxBuffer: 1024 * 1024 });
    process.stdout.write(result.stdout ?? '');
    assert.equal(result.status, 0, result.stderr || String(result.error));
    results[mode] = JSON.parse(fs.readFileSync(path.join(dir, 'result.json')));
  }
  assert.deepEqual(results.candidate.outputs, results.baseline.outputs, 'Canonical messages, revisions, catalog and locators must be identical');
  assert.ok(results.baseline.appendArchiveReads > 0);
  assert.equal(results.candidate.appendArchiveReads, 0, 'Proven append reread archive payloads');
  assert.ok(results.candidate.invalidatedArchiveReads > 0, 'Changed archive metadata failed to invalidate append proof');
  assert.equal(results.candidate.maxRead, 65536);
  console.log(JSON.stringify({ workload: '3 archived generations; 480 x 24KiB records; 8 provider snapshots; UTF-8/prefix/lineage/recovery fixtures', baseline: results.baseline.measurement, candidate: results.candidate.measurement, appendArchiveReads: { baseline: results.baseline.appendArchiveReads, candidate: results.candidate.appendArchiveReads }, maxCandidateRead: results.candidate.maxRead, fixture: root }, null, 2));
  console.log('History memory contracts: passed');
  process.exit(0);
}

const mode = process.env.MCODE_HISTORY_CHILD, dir = process.env.MCODE_HISTORY_ROOT;
const reads = [], open = fsp.open.bind(fsp), readFile = fsp.readFile.bind(fsp), rename = fsp.rename.bind(fsp);
let failLocator = false, failRead = false, closed = 0;
globalThis.__mcodeHistoryProbe = {};
globalThis.__mcodeHistoryProbe.readFile = async (file, ...args) => { const result = await readFile(file, ...args); reads.push({ file: String(file), whole: true, bytes: Buffer.byteLength(result) }); return result; };
globalThis.__mcodeHistoryProbe.open = async (file, ...args) => {
  const handle = await open(file, ...args), read = handle.read.bind(handle), close = handle.close.bind(handle);
  handle.close = async () => { closed++; return close(); };
  handle.read = async (...params) => { if (failRead) { failRead = false; throw Error('injected read failure'); } const result = await read(...params); reads.push({ file: String(file), length: typeof params[2] === 'number' ? params[2] : params[0]?.length, bytes: result.bytesRead }); return result; };
  return handle;
};
globalThis.__mcodeHistoryProbe.rename = async (from, to) => {
  if (failLocator && String(to).endsWith('/user-message-locators.jsonl')) { failLocator = false; throw Error('injected locator publication failure'); }
  return rename(from, to);
};
const loaded = await import(path.join(process.env.MCODE_HISTORY_PACKAGE, 'chunks/chunk-47KWM23C.js'));
const h = Object.fromEntries(['X$n','dU','rE','tvt','U7','yU','vj','lr','Zr','fd','cfr','F_t','Ty','$C','Xk','QBr'].map((name, index) => [name, loaded['history' + index]]));
const outputs = {}, user = (id, text = 'payload') => ({ message_id: `msg-user-v1-${id}`, turn_id: `turn-${id}`, message: { role: 'user', content: text, timestamp: 1 } });
const internal = (id, text = 'payload') => ({ message_id: `msg-${id}`, turn_id: `turn-${id}`, message: { role: 'user', content: text, timestamp: 1 } });
const write = (file, records, newline = true) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, records.map(record => JSON.stringify(record)).join('\n') + (records.length && newline ? '\n' : '')); };
const check = async (name, fn) => { await fn(); console.log(`PASS ${mode} ${name}`); };
const memory = () => {
  const result = { ...process.memoryUsage(), peakRssKiB: process.resourceUsage().maxRSS };
  if (process.platform === 'linux') {
    const rollup = fs.readFileSync('/proc/self/smaps_rollup', 'utf8');
    for (const name of ['Pss', 'Private_Clean', 'Private_Dirty', 'Anonymous']) result[name + 'KiB'] = Number(new RegExp('^' + name + ':\\s+(\\d+)', 'm').exec(rollup)?.[1]);
  }
  return result;
};
const readerPath = path.join(dir, 'reader.jsonl');
await check('strict-stream-prefix-final-line-utf8-and-malformed-parity', async () => {
  const source = new h.dU({ activePath: readerPath, reuseDecodedRecords: true });
  for (const newline of [true, false]) {
    const records = [internal('unicode', '😀'.repeat(20000)), internal('large', 'x'.repeat(5 * 1024 * 1024))];
    write(readerPath, records, newline);
    const first = await source.readActiveStrict(); assert.deepEqual(first, records);
    assert.deepEqual(await source.readActiveStrict(), first);
    fs.appendFileSync(readerPath, (newline ? '' : '\n') + JSON.stringify(internal('append', 'новый')) + '\n');
    assert.deepEqual(await source.readActiveStrict(), [...records, internal('append', 'новый')]);
    const bytes = fs.readFileSync(readerPath); const index = bytes.indexOf(Buffer.from('😀')); Buffer.from('😁').copy(bytes, index); fs.writeFileSync(readerPath, bytes);
    assert.equal((await source.readActiveStrict())[0].message.content.startsWith('😁'), true);
    write(readerPath, [internal('truncate')]); assert.equal((await source.readActiveStrict()).length, 1);
    const replacement = readerPath + '.replace'; write(replacement, [internal('replace')]); fs.renameSync(replacement, readerPath); assert.equal((await source.readActiveStrict())[0].message_id, 'msg-replace');
  }
  for (const bad of ['\n', '{}\n\n', '{invalid}\n', JSON.stringify(internal('ok')) + '\n \n']) {
    fs.writeFileSync(readerPath, bad);
    let error; try { await source.readActiveStrict(); } catch (value) { error = value; }
    assert.ok(error); outputs['error-' + bad] = error.message.replaceAll(readerPath, '<file>');
    write(readerPath, [internal('after-failure')]); assert.deepEqual(await source.readActiveStrict(), [internal('after-failure')]);
  }
  if (mode === 'candidate') {
    const priorBytes = source.readCache.bytes, priorRecords = source.readCache.records, beforeClosed = closed;
    failRead = true; await assert.rejects(source.readActiveStrict(), /injected read failure/);
    assert.equal(source.readCache.bytes, priorBytes); assert.equal(source.readCache.records, priorRecords); assert.equal(closed, beforeClosed + 1);
  }
  assert.ok(source.readCache.bytes.length <= 4 * 1024 * 1024);
  fs.writeFileSync(readerPath, ''); assert.deepEqual(await source.readActiveStrict(), []);
});

const sessions = new Map, dataDir = path.join(dir, 'data');
for (const id of ['history', 'fork', 'migration']) sessions.set(id, { sessionId: id, createdAtMs: 1700000000000, updatedAtMs: 1700000000000 });
const sessionApi = { get: async id => sessions.get(id) }, locations = h.Ty({ dataDir, sessions: sessionApi });
const paths = await locations.allocate(sessions.get('history'));
const shared = user('shared', 'unchanged external user');
let prior, snapshots = [];
for (let generation = 0; generation < 3; generation++) {
  let records = [shared, ...Array.from({ length: 80 }, (_, index) => internal(`g${generation}-${index}`, `${generation}:${index}:` + 'x'.repeat(24576)))];
  if (generation === 2) records.push(user('returning', 'adjacent-generation user'));
  if (generation) records = h.cfr(records, { schemaVersion: 1, generation, producedBy: 'tool_trim', parentSnapshot: { generation: generation - 1, compactionId: `compact-${generation - 1}`, revision: h.fd(prior) } });
  const fileName = `g${String(generation).padStart(12, '0')}--compact-${generation}.jsonl`;
  write(path.join(paths.snapshots, fileName), records); snapshots.push({ generation, fileName, revision: h.fd(records), records }); prior = records;
}
const active = h.cfr([shared, ...Array.from({ length: 480 }, (_, index) => internal(`active-${index}`, `${index}:` + 'y'.repeat(24576)))], { schemaVersion: 1, generation: 3, producedBy: 'tool_trim', parentSnapshot: { generation: 2, compactionId: 'compact-2', revision: h.fd(prior) } });
active[1].message.content = [{ type: 'text', text: 'nested raw isolation' }];
write(paths.messages, active);
const provider = h.tvt({ dataDir, sessions: sessionApi, locations, retryDelay: async () => {} }), bridge = new h.vj(h.QBr(provider, {}));
const archiveReads = () => reads.filter(item => item.file.includes('/snapshots/') && item.file.endsWith('.jsonl')).length;
const append = (id, message = { role: 'user', content: `append-${id}`, timestamp: 2 }) => ({ sessionId: 'history', turnId: 'append-turn-' + id, reason: 'messageDelta', operation: { id: 'append-op-' + id, kind: 'append' }, messages: [message] });
let appendArchiveReads, invalidatedArchiveReads;
await check('scanner-canonical-lineage-offsets-and-readonly-isolation', async () => {
  const scan = await h.yU({ activePath: paths.messages, snapshotsPath: paths.snapshots, sessionId: 'history' }); outputs.scan = scan;
  const raw = await provider.readActive('history'); raw.messages[0].content = 'mutated-raw';
  raw.messages[1].content[0].text = 'mutated-nested-raw';
  const first = await bridge.read('history'); assert.equal(first.messages[0].content, shared.message.content);
  assert.equal(first.messages[1].content[0].text, 'nested raw isolation'); assert.equal(Object.isFrozen(first.messages[1].content[0]), true);
  assert.equal(Object.isFrozen(first.messages[0]), true);
  const second = await bridge.read('history');
  if (mode === 'candidate') { assert.equal(first.messages[0], second.messages[0]); assert.equal(first.messages.at(-1), second.messages.at(-1)); }
  outputs.initial = { revision: first.revision, count: first.messages.length };
  Bun.gc(true); const before = memory(), start = performance.now(), ioStart = reads.length, retained = [];
  for (let index = 0; index < 8; index++) retained.push(await bridge.read('history'));
  Bun.gc(true); const after = memory();
  outputs.snapshotCount = retained.at(-1).messages.length;
  const heap = (await import('bun:jsc')).heapStats();
  outputs.measurement = undefined;
  fs.writeFileSync(path.join(dir, 'measurement.json'), JSON.stringify({ before, after, heap: { heapSize: heap.heapSize, heapCapacity: heap.heapCapacity, extraMemorySize: heap.extraMemorySize }, bytesRead: reads.slice(ioStart).reduce((sum, item) => sum + (item.bytes ?? 0), 0), latencyMs: performance.now() - start }));
  const beforeAppend = archiveReads();
  const next = await bridge.append(append('one'));
  appendArchiveReads = archiveReads() - beforeAppend;
  assert.equal(first.messages.length + 1, next.messages.length); assert.equal(first.messages[0].content, shared.message.content);
  if (mode === 'candidate') assert.equal(first.messages[0], next.messages[0]);
  outputs.afterAppend = { revision: next.revision, messages: next.messages.slice(-1) };
  outputs.catalog = JSON.parse(fs.readFileSync(path.join(paths.sessionDir, 'history-catalog.json')));
  outputs.locators = fs.readFileSync(path.join(paths.sessionDir, 'user-message-locators.jsonl'), 'utf8');
  for (const [id, content] of [['returning', 'adjacent-generation user'], ['new-external', 'new external user']]) {
    const change = append(id, { role: 'user', content, timestamp: 1 }); change.turnId = 'turn-' + id; change.identityHints = [{ index: 0, messageId: 'msg-user-v1-' + id, source: 'preserved' }];
    const beforeExternal = archiveReads(); await bridge.append(change); if (mode === 'candidate') assert.equal(archiveReads(), beforeExternal);
  }
  const final = await bridge.append(append('locator-revision'));
  const externalLocators = fs.readFileSync(path.join(paths.sessionDir, 'user-message-locators.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(externalLocators.filter(item => item.messageId === 'msg-user-v1-returning').length, 1);
  assert.equal(externalLocators.find(item => item.messageId === 'msg-user-v1-new-external').artifactRevision, final.revision);
  outputs.externalLocators = externalLocators;
  const again = await provider.readActive('history'); again.messages[1].content = 'raw-again'; assert.notEqual((await provider.readActive('history')).messages[1].content, 'raw-again');
});

await check('invalidators-index-rollback-and-restarted-owner', async () => {
  const archive = path.join(paths.snapshots, snapshots[0].fileName), time = new Date(Date.now() + 1000); fs.utimesSync(archive, time, time);
  const before = archiveReads(); await provider.append(append('metadata-change')); invalidatedArchiveReads = archiveReads() - before;
  const oldCatalog = fs.readFileSync(path.join(paths.sessionDir, 'history-catalog.json'), 'utf8');
  failLocator = true; await provider.append(append('index-failure'));
  assert.equal(failLocator, false); assert.equal(fs.readFileSync(path.join(paths.sessionDir, 'history-catalog.json'), 'utf8'), oldCatalog);
  const beforeRecovery = archiveReads(); await provider.readActive('history'); assert.ok(archiveReads() > beforeRecovery);
  const restarted = h.tvt({ dataDir, sessions: sessionApi, locations });
  const beforeRestart = archiveReads(); await restarted.append(append('restart')); assert.ok(archiveReads() > beforeRestart);
  // A same-size change beyond the decoded prefix must invalidate the old proof.
  const bytes = fs.readFileSync(paths.messages), point = bytes.indexOf(Buffer.from('yyyy'), 5 * 1024 * 1024); assert.ok(point > 0); bytes[point] = 122; fs.writeFileSync(paths.messages, bytes);
  const beforeEdit = archiveReads(); await provider.append(append('same-size-edit')); assert.ok(archiveReads() > beforeEdit);
  const changed = archive + '.replacement'; fs.copyFileSync(archive, changed); fs.renameSync(changed, archive);
  const beforeIdentity = archiveReads(); await provider.append(append('archive-identity')); assert.ok(archiveReads() > beforeIdentity);
  const adapter = h.rE(), realAppend = adapter.append.bind(adapter);
  adapter.append = async (...args) => { await realAppend(...args); throw new h.Xk(args[0], Error('injected uncertain append')); };
  const uncertain = h.tvt({ dataDir, sessions: sessionApi, locations, files: adapter });
  await assert.rejects(uncertain.append(append('uncertain')), /uncertain/);
  const beforeUncertain = archiveReads(); const recovered = await provider.readActive('history'); assert.ok(archiveReads() > beforeUncertain);
  assert.equal(recovered.messages.filter(message => message.content === 'append-uncertain').length, 1);
});

await check('migration-materialization-and-restart-use-the-existing-owner', async () => {
  let checkpoint, writes = 0;
  const legacyHistory = { checkpoints: { getCheckpoint: async () => checkpoint, upsertCheckpoint: async value => { checkpoint = value; writes++; } }, sources: { readLedgerSnapshot: async () => [internal('migrated', 'owned legacy record')], readSqliteRows: async () => { throw Error('Wrong migration priority'); }, readSqliteBlob: async () => { throw Error('Wrong migration priority'); } } };
  const migrated = h.tvt({ dataDir, sessions: sessionApi, locations, legacyHistory, nowMs: () => 7 });
  const first = await migrated.readActive('migration'); assert.equal(first.messages[0].content, 'owned legacy record'); assert.equal(writes, 1);
  const next = h.tvt({ dataDir, sessions: sessionApi, locations, legacyHistory });
  assert.equal((await next.readActive('migration')).revision, first.revision); assert.equal(writes, 1);
  outputs.migration = { revision: first.revision, checkpoint };
});

await check('pending-and-interrupted-tool-tails-replace-compact-rewind-fork-delete', async () => {
  await provider.append(append('tool', { role: 'assistant', content: [{ type: 'toolCall', id: 'owned-tool', name: 'bash', arguments: {} }], timestamp: 3 }));
  assert.equal((await provider.readActive('history')).messages.at(-1).role, 'assistant');
  await provider.append(append('interrupt'));
  const after = await provider.readActive('history'); assert.equal(JSON.stringify(after.messages).includes('owned-tool'), false);
  const replacement = after.messages.slice(0, 2), ids = after.identityVector.slice(0, 2);
  const replaced = await provider.replace({ sessionId: 'history', turnId: 'replace', reason: 'replaceMessages', operation: { id: 'replace-op', kind: 'replace' }, messages: replacement, replacementEntries: replacement.map((message, index) => ({ message, identity: { kind: 'preserve', messageId: ids[index] } })) });
  assert.equal(replaced.messages.length, 2);
  const compacted = await provider.compact({ sessionId: 'history', turnId: 'compact', compactionId: 'native-checkpoint', method: 'llm_checkpoint', operation: { id: 'compact-op', kind: 'compaction' }, messages: [{ role: 'compactionSummary', summary: 'owned synthetic checkpoint' }] });
  assert.equal(compacted.generation, 4); assert.equal(compacted.messages[0].summary, 'owned synthetic checkpoint');
  const history = h.F_t({ dataDir, sessions: sessionApi, locations });
  const current = await history.read('history');
  const fork = await history.stageFork({ sourceSessionId: 'history', targetSessionId: 'fork', operationId: 'fork-op', generation: current.activeGeneration, active: current.active, snapshots: current.snapshots });
  await fork.publish(); assert.equal((await history.read('fork')).revision, current.revision);
  const rewind = await history.stageRewind({ sessionId: 'history', operationId: 'rewind-op', expectedRevision: current.revision, sourceGeneration: 4, generation: 0, active: snapshots[0].records.slice(0, 1), snapshots: [] });
  await rewind.publish(); assert.equal((await provider.readActive('history')).messages.length, 1);
  await provider.delete('history'); assert.equal(fs.existsSync(paths.messages), false);
  sessions.delete('history'); await assert.rejects(provider.read('history'), /Session not found/);
});

await check('arbitrary-provider-mutable-aliases-and-unsupported-semantics', async () => {
  const nested = { value: 1 }, message = { role: 'user', content: [nested, nested], timestamp: 1 };
  const snapshot = { revision: 'synthetic', messages: [message], identityVector: ['msg-one'] };
  const custom = new h.vj({ read: async () => snapshot, readActive: async () => snapshot, append: async () => snapshot, replace: async () => snapshot });
  const first = await custom.read('custom'); nested.value = 9; const next = await custom.read('custom');
  assert.equal(first.messages[0].content[0].value, 1); assert.equal(next.messages[0].content[0].value, 9);
  assert.equal(first.messages[0].content[0], first.messages[0].content[1]);
  assert.throws(() => h.lr({ bad: new Date() }), /Semantic|semantic|Unsupported/);
  const cycle = {}; cycle.self = cycle; assert.throws(() => h.lr(cycle), /Cyclic/);
});
await check('scanner-error-contracts', async () => {
  const errorDir = path.join(dir, 'errors'), activePath = path.join(errorDir, 'messages.jsonl'), snapshotsPath = path.join(errorDir, 'snapshots'); fs.mkdirSync(snapshotsPath, { recursive: true });
  const scan = () => h.yU({ activePath, snapshotsPath, sessionId: 'errors' });
  for (const [name, records] of [['duplicate', [internal('same'), internal('same')]], ['lineage', [user('wrong')]]]) {
    let items = records;
    if (name === 'lineage') { write(path.join(snapshotsPath, 'g000000000000--parent.jsonl'), [user('wrong', 'original')]); items = h.cfr(records, { schemaVersion: 1, generation: 1, producedBy: 'tool_trim', parentSnapshot: { generation: 0, compactionId: 'parent', revision: h.fd([user('wrong', 'original')]) } }); }
    write(activePath, items); let error; try { await scan(); } catch (value) { error = value; } assert.ok(error); outputs['scan-error-' + name] = error.code;
  }
  fs.unlinkSync(path.join(snapshotsPath, 'g000000000000--parent.jsonl')); let missing; try { await scan(); } catch (error) { missing = error; } assert.equal(missing.code, 'parent-snapshot-missing');
  write(activePath, [internal('safe')]); const redirected = activePath + '.saved'; fs.renameSync(activePath, redirected); fs.symlinkSync(redirected, activePath); await assert.rejects(scan(), error => error.code === 'unsafe-artifact');
});
const measurement = JSON.parse(fs.readFileSync(path.join(dir, 'measurement.json')));
fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ outputs, appendArchiveReads, invalidatedArchiveReads, maxRead: Math.max(...reads.map(item => item.length ?? 0)), measurement }));

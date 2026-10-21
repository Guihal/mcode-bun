// Actual pinned editor owners, exported only into disposable package copies.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { repairEditorMemory } from '../scripts/editor-memory-repair.mjs';

const launcher = 'chunks/launcher-AVQRYDKB.js';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const sample = () => {
  Bun.gc(true);
  const usage = process.memoryUsage();
  const smaps = process.platform === 'linux' ? fs.readFileSync('/proc/self/smaps_rollup', 'utf8') : '';
  const kb = name => Number(smaps.match(new RegExp(`^${name}:\\s+(\\d+)`, 'm'))?.[1] ?? 0) * 1024;
  return { heap: usage.heapUsed, rss: usage.rss, pss: kb('Pss'), anonymous: kb('Anonymous'), private: kb('Private_Clean') + kb('Private_Dirty') };
};

if (process.argv[2] === '--memory') {
  // Evaluate the exact stack source in isolation, avoiding full TUI import noise.
  const source = fs.readFileSync(process.argv[3], 'utf8');
  const start = source.indexOf('var bs=class{'), end = source.indexOf(';var Fb=', start);
  assert.ok(start >= 0 && end > start);
  const Stack = Function(source.slice(start, end) + ';return bs')();
  const stack = new Stack();
  const payload = Buffer.alloc(256 * 1024, 120).toString();
  const state = { lines: ['[paste #1 262144 chars]'], cursorLine: 0, cursorCol: 22 };
  const pastes = new Map([[1, payload]]);
  const before = sample(), started = performance.now();
  for (let i = 0; i < 200; i++) {
    stack.push({ state, pastes, pasteCounter: 1 });
    state.lines[0] += 'x'; state.cursorCol++;
  }
  const elapsedMs = performance.now() - started, retained = sample();
  assert.equal(stack.length, 200);
  stack.clear(); assert.equal(stack.length, 0);
  const cleared = sample();
  console.log(JSON.stringify({ pasteBytes: payload.length, snapshots: 200, before, retained, cleared, elapsedMs }));
  process.exit(0);
}

if (process.argv[2] === '--behavior') {
  const { Editor, Input, Stack } = await import(pathToFileURL(process.argv[3]).href);
  const tui = { terminal: { rows: 40 }, requestRender() {} };
  const theme = { borderColor: value => value };
  const editor = () => new Editor(tui, theme);
  const traces = [];
  const record = e => traces.push({ state: e.captureState(), expanded: digest(e.getExpandedText()), undo: e.undoStack.length });

  const stack = new Stack();
  const original = { state: { lines: ['one', 'two'], cursorLine: 1, cursorCol: 2 }, pastes: new Map([[1, 'payload']]), pasteCounter: 1 };
  stack.push(original);
  original.state.lines[0] = 'changed'; original.state.cursorCol = 0;
  original.pastes.set(1, 'changed'); original.pastes.set(2, 'added');
  assert.deepEqual(stack.pop(), { state: { lines: ['one', 'two'], cursorLine: 1, cursorCol: 2 }, pastes: new Map([[1, 'payload']]), pasteCounter: 1 });
  assert.equal(stack.pop(), undefined);
  const plain = { value: 'value', cursor: 3 }; stack.push(plain); plain.value = 'changed'; plain.cursor = 0;
  assert.deepEqual(stack.pop(), { value: 'value', cursor: 3 });

  const e = editor();
  const extension = { attachments: [{ id: 'attachment', nested: { bytes: new Uint8Array([1, 2]) } }], plugins: [{ pluginId: 'p', range: [0, 2] }] };
  extension.self = extension;
  let restored;
  e.captureUndoExtensionState = () => extension;
  e.restoreUndoExtensionState = value => { restored = value; };
  e.pushUndoSnapshot();
  extension.attachments[0].nested.bytes[0] = 9;
  extension.plugins[0].range[0] = 8;
  extension.attachments.push({ id: 'later' });
  e.undo();
  assert.equal(restored.self, restored);
  assert.equal(restored.attachments.length, 1);
  assert.equal(restored.attachments[0].nested.bytes[0], 1);
  assert.deepEqual(restored.plugins[0].range, [0, 2]);
  restored.plugins[0].range[0] = 7;
  assert.equal(extension.plugins[0].range[0], 8);
  e.captureUndoExtensionState = () => ({ unsupported: () => {} });
  assert.throws(() => e.pushUndoSnapshot());
  e.captureUndoExtensionState = undefined; e.restoreUndoExtensionState = undefined;

  // Atomic paste markers, numbering after deletion, and independent old maps.
  for (let i = 0; i < 3; i++) e.handlePaste(String(i).repeat(1100));
  record(e);
  const beforeDeletion = e.captureState();
  e.setCursorOffset(e.getText().indexOf(']') + 1); e.handleBackspace();
  assert.equal(e.pasteCounter, 2);
  assert.deepEqual([...e.pastes], [[1, '1'.repeat(1100)], [2, '2'.repeat(1100)]]);
  assert.match(e.getText(), /^\[paste #1 .*\]\[paste #2 .*\]$/);
  record(e); e.undo();
  assert.equal(e.getText(), beforeDeletion.text);
  assert.deepEqual([...e.pastes.values()], ['0'.repeat(1100), '1'.repeat(1100), '2'.repeat(1100)]);
  record(e);
  e.handlePaste('more'.repeat(400)); record(e); e.undo(); record(e);
  e.setText('fresh'); record(e); e.undo(); record(e);

  // Line arrays are mutated by both splice and assignment; all old snapshots survive.
  const lines = editor(); lines.insertTextAtCursor('alpha\nbeta'); record(lines);
  lines.addNewLine(); lines.insertTextAtCursor('third'); record(lines);
  lines.handleBackspace(); record(lines); lines.undo(); record(lines);
  lines.deleteToStartOfLine(); record(lines); lines.undo(); record(lines);
  lines.setCursorOffset(0); lines.handleForwardDelete(); record(lines); lines.undo(); record(lines);
  lines.replaceRange(0, 5, 'replaced'); record(lines); lines.undo(); record(lines);
  lines.deleteToEndOfLine(); record(lines); lines.yank(); record(lines); lines.undo(); record(lines);

  // Word typing groups edits, whitespace and movement delimit existing groups.
  const typing = editor();
  for (const key of ['a', 'b', ' ', 'c', 'd']) typing.handleInput(key);
  record(typing); typing.handleInput('\x1f'); record(typing); typing.undo(); record(typing);
  assert.equal(typing.getText(), '');
  const saved = e.captureState();
  e.insertTextAtCursor('temporary');
  assert.equal(e.restoreState(saved), true); assert.equal(e.undoStack.length, 0); record(e);
  assert.equal(e.restoreState({ ...saved, cursor: -1 }), false); record(e);
  let submitted;
  e.onSubmit = (text, state) => { submitted = { text, state }; };
  e.submit();
  assert.equal(submitted.text, '0'.repeat(1100) + '1'.repeat(1100) + '2'.repeat(1100));
  assert.deepEqual(submitted.state, saved);
  assert.equal(e.getText(), ''); assert.equal(e.pastes.size, 0); assert.equal(e.pasteCounter, 0); assert.equal(e.undoStack.length, 0); record(e);
  e.undo(); assert.equal(e.getText(), '');

  const input = new Input();
  for (const key of ['a', 'b', ' ', 'c', 'd']) input.handleInput(key);
  const inputTrace = () => traces.push({ value: input.getValue(), cursor: input.cursor, undo: input.undoStack.length });
  inputTrace(); input.handleInput('\x1f'); inputTrace(); input.undo(); inputTrace(); assert.equal(input.getValue(), '');
  input.handlePaste('one\r\ntwo\tthree'); inputTrace();
  assert.equal(input.getValue(), 'onetwo    three');
  input.handleBackspace(); inputTrace(); input.undo(); inputTrace();
  input.cursor = 0; input.handleForwardDelete(); inputTrace(); input.undo(); inputTrace();
  input.moveCursorToEnd(); input.deleteWordBackwards(); inputTrace(); input.yank(); inputTrace(); input.undo(); inputTrace();
  input.undoStack.clear(); assert.equal(input.undoStack.length, 0);
  console.log(JSON.stringify(traces));
  process.exit(0);
}

const [pristine, candidate] = process.argv.slice(2).map(value => path.resolve(value));
if (!pristine || !candidate) throw Error('Usage: bun tests/memory-editor.mjs <pristine-package> <candidate-package>');
const scratch = fs.mkdtempSync(path.join(process.env.MCODE_TEST_TMP ?? os.tmpdir(), 'mcode-memory-editor-'));
const pristineSource = fs.readFileSync(path.join(pristine, launcher), 'utf8');
assert.throws(() => repairEditorMemory(pristineSource + '\n'), /Unsupported pristine/);
assert.throws(() => repairEditorMemory(repairEditorMemory(pristineSource)), /Unsupported pristine/);
const candidateSource = fs.readFileSync(path.join(candidate, launcher), 'utf8');
const repairedStack = repairEditorMemory(pristineSource).match(/var bs=class\{.*?;var Fb=/s)?.[0];
assert.ok(repairedStack && candidateSource.includes(repairedStack), 'Builder must apply the exact editor repair');

const behavior = [];
const memory = [];
for (const [label, source] of [['baseline', pristineSource], ['candidate', candidateSource]]) {
  const root = path.join(scratch, label), pkg = path.join(root, 'package');
  fs.mkdirSync(root);
  fs.cpSync(candidate, pkg, { recursive: true });
  fs.cpSync(path.join(candidate, '..', 'runtime'), path.join(root, 'runtime'), { recursive: true });
  const file = path.join(pkg, launcher);
  fs.writeFileSync(file, source + '\nexport {Uo as Editor,Ue as Input,bs as Stack};\n');
  const env = { ...process.env, MINIMAX_DATA_DIR: path.join(root, 'data'), MCODE_CONFIG_DIR: path.join(root, 'data'), MCODE_NO_MODIFY_PATH: '1' };
  fs.mkdirSync(env.MINIMAX_DATA_DIR);
  const run = mode => {
    const result = spawnSync(process.execPath, [import.meta.path, mode, file], { env, encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return JSON.parse(result.stdout.trim());
  };
  behavior.push(run('--behavior')); memory.push(run('--memory'));
  console.log(JSON.stringify({ label, ...memory.at(-1) }));
}
assert.deepEqual(behavior[1], behavior[0]);
assert.ok(memory[0].retained.heap - memory[0].before.heap > 40 * 1024 * 1024, 'Baseline must demonstrate paste duplication');
assert.ok(memory[1].retained.heap - memory[1].before.heap < 8 * 1024 * 1024, 'Candidate must retain containers without 200 paste copies');
console.log('PASS both undo consumers; nested extension isolation; paste/delete/renumber; grouping; clear/restore/submit; baseline parity');

// Real production executable in a disposable PTY. The loopback provider sees
// the expanded pasted text after an edit + undo, never synthetic discarded text.
if (process.platform === 'linux') {
  const data = path.join(scratch, 'pty-data'), workspace = path.join(scratch, 'pty-workspace');
  fs.mkdirSync(data); fs.mkdirSync(workspace);
  const payload = 'editor-paste-' + 'x'.repeat(256 * 1024);
  let received = false, providerError, child, output = '', stderr = '';
  const server = http.createServer(async (req, res) => {
    try {
    let body = ''; for await (const bytes of req) body += bytes;
    const request = JSON.parse(body || '{}');
    if (req.url.endsWith('/count_tokens')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"input_tokens":256}'); return; }
    const text = (request.messages ?? []).filter(message => message.role === 'user').flatMap(message => typeof message.content === 'string' ? [message.content] : (message.content ?? []).filter(block => block.type === 'text').map(block => block.text)).join('\n');
    if (text.includes('editor-paste-')) {
      assert.ok(text.includes(payload)); assert.equal(text.includes('discard-editor-edit'), false); received = true;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (event, value) => res.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
    send('message_start', { type: 'message_start', message: { id: 'editor', type: 'message', role: 'assistant', content: [], model: 'probe', stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } });
    send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: received ? 'editor-pty-ok' : 'editor-pty-ready' } });
    send('content_block_stop', { type: 'content_block_stop', index: 0 });
    send('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } });
    send('message_stop', { type: 'message_stop' }); res.end();
    } catch (error) { providerError = error; res.writeHead(500); res.end('fixture assertion failed'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(path.join(data, 'config.yaml'), `dataDir: ${data}\nlogLevel: info\ndataContribution:\n  enabled: false\nmemory:\n  enabled: false\ndefaultModel: custom_provider:probe/probe\ncustom_provider:\n  probe:\n    name: probe\n    kind: custom\n    enabled: true\n    api: anthropic-messages\n    options:\n      apiKey: synthetic-local-fixture\n      baseURL: http://127.0.0.1:${server.address().port}\n      authMode: api-key\n    models:\n      probe:\n        reasoning: false\n        limit:\n          context: 1048576\n          output: 4096\n`);
  const command = path.join(candidate, '..', 'mcode');
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  child = spawn('/usr/bin/script', ['-qfec', `${quote(command)} --model custom_provider:probe/probe editor-pty-start`, '/dev/null'], { cwd: workspace, env: { ...process.env, TERM: 'xterm-256color', MINIMAX_DATA_DIR: data, MCODE_CONFIG_DIR: data, MCODE_NO_MODIFY_PATH: '1' } });
  child.stdout.on('data', bytes => { output = (output + bytes).slice(-2 * 1024 * 1024); });
  child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-65536); });
  const exited = new Promise(resolve => child.on('exit', resolve));
  const wait = async (ready, label) => {
    const deadline = Date.now() + 30000;
    while (!ready()) {
      if (providerError) throw providerError;
      if (Date.now() > deadline || child.exitCode !== null) throw Error(`PTY ${label}: ${stderr}\n${output.slice(-3000)}`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  };
  try {
    // The startup owner disables submit even while the title says Ready.
    // A completed initial provider request proves its actual startup gate passed.
    await wait(() => output.includes('editor-pty-ready'), 'ready');
    child.stdin.write('\x1b[200~' + payload + '\x1b[201~');
    await wait(() => output.includes('paste #1'), 'paste marker');
    child.stdin.write(' discard-editor-edit');
    await wait(() => output.includes('discard-editor-edit'), 'edit');
    const undoOutputStart = output.length;
    // CSI-u disambiguates Ctrl+- from legacy Ctrl+_ / side-conversation keys.
    child.stdin.write('\x1b[45;5u');
    // Wait for a rendered undo before sending Enter: the terminal input owner
    // can deliver adjacent writes as one escape-key packet.
    await wait(() => output.slice(undoOutputStart).includes('[paste #1') && !output.slice(undoOutputStart).includes('discard-editor-edit'), 'undo render');
    child.stdin.write('\r');
    await wait(() => received && output.includes('editor-pty-ok'), 'successful submitted undo');
    child.stdin.write('/exit\r');
    let exitTimer;
    const code = await Promise.race([exited, new Promise((_, reject) => { exitTimer = setTimeout(() => reject(Error('PTY exit timeout')), 10000); })]).finally(() => clearTimeout(exitTimer));
    assert.equal(code, 0);
    const logs = path.join(data, 'v2', 'observability', 'logs');
    for (const name of fs.readdirSync(logs)) assert.doesNotMatch(fs.readFileSync(path.join(logs, name), 'utf8'), /\b(?:ERROR|FATAL):|Unhandled|unhandled rejection/);
    console.log('PASS production PTY: 256 KiB paste, edit, undo, expanded provider submission, clean exit');
  } finally {
    if (child.exitCode === null) {
      child.stdin.write('\x15/exit\r');
      let cleanupTimer;
      await Promise.race([exited, new Promise(resolve => { cleanupTimer = setTimeout(resolve, 3000); })]).finally(() => clearTimeout(cleanupTimer));
      if (child.exitCode === null) child.kill('SIGTERM');
    }
    // script(1) can leave its shell's application behind on an exceptional
    // exit. Only this uniquely owned cwd and exact candidate executable qualify.
    for (const pid of fs.readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
      const proc = `/proc/${pid}`;
      try {
        const identity = fs.readFileSync(`${proc}/stat`, 'utf8').split(') ')[1].split(' ')[19];
        if (fs.readlinkSync(`${proc}/cwd`) !== workspace || fs.readlinkSync(`${proc}/exe`) !== path.resolve(command)) continue;
        if (fs.readFileSync(`${proc}/stat`, 'utf8').split(') ')[1].split(' ')[19] !== identity) continue;
        process.kill(Number(pid), 'SIGTERM');
        const deadline = Date.now() + 3000;
        while (fs.existsSync(`${proc}/stat`) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
        if (fs.existsSync(`${proc}/stat`) && fs.readFileSync(`${proc}/stat`, 'utf8').split(') ')[1].split(' ')[19] === identity) process.kill(Number(pid), 'SIGKILL');
      } catch (error) { if (!['ENOENT', 'ESRCH', 'EACCES', 'EPERM'].includes(error.code)) throw error; }
    }
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.writeFileSync(path.join(scratch, 'pty-output.txt'), output);
    fs.writeFileSync(path.join(scratch, 'pty-stderr.txt'), stderr);
  }
}
console.log(`Editor memory contracts passed; fixture: ${scratch}`);

// Owned local provider + real CLI, isolated config/database/workspace, bounded fault workload.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const cliPath = process.argv[2] && path.resolve(process.argv[2]);
const scenario = process.argv[3] ?? 'recover';
const nativeCommand = text => process.platform === 'win32' ? `[System.IO.File]::AppendAllText('progress.txt', '${text}' + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))` : `printf '${text}\\n' >> progress.txt`;
if (!cliPath) throw Error('Usage: node native-retry-contracts.mjs <cli> <recover|exhaust|compact|compact-exhaust|soak>');
const root = fs.mkdtempSync(path.join(process.env.MCODE_TEST_TMP ?? (await import('node:os')).tmpdir(), 'mcode-native-retry-'));
const data = path.join(root, 'data'), workspace = path.join(root, 'workspace');
fs.mkdirSync(data); fs.mkdirSync(workspace);
const ledger = [], counts = new Map(), faults = [];
const started = Date.now(), soakRounds = Number(process.env.MCODE_SOAK_ROUNDS ?? 40);
assert.ok(Number.isInteger(soakRounds) && soakRounds >= 1 && soakRounds <= 80, 'MCODE_SOAK_ROUNDS must be 1..80');
const hasCompaction = scenario.startsWith('compact');
const tui = scenario.startsWith('tui-');
if (tui && process.platform !== 'linux') throw Error('PTY fixture is Linux-only');
let completed = 0, checkpointCompleted = 0, closedHangs = 0;
let controlStarted = false, controlSent = false, controlProofSent = false, ownedToolPid, cancellationAt;
let cli;
const memory = { platform: process.platform, intervalMs: 100, samples: [], phases: [], peak: {} };
const memoryKeys = ['rssKiB', 'pssKiB', 'privateKiB', 'anonymousPssKiB', 'swapKiB', 'swapPssKiB', 'rssAndSwapKiB', 'pssAndSwapPssKiB'];
function readMemory(pid) {
  try {
    const source = fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
    const value = key => Number(source.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'))?.[1] ?? 0);
    return { rssKiB: value('Rss'), pssKiB: value('Pss'), privateKiB: value('Private_Clean') + value('Private_Dirty'), anonymousPssKiB: value('Pss_Anon'), swapKiB: value('Swap'), swapPssKiB: value('SwapPss'), rssAndSwapKiB: value('Rss') + value('Swap'), pssAndSwapPssKiB: value('Pss') + value('SwapPss') };
  } catch { return undefined; } // An owned process may exit between discovery and sampling.
}
function sampleMemory(phase) {
  if (process.platform !== 'linux' || !cli?.pid) return;
  const descendants = pid => {
    try { return fs.readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim().split(/\s+/).filter(Boolean).map(Number).flatMap(id => [id, ...descendants(id)]); }
    catch { return []; }
  };
  const pids = descendants(cli.pid), parent = readMemory(cli.pid);
  if (!parent) return;
  const children = Object.fromEntries(memoryKeys.map(key => [key, 0]));
  for (const pid of pids) { const child = readMemory(pid); if (child) for (const key of memoryKeys) children[key] += child[key]; }
  const total = Object.fromEntries(memoryKeys.map(key => [key, parent[key] + children[key]]));
  const row = { atMs: Date.now() - started, pid: cli.pid, completed, parent, children, total, childCount: pids.length };
  if (phase) memory.phases.push({ phase, ...row });
  memory.samples.push(row);
  for (const [owner, values] of Object.entries({ parent, children, total })) {
    memory.peak[owner] ??= Object.fromEntries(memoryKeys.map(key => [key, 0]));
    for (const key of memoryKeys) memory.peak[owner][key] = Math.max(memory.peak[owner][key], values[key]);
  }
}
const controlTimers = [];
function cancelAndContinue() {
  if (controlSent) return;
  controlSent = true; cancellationAt = Date.now(); cli.stdin.write('\u001b');
  controlTimers.push(setTimeout(() => cli.stdin.write('control-next-request\r'), 1200));
}
const summary = '# Goal\nCreate useful work artifacts.\n# Instructions\nContinue the task.\n# Discoveries\nA local test is running.\n# Accomplished\nThe first artifact exists.\n# Remaining\nCreate the next artifact.\n# Relevant files\nprogress.txt\n# Other context\nIsolated fixture.\n# Current state\nContinue without input.';
const server = http.createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  const parsed = JSON.parse(body || '{}');
  if (req.url.endsWith('/count_tokens')) {
    ledger.push({ kind: 'count_tokens', service_tier: parsed.service_tier });
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ input_tokens: 256 })); return;
  }
  const isCheckpoint = JSON.stringify(parsed.messages?.at(-1)).includes('Checkpoint control: summarize');
  const auxiliary = tui && !parsed.tools?.some(tool => tool.name === 'bash');
  const logical = auxiliary ? 'auxiliary' : isCheckpoint ? 'checkpoint' : `work-${completed}`;
  const attempt = (counts.get(logical) ?? 0) + 1; counts.set(logical, attempt);
  const row = { kind: auxiliary ? 'auxiliary_generation' : 'generation', logical, attempt, atMs: Date.now() - started, messageCount: parsed.messages?.length, service_tier: parsed.service_tier };
  ledger.push(row);
  if (!auxiliary) sampleMemory(ledger.filter(item => item.kind === 'generation').length === 1 ? 'first-request' : logical);
  assert.equal(body.includes('failed-attempt-marker'), false, 'Failed attempt leaked into provider-bound history');
  const controlNext = tui && body.includes('control-next-request');
  if (tui && !auxiliary && !controlNext && !controlStarted) {
    controlStarted = true;
    if (scenario === 'tui-retry') {
      res.writeHead(503, { 'content-type': 'application/json', 'retry-after-ms': '30000' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'temporary unavailable' } }));
      controlTimers.push(setTimeout(cancelAndContinue, 500)); return;
    }
  }
  let fault;
  if (scenario === 'exhaust' || (scenario === 'compact-exhaust' && isCheckpoint)) fault = 'http503';
  else if (isCheckpoint && checkpointCompleted === 0 && attempt <= 2) fault = attempt === 1 ? 'http401' : 'partial-text';
  else if (scenario === 'recover' && completed === 0 && attempt <= 5) fault = ['http503', 'partial-text', 'partial-thinking', 'complete-tool', 'partial-tool'][attempt - 1];
  else if (scenario === 'recover' && completed === 1 && attempt === 1) fault = 'hang-partial';
  else if (scenario === 'first-event' && completed === 0 && attempt === 1) fault = 'hang-first';
  else if (scenario === 'soak' && completed < soakRounds && completed % 4 === 0 && attempt === 1) fault = ['http503', 'partial-text', 'complete-tool', 'hang-partial'][Math.floor(completed / 4) % 4];
  if (fault) { row.fault = fault; faults.push(fault); }
  if (fault === 'hang-first') { res.on('close', () => { closedHangs++; }); return; }
  if (fault?.startsWith('http')) {
    res.writeHead(Number(fault.slice(4)), { 'content-type': 'application/json', 'retry-after-ms': '10' }); res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'temporary unavailable' } })); return;
  }
  if (scenario === 'soak' && completed >= soakRounds) {
    // The real CLI is waiting for its final response after all useful tools ran.
    await new Promise(resolve => setTimeout(resolve, 1000));
    sampleMemory('post-work-provider-idle');
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'retry-after-ms': '10' });
  const send = (event, value) => res.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
  send('message_start', { type: 'message_start', message: { id: 'msg_' + ledger.length, type: 'message', role: 'assistant', content: [], model: 'probe', stop_reason: null, stop_sequence: null, usage: { input_tokens: hasCompaction && !isCheckpoint && completed === 0 ? 125000 : 1, output_tokens: 0 } } });
  const text = (value, thinking = false) => {
    send('content_block_start', { type: 'content_block_start', index: 0, content_block: thinking ? { type: 'thinking', thinking: '' } : { type: 'text', text: '' } });
    send('content_block_delta', { type: 'content_block_delta', index: 0, delta: thinking ? { type: 'thinking_delta', thinking: value } : { type: 'text_delta', text: value } });
    send('content_block_stop', { type: 'content_block_stop', index: 0 });
  };
  const tool = (command, partial = false) => {
    send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call_' + ledger.length, name: 'bash', input: {} } });
    const args = JSON.stringify({ command });
    send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: partial ? args.slice(0, 25) : args } });
    if (!partial) send('content_block_stop', { type: 'content_block_stop', index: 0 });
  };
  if (auxiliary) {
    text('Controlled useful work');
    send('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } });
    send('message_stop', { type: 'message_stop' }); res.end(); return;
  }
  if (tui) {
    if (!controlNext) {
      assert.equal(generationsBeforeControl(), 1, 'Cancelled operation unexpectedly retried');
      if (scenario === 'tui-request') {
        text('waiting-before-cancellation');
        res.on('close', () => { closedHangs++; });
        controlTimers.push(setTimeout(cancelAndContinue, 250)); return;
      }
      if (scenario === 'tui-tool') {
        tool('printf "%s" "$$" > owned-tool.pid; exec sleep 30');
        const poll = setInterval(() => {
          if (fs.existsSync(path.join(workspace, 'owned-tool.pid'))) {
            ownedToolPid = Number(fs.readFileSync(path.join(workspace, 'owned-tool.pid'), 'utf8'));
            clearInterval(poll); cancelAndContinue();
          }
        }, 25); controlTimers.push(poll);
      }
    } else if (!controlProofSent) {
      if (scenario === 'tui-request') assert.equal(closedHangs, 1, 'Provider connection still active during next turn');
      if (ownedToolPid) assert.throws(() => process.kill(ownedToolPid, 0), error => error.code === 'ESRCH');
      controlProofSent = true; tool('printf control-recovered > control-proof.txt');
    } else {
      text('control-next-complete');
      controlTimers.push(setTimeout(() => cli.stdin.write('/exit\r'), 700));
    }
    send('message_delta', { type: 'message_delta', delta: { stop_reason: controlNext && controlProofSent && fs.existsSync(path.join(workspace, 'control-proof.txt')) ? 'end_turn' : 'tool_use', stop_sequence: null }, usage: { output_tokens: 30 } });
    send('message_stop', { type: 'message_stop' }); res.end(); return;
  }
  if (fault) {
    if (fault.includes('tool')) tool(process.platform === 'win32' ? "[System.IO.File]::AppendAllText('forbidden.txt','failed-attempt-marker')" : 'printf failed-attempt-marker >> forbidden.txt', fault === 'partial-tool');
    else text('failed-attempt-marker', fault === 'partial-thinking');
    if (fault === 'hang-partial') { res.on('close', () => { closedHangs++; }); return; }
    send('error', { type: 'error', error: { type: 'api_error', message: 'upstream failed after partial output' } }); res.end(); return;
  }
  const limit = scenario === 'soak' ? soakRounds : 2;
  const final = completed >= limit;
  if (isCheckpoint) { text(summary); checkpointCompleted++; }
  else if (final) text('native-useful-work-complete');
  else { const round = ++completed; tool(nativeCommand(`round-${round}`) + (scenario === 'soak' ? (process.platform === 'win32' ? '; Start-Sleep 2' : '; sleep 2') : '')); }
  send('message_delta', { type: 'message_delta', delta: { stop_reason: isCheckpoint || final ? 'end_turn' : 'tool_use', stop_sequence: null }, usage: { output_tokens: 30 } });
  send('message_stop', { type: 'message_stop' }); res.end();
});
function generationsBeforeControl() { return ledger.filter(row => row.kind === 'generation').length; }
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const config = path.join(data, 'config.yaml');
fs.writeFileSync(config, `dataDir: ${data}\nlogLevel: info\ndataContribution:\n  enabled: false\nmemory:\n  enabled: false\ndefaultModel: custom_provider:probe/probe\ncustom_provider:\n  probe:\n    name: probe\n    kind: custom\n    enabled: true\n    api: anthropic-messages\n    options:\n      apiKey: synthetic-local-fixture\n      baseURL: http://127.0.0.1:${server.address().port}\n      authMode: api-key\n    models:\n      probe:\n        reasoning: false\n        limit:\n          context: 131072\n          output: 4096\n`);
fs.appendFileSync(config, '\npermissionMode: bypassPermissions\n');
const options = { cwd: workspace, env: { ...process.env, TERM: 'xterm-256color', MINIMAX_DATA_DIR: data, MCODE_CONFIG_DIR: data, MCODE_NO_MODIFY_PATH: '1', MCODE_LLM_FIRST_EVENT_TIMEOUT_MS: '1500', MCODE_LLM_STREAM_IDLE_TIMEOUT_MS: tui ? '0' : '500' } };
if (tui) {
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  const command = [cliPath, '--model', 'custom_provider:probe/probe', 'Start the controlled useful task.'].map(quote).join(' ');
  cli = spawn('/usr/bin/script', ['-qfec', command, '/dev/null'], options);
} else cli = spawn(cliPath, ['exec', '--cwd', workspace, '--config', config, '--model', 'custom_provider:probe/probe', '--permission', 'full', '--timeout', '240s', '--output-format', 'stream-json', 'Create useful work artifacts and continue until the staged workload is finished.'], options);
let stdout = '', stderr = '';
cli.stdout.on('data', bytes => { stdout += bytes; }); cli.stderr.on('data', bytes => { stderr += bytes; });
const memoryTimer = setInterval(sampleMemory, memory.intervalMs);
const timer = setTimeout(() => cli.kill('SIGKILL'), 250000);
const code = await new Promise(resolve => cli.on('exit', resolve)); clearTimeout(timer);
clearInterval(memoryTimer);
for (const timer of controlTimers) { clearTimeout(timer); clearInterval(timer); }
server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
fs.writeFileSync(path.join(root, 'stdout.jsonl'), stdout); fs.writeFileSync(path.join(root, 'stderr.txt'), stderr); fs.writeFileSync(path.join(root, 'ledger.json'), JSON.stringify(ledger, null, 2));
fs.writeFileSync(path.join(root, 'memory.json'), JSON.stringify(memory, null, 2));
const generations = ledger.filter(row => row.kind === 'generation');
assert.ok(ledger.length > 0, 'No provider requests observed');
for (const row of ledger) assert.equal(row.service_tier, 'priority', `${row.kind}/${row.logical ?? 'tokens'} must request priority`);
const lines = fs.existsSync(path.join(workspace, 'progress.txt')) ? fs.readFileSync(path.join(workspace, 'progress.txt'), 'utf8').trim().split(/\r?\n/) : [];
console.log(JSON.stringify({ root, scenario, code, durationMs: Date.now() - started, generations: generations.length, tokenCounts: ledger.filter(row => row.kind === 'count_tokens').length, auxiliaryGenerations: ledger.filter(row => row.kind === 'auxiliary_generation').length, counts: Object.fromEntries(counts), faults, closedHangs, artifactLines: lines.length, checkpointCompleted, memory: { samples: memory.samples.length, peak: memory.peak, phases: memory.phases, accounting: 'Linux smaps_rollup KiB; CLI parent and recursive children separately; privateKiB includes file and anonymous private pages; anonymousPssKiB is Pss_Anon; swap and SwapPss reported separately, RSS+Swap/PSS+SwapPss are computed per sample before peaks (not sums of independent peaks); JS heap is not exposed by production CLI; PTY parent is script' }, ...(tui ? { controlSent, controlProofSent, ownedToolPid, afterCancellationMs: Date.now() - cancellationAt } : {}) }));
assert.equal(fs.existsSync(path.join(workspace, 'forbidden.txt')), false);
assert.equal(stdout.includes('failed-attempt-marker'), false, 'Failed attempt leaked into transcript');
const sessionRoot = path.join(data, 'v2', 'sessions');
if (fs.existsSync(sessionRoot)) {
  for (const relative of fs.readdirSync(sessionRoot, { recursive: true })) {
    if (relative.endsWith('.jsonl')) assert.equal(fs.readFileSync(path.join(sessionRoot, relative), 'utf8').includes('failed-attempt-marker'), false, 'Failed attempt leaked into stored history');
  }
}
assert.equal(/unhandled(?: rejection| error)|uncaught exception|ReferenceError:|TypeError:|SyntaxError:/i.test(stderr), false, 'Unexpected runtime error in CLI diagnostics');
if (tui) { assert.equal(code, 0, stderr); assert.equal(controlSent, true); assert.equal(generations.length, 3); assert.equal(fs.readFileSync(path.join(workspace, 'control-proof.txt'), 'utf8'), 'control-recovered'); }
else if (scenario === 'exhaust') { assert.equal(code, 4); assert.equal(generations.length, 6); assert.equal(lines.length, 0); }
else if (scenario === 'compact-exhaust') {
  assert.equal(code, 0); assert.equal(counts.get('checkpoint'), 6); assert.equal(lines.length, 2);
  const logDir = path.join(data, 'v2/observability/logs');
  const logs = fs.readdirSync(logDir).map(name => fs.readFileSync(path.join(logDir, name), 'utf8')).join('\n');
  assert.ok(logs.includes('context_compaction_failed')); assert.ok(logs.includes('CHECKPOINT_PROVIDER_FAILED'));
}
else {
  assert.equal(code, 0, stderr.slice(-1500));
  assert.deepEqual(lines, Array.from({ length: scenario === 'soak' ? soakRounds : 2 }, (_, index) => `round-${index + 1}`));
  assert.ok(stdout.includes('native-useful-work-complete'));
  if (scenario === 'recover') { assert.equal(generations.length, 9); assert.equal(closedHangs, 1); }
  if (scenario === 'first-event') { assert.equal(generations.length, 4); assert.equal(closedHangs, 1); }
  if (hasCompaction) { assert.ok(checkpointCompleted >= 1); assert.equal(counts.get('checkpoint'), 3); }
  if (scenario === 'soak') {
    assert.equal(generations.length, soakRounds + 1 + Math.ceil(soakRounds / 4));
    assert.ok([...counts.values()].every(attempts => attempts <= 2), 'Soak retries exceeded the injected single-failure budget');
    if (process.platform === 'linux') assert.ok(memory.phases.some(row => row.phase === 'post-work-provider-idle'));
  }
}

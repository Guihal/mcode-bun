// Test actual installed functions through disposable exports; no live user state.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const pkg = process.argv[2];
if (!pkg) throw Error('Usage: bun tests/retry.mjs <patched-package>');
const fixtureRoot = fs.mkdtempSync((process.env.MCODE_TEST_TMP ?? (await import('node:os')).tmpdir()) + '/mcode-retry-');
const dir = fixtureRoot + '/package';
fs.mkdirSync(dir);
fs.cpSync(`${pkg}/../runtime`, `${fixtureRoot}/runtime`, { recursive: true });
fs.mkdirSync(`${dir}/chunks`);
fs.writeFileSync(`${dir}/package.json`, '{"type":"module"}');
fs.cpSync(`${pkg}/node_modules`, `${dir}/node_modules`, { recursive: true, dereference: true });
for (const name of fs.readdirSync(`${pkg}/chunks`)) {
  if (name !== 'chunk-47KWM23C.js') fs.copyFileSync(`${pkg}/chunks/${name}`, `${dir}/chunks/${name}`);
}
const source = fs.readFileSync(process.env.MCODE_RETRY_SOURCE ?? `${pkg}/chunks/chunk-47KWM23C.js`, 'utf8');
const exports = 'export {rB as retry,cQ as checkpoint,yX as checkpointSession,oWe as runnerState' + (source.includes('mcodeRetryOwned') ? ',mcodeRetryOwned as owned' : '') + '};';
fs.writeFileSync(`${dir}/chunks/chunk-47KWM23C.js`, source + '\n' + exports);
const { retry, checkpoint, checkpointSession, runnerState, owned } = await import(`${dir}/chunks/chunk-47KWM23C.js`);
const model = { id: 'probe', name: 'probe', provider: 'other-provider', api: 'anthropic-messages', contextWindow: 131072, maxTokens: 4096 };
const message = (stopReason = 'stop', errorMessage, content = [{ type: 'text', text: 'successful-answer' }]) => ({ role: 'assistant', content, api: model.api, provider: model.provider, model: model.id, stopReason, errorMessage, timestamp: 0, usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3 } });
const stream = (final, events = [{ type: 'start', partial: final }, { type: final.stopReason === 'error' ? 'error' : 'done', error: final, message: final }]) => ({ async *[Symbol.asyncIterator]() { yield* events; }, result: async () => final });
const config = { sessionId: 'test', turnId: 'test', scope: 'agent', sleep: async () => {}, random: () => 1 };
const collect = async value => ({ events: await Array.fromAsync(value), final: await value.result() });
let passed = 0;
const check = async (name, run) => { await run(); passed++; console.log('PASS ' + name); };
await check('all-provider-families-six-attempts-last-attempt-recovery-no-sdk-retry', async () => {
  for (const error of ['unknown provider fault', 'temporary unavailable', 'quota exceeded', 'insufficient credits', 'content filter refusal', 'LLM_AUTH_ERROR', ...[400, 401, 403, 404, 429, 500, 503, 529].map(status => `HTTP ${status} upstream error`)]) {
    let attempts = 0;
    const fn = retry(async (_, __, options) => { assert.equal(options.maxRetries, 0); return stream(++attempts < 6 ? message('error', error) : message()); }, config);
    const result = await collect(await fn(model, { messages: [] }));
    assert.equal(attempts, 6, error); assert.equal(result.final.stopReason, 'stop');
    assert.deepEqual(result.events.map(event => event.type), ['start', 'done']);
  }
});
await check('status-response-plain-throws-and-iterator-result-failures', async () => {
  for (const kind of ['plain', 'iterator', 'result', 'http']) {
    let attempts = 0;
    const fn = retry(async (_, __, options) => {
      if (++attempts === 6) return stream(message());
      if (kind === 'plain') throw 'unclassified-string-failure';
      if (kind === 'http') { await options.onResponse({ status: 401, headers: {} }); throw Object.assign(Error('denied'), { status: 401 }); }
      return { async *[Symbol.asyncIterator]() { yield { type: 'start', partial: message() }; yield { type: 'text_delta', delta: 'discarded-text', partial: message() }; if (kind === 'iterator') throw Error('iterator failure'); }, result: async () => { throw Error('result failure'); } };
    }, config);
    const result = await collect(await fn(model, { messages: [] }));
    assert.equal(attempts, 6); assert.equal(JSON.stringify(result).includes('discarded-text'), false);
  }
});
await check('exhaustion-discards-failed-text-thinking-tools-retains-error-usage', async () => {
  let attempts = 0;
  const fn = retry(async () => { attempts++; return stream(message('error', 'temporary unavailable', [{ type: 'text', text: 'discard-me' }, { type: 'thinking', thinking: 'discard-thinking' }, { type: 'toolCall', id: 'bad', name: 'bash', arguments: { command: 'false' } }])); }, config);
  const result = await collect(await fn(model, { messages: [] }));
  assert.equal(attempts, 6); assert.deepEqual(result.final.content, []); assert.equal(result.final.errorMessage, 'temporary unavailable'); assert.equal(result.final.usage.output, 2);
  assert.equal(JSON.stringify(result.events).includes('discard-'), false);
});
await check('elapsed-time-cannot-truncate-five-repeats', async () => {
  let attempts = 0, clock = 0;
  const fn = retry(async (_, __, options) => { attempts++; clock += 300000; await options.onResponse({ status: 503, headers: { 'retry-after': '30' } }); return stream(message('error', 'HTTP 503')); }, { ...config, nowMs: () => clock, sleep: async delay => { assert.equal(delay, 30000); clock += delay; } });
  await collect(await fn(model, { messages: [] })); assert.equal(attempts, 6);
});
await check('cancel-real-backoff-and-no-retry-on-explicit-abort', async () => {
  const controller = new AbortController(); let attempts = 0, waiting;
  const ready = new Promise(resolve => { waiting = resolve; });
  const fn = retry(async () => { attempts++; return stream(message('error', 'HTTP 503')); }, { ...config, sleep: undefined, observer: async event => { if (event.status === 'waiting') waiting(); } });
  const running = fn(model, { messages: [] }, { signal: controller.signal });
  await ready; const started = Date.now(); controller.abort(Error('user stop'));
  await assert.rejects(running, /user stop/); assert.equal(attempts, 1); assert.ok(Date.now() - started < 500);
  attempts = 0;
  const caller = new AbortController();
  const aborted = retry(async () => { attempts++; caller.abort(Error('operator cancellation')); return stream(message('aborted')); }, config);
  assert.equal((await collect(await aborted(model, { messages: [] }, { signal: caller.signal }))).final.stopReason, 'aborted'); assert.equal(attempts, 1);
});
await check('provider-abort-text-direct-nested-and-terminal-errors-retry-without-caller-cancellation', async () => {
  for (const kind of ['text', 'direct', 'nested', 'terminal']) {
    let attempts = 0;
    const fn = retry(async () => {
      if (++attempts === 6) return stream(message());
      if (kind === 'text') return stream(message('error', 'request was aborted by upstream'));
      if (kind === 'terminal') return stream(message('aborted', 'provider ended generation'));
      const error = new DOMException('upstream disconnected', 'AbortError');
      throw kind === 'nested' ? new Error('provider wrapper', { cause: error }) : error;
    }, config);
    const result = await collect(await fn(model, { messages: [] }));
    assert.equal(attempts, 6, kind); assert.equal(result.final.stopReason, 'stop', kind);
  }
  let attempts = 0, settled;
  const fn = retry(async () => { attempts++; return stream(message('aborted', 'request was aborted by upstream')); }, { ...config, onCallSettled: event => { settled = event; } });
  const result = await collect(await fn(model, { messages: [] }));
  assert.equal(attempts, 6); assert.equal(result.final.stopReason, 'error'); assert.equal(settled.final.outcome, 'error');
});
await check('native-checkpoint-exhausts-six-bare-adapter-retains-one-retry', async () => {
  let attempts = 0;
  const fn = retry(async () => { attempts++; return stream(message('error', 'HTTP 503')); }, config);
  const session = await checkpointSession({ model, streamFn: fn, providerInputLimit: 100000, maxOutputTokens: 4096 });
  const args = { input: {}, session, candidate: 'h0', counter: { value: 0 }, messages: [{ role: 'user', content: [{ type: 'text', text: 'summarize' }], timestamp: 0 }] };
  await assert.rejects(checkpoint(args), error => error.code === 'CHECKPOINT_PROVIDER_FAILED'); assert.equal(attempts, 6);
  let bare = 0;
  const result = await checkpoint({ ...args, counter: { value: 0 }, session: { generate: async () => ++bare === 1 ? { stopReason: 'error' } : { stopReason: 'stop', text: 'checkpoint' } } });
  assert.equal(bare, 2); assert.equal(result.generation.text, 'checkpoint');
});
await check('shared-prefix-distinct-isolated-fallback-has-separate-six-budget', async () => {
  let attempts = 0; const shapes = [];
  const fn = retry(async (_, context) => {
    shapes.push(context.systemPrompt); attempts++;
    if (attempts !== 6 && attempts !== 12) return stream(message('error', 'HTTP 503'));
    return stream(attempts === 6 ? message('toolUse', undefined, [{ type: 'toolCall', id: 'compat', name: 'bash', arguments: {} }]) : message());
  }, config);
  const session = await checkpointSession({ model, streamFn: fn, providerInputLimit: 100000, maxOutputTokens: 4096, sharedPrefix: { sessionId: 'test', systemPrompt: 'shared-prefix-marker', tools: [], projectRequestMedia: messages => messages } });
  const result = await session.generate({ messages: [{ role: 'user', content: [{ type: 'text', text: 'history' }], timestamp: 0 }] });
  assert.equal(result.stopReason, 'stop'); assert.equal(attempts, 12); assert.ok(shapes.slice(0, 6).every(value => value === 'shared-prefix-marker')); assert.ok(shapes.slice(6).every(value => value !== 'shared-prefix-marker'));
});
await check('metrics-capture-wrappers-preserve-native-checkpoint-ownership', async () => {
  const wrap = fn => (...args) => fn(...args);
  const state = runnerState({ llm: { model }, sessionId: 'test', turnId: 'test', workspaceDir: dir, llmRetry: {}, toolConfig: { tools: [], disableBuiltinToolFallback: true } }, { metrics: { wrapStreamFn: wrap, wrapLogicalStreamFn: wrap }, llmCapture: { wrapLogicalStreamFn: wrap } });
  assert.equal(state.auxiliaryStreamFn[owned], true);
});
await check('long-stream-keeps-no-cumulative-event-buffer', async () => {
  global.gc?.(); const before = process.memoryUsage().heapUsed;
  const fn = retry(async () => ({ async *[Symbol.asyncIterator]() { for (let i = 0; i < 3000; i++) yield { type: 'text_delta', delta: 'x', partial: message('stop', undefined, [{ type: 'text', text: Buffer.from(String(i) + 'x'.repeat(65536)).toString() }]) }; }, result: async () => { global.gc?.(); assert.ok(process.memoryUsage().heapUsed - before < 32 * 1024 * 1024, 'Retained cumulative snapshots at request settlement'); return message(); } }), config);
  const result = await collect(await fn(model, { messages: [] })); global.gc?.();
  assert.equal(result.events.length, 2); assert.ok(process.memoryUsage().heapUsed - before < 32 * 1024 * 1024); assert.equal(result.final.content[0].text, 'successful-answer');
});
console.log(`Retry contracts: ${passed} passed; fixture: ${dir}`);

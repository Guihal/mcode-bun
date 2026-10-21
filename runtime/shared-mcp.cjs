'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
// Match the existing mcode stdio factory (g_r), including image results.
const MAX_LINE = 64 * 1024 * 1024;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function privateDirectory(directory) {
  try { fs.mkdirSync(directory, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700 || fs.realpathSync(directory) !== directory) throw Error('Unsafe shared MCP directory');
  return directory;
}
// The Bun executable is large. Stream it through a fixed buffer rather than
// allocating a complete interpreter image for each connection.
function fileDigest(file) {
  const hash = crypto.createHash('sha256'), buffer = Buffer.allocUnsafe(64 * 1024);
  const fd = fs.openSync(file, 'r');
  try { let size; while ((size = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, size)); }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
function endpoint(options) {
  const uid = process.getuid();
  const base = process.env.XDG_RUNTIME_DIR ?? `/run/user/${uid}`;
  const stat = fs.lstatSync(base);
  if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o777) !== 0o700 || fs.realpathSync(base) !== base) throw Error('Unsafe shared MCP runtime directory');
  const directory = privateDirectory(path.join(base, 'mcode-mcp'));
  const supplied = options.env ?? {};
  const command = options.command.includes('/') ? fs.realpathSync(options.command) : supplied.PATH?.split(path.delimiter).map(dir => path.join(dir, options.command)).find(file => { try { fs.accessSync(file, fs.constants.X_OK); return true; } catch { return false; } });
  if (!command) throw Error('Shared MCP command not found');
  const executable = fs.realpathSync(command);
  const args = options.args ?? [];
  // Explicit profile for receipt-only servers: they consume neither workspace
  // nor ambient capabilities. Do not inherit a client's private tools broker,
  // data directory, session tokens or loader environment into this daemon.
  const profile = supplied.MCODE_SHARED_MCP_PROFILE ?? 'scoped-v1';
  // Probe has data-root authority, but no workspace/session/broker authority.
  // Preserve its intentionally literal environment values without expansion.
  const environment = profile === 'receipt-v1' ? {} : profile === 'probe-v1'
    ? Object.fromEntries(['MINIMAX_DATA_DIR', 'PROBE_LITERAL', 'PROBE_EXPANDED'].filter(key => Object.hasOwn(supplied, key)).map(key => [key, supplied[key]]))
    : profile === 'playwright-v1'
    ? Object.fromEntries(Object.entries(supplied).filter(([key]) => !key.startsWith('__MAVIS_MCODE_TOOLS_')))
    : supplied;
  const cwd = ['receipt-v1', 'probe-v1'].includes(profile) ? '/' : fs.realpathSync(options.cwd);
  // Partition ambient/configured authority as well as cwd. No first client's
  // environment or workspace is silently reused for a differently scoped one.
  // Interpreter launches identify their entry bytes as well. Dependencies are
  // deployed under immutable generation paths; entry changes at the same path
  // still select a new endpoint, without evicting a live old generation.
  const entry = /^(?:bun|node)(?:\.exe)?$/.test(path.basename(executable)) && args[0] && !args[0].startsWith('-')
    ? fs.realpathSync(path.resolve(options.cwd, args[0])) : undefined;
  const key = crypto.createHash('sha256').update(JSON.stringify({ executable, executableDigest: fileDigest(executable), entry, entryDigest: entry ? fileDigest(entry) : undefined, args, profile, cwd, env: Object.entries(environment).sort(([a],[b]) => a.localeCompare(b)) })).digest('hex').slice(0, 40);
  const socketPath = path.join(directory, key + '.sock');
  if (Buffer.byteLength(socketPath) > 103) throw Error('Shared MCP socket path is too long');
  return { executable, args, socketPath, environment, cwd };
}
function validateSocket(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isSocket() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600) throw Error('Unsafe shared MCP socket');
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
}
function connect(file) {
  validateSocket(file);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(file);
    const fail = error => { socket.destroy(); reject(error); };
    socket.once('error', fail);
    socket.setTimeout(500, () => fail(Error('Shared MCP connect timeout')));
    socket.once('connect', () => { socket.off('error', fail); socket.setTimeout(0); resolve(socket); });
  });
}
class SharedMcpTransport {
  constructor(options) { this.options = options; this.started = false; this.closed = false; this.parts = []; this.buffered = 0; this.partUsed = 0; this.maxLine = options.maxBufferSize ?? MAX_LINE; if (!Number.isSafeInteger(this.maxLine) || this.maxLine < 1 || this.maxLine > MAX_LINE) throw Error('Unsupported shared MCP frame capacity'); }
  get stderr() { return null; }
  async start() {
    if (this.started) throw Error('Shared MCP transport already started');
    this.started = true;
    const { executable, args, socketPath, environment, cwd } = endpoint(this.options);
    this.socketPath = socketPath;
    const deadline = Date.now() + 8000;
    let nextSpawn = 0, spawnError;
    while (!this.closed) {
      try {
        const socket = await connect(socketPath);
        if (this.closed) { socket.destroy(); throw Error('Shared MCP transport closed while connecting'); }
        this.socket = socket;
        socket.on('data', bytes => this.receive(bytes));
        socket.on('error', error => this.onerror?.(error));
        socket.once('close', () => {this.closed = true; this.onclose?.(); });
        return;
      } catch (error) {
        if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error;
        if (Date.now() >= deadline) throw spawnError ?? Error('Shared MCP startup timed out');
        if (Date.now() >= nextSpawn) {
          const child = spawn(executable, [...args, '--shared-socket', socketPath], { cwd, env: environment, detached: true, stdio: 'ignore', shell: false });
          child.once('error', error => { spawnError = error; }); child.unref();
          nextSpawn = Date.now() + 250;
        }
        await delay(25);
      }
    }
    throw Error('Shared MCP transport closed while connecting');
  }
  receive(bytes) {
    try {
      let offset = 0;
      while (offset < bytes.length) {
        const newline = bytes.indexOf(10, offset), end = newline === -1 ? bytes.length : newline;
        if (this.buffered + end - offset + (newline === -1 ? 0 : 1) > this.maxLine) throw Error('Shared MCP input exceeds its frame capacity');
        let position = offset;
        while (position < end) {
          let part = this.parts.at(-1);
          if (!part || this.partUsed === part.length) {
            part = Buffer.allocUnsafe(Math.min(64 * 1024, this.maxLine - this.buffered));
            this.parts.push(part); this.partUsed = 0;
          }
          const length = Math.min(end - position, part.length - this.partUsed);
          bytes.copy(part, this.partUsed, position, position + length);
          position += length; this.partUsed += length; this.buffered += length;
        }
        if (newline !== -1) {
          const frame = Buffer.concat(this.parts, this.buffered);
          this.parts = []; this.buffered = 0; this.partUsed = 0;
          const message = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(frame));
          this.onmessage?.(message);
        }
        offset = newline === -1 ? bytes.length : newline + 1;
      }
    } catch (error) { this.onerror?.(error); void this.close(); }
  }
  async send(message) {
    const line = JSON.stringify(message) + '\n';
    if (Buffer.byteLength(line) > this.maxLine) throw Error('Shared MCP output exceeds its frame capacity');
    if (this.closed || !this.socket) throw Error('Shared MCP transport is not connected');
    if (this.socket.writableLength + Buffer.byteLength(line) > 2 * this.maxLine) throw Error('Shared MCP output queue is full');
    const socket = this.socket;
    await new Promise((resolve, reject) => {
      let done = false;
      const onClose = () => finish(Error('Shared MCP peer closed during write'));
      const finish = error => {
        if (done) return; done = true; clearTimeout(timer);
        socket.off('close',onClose); socket.off('error',finish);
        error ? reject(error) : resolve();
      };
      const timer = setTimeout(() => { finish(Error('Shared MCP write timeout')); socket.destroy(); },5000);
      socket.once('close',onClose); socket.once('error',finish);
      try { socket.write(line,finish); } catch (error) { finish(error); }
    });
  }
  async close() {
    this.closed = true;
    this.parts = []; this.buffered = 0; this.partUsed = 0;
    const socket = this.socket;
    if (!socket || socket.destroyed) return;
    await new Promise(resolve => {
      let done = false;
      const finish = () => { if (done) return; done = true; clearTimeout(timer); socket.off('close',finish); resolve(); };
      const timer = setTimeout(() => { finish(); socket.destroy(); },1000);
      socket.once('close',finish); socket.end();
    });
  }
}
module.exports = { SharedMcpTransport, endpoint, fileDigest };

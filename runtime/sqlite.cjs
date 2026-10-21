// Synchronous compatibility boundary for MiniMax Code 0.6.12 on Bun 1.4.3.
const { DatabaseSync } = require('node:sqlite');
const { existsSync } = require('node:fs');
const { randomUUID } = require('node:crypto');

const primaryCodes = ['SQLITE_OK', 'SQLITE_ERROR', 'SQLITE_INTERNAL', 'SQLITE_PERM',
  'SQLITE_ABORT', 'SQLITE_BUSY', 'SQLITE_LOCKED', 'SQLITE_NOMEM', 'SQLITE_READONLY',
  'SQLITE_INTERRUPT', 'SQLITE_IOERR', 'SQLITE_CORRUPT', 'SQLITE_NOTFOUND', 'SQLITE_FULL',
  'SQLITE_CANTOPEN', 'SQLITE_PROTOCOL', 'SQLITE_EMPTY', 'SQLITE_SCHEMA', 'SQLITE_TOOBIG',
  'SQLITE_CONSTRAINT', 'SQLITE_MISMATCH', 'SQLITE_MISUSE', 'SQLITE_NOLFS', 'SQLITE_AUTH',
  'SQLITE_FORMAT', 'SQLITE_RANGE', 'SQLITE_NOTADB', 'SQLITE_NOTICE', 'SQLITE_WARNING'];
const extendedCodes = new Map();
for (const [primary, names] of [[19, ['CHECK', 'COMMITHOOK', 'FOREIGNKEY', 'FUNCTION',
  'NOTNULL', 'PRIMARYKEY', 'TRIGGER', 'UNIQUE', 'VTAB', 'ROWID', 'PINNED', 'DATATYPE']],
  [5, ['RECOVERY', 'SNAPSHOT', 'TIMEOUT']], [6, ['SHAREDCACHE', 'VTAB']],
  [8, ['RECOVERY', 'CANTLOCK', 'ROLLBACK', 'DBMOVED', 'CANTINIT', 'DIRECTORY']]]) {
  names.forEach((name, index) => extendedCodes.set(primary | ((index + 1) << 8), `${primaryCodes[primary]}_${name}`));
}
function sqliteError(error) {
  if (!Number.isInteger(error?.errcode) || error.code !== 'ERR_SQLITE_ERROR') return error;
  const translated = new Error(error.message, { cause: error });
  translated.name = 'SqliteError';
  translated.code = extendedCodes.get(error.errcode) ?? primaryCodes[error.errcode & 255] ?? 'SQLITE_ERROR';
  translated.errcode = error.errcode;
  translated.errstr = error.errstr;
  return translated;
}
function call(fn) { try { return fn(); } catch (error) { throw sqliteError(error); } }
function argsFor(args) { return args.flatMap(value => Array.isArray(value) ? value : [value]); }
function valueFor(value, safe) {
  if (typeof value === 'bigint') return safe ? value : Number(value);
  if (value instanceof Uint8Array && !Buffer.isBuffer(value)) return Buffer.from(value);
  return value;
}
function rowFor(row, safe) {
  if (row === undefined) return undefined;
  if (Array.isArray(row)) return row.map(value => valueFor(value, safe));
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, valueFor(value, safe)]));
}
class Statement {
  constructor(db, sql) {
    this.database = db;
    this.source = sql;
    this.stmt = call(() => db.sqlite.prepare(sql));
    this.stmt.setReadBigInts(true);
    this.stmt.setAllowBareNamedParameters(true);
    this.stmt.setAllowUnknownNamedParameters(true);
    this.safe = false;
    this.bound = null;
  }
  raw(enabled = true) { this.stmt.setReturnArrays(enabled); return this; }
  safeIntegers(enabled = true) { this.safe = enabled; return this; }
  bind(...args) { this.bound = argsFor(args); return this; }
  run(...args) {
    const result = call(() => this.stmt.run(...(this.bound ?? argsFor(args))));
    return { changes: Number(result.changes), lastInsertRowid: this.safe ? BigInt(result.lastInsertRowid) : Number(result.lastInsertRowid) };
  }
  all(...args) { return call(() => this.stmt.all(...(this.bound ?? argsFor(args)))).map(row => rowFor(row, this.safe)); }
  get(...args) { return rowFor(call(() => this.stmt.get(...(this.bound ?? argsFor(args)))), this.safe); }
  *iterate(...args) {
    try {
      for (const row of this.stmt.iterate(...(this.bound ?? argsFor(args)))) yield rowFor(row, this.safe);
    } catch (error) { throw sqliteError(error); }
  }
}
class Database {
  constructor(path = ':memory:', options = {}) {
    if (options.fileMustExist && !existsSync(path) && path !== ':memory:') {
      const error = new Error(`unable to open database file: ${path}`);
      error.code = 'SQLITE_CANTOPEN'; throw error;
    }
    const timeout = options.timeout ?? 5000;
    if (!Number.isInteger(timeout) || timeout < 0 || timeout > 2147483647) throw new RangeError('Invalid SQLite timeout');
    this.sqlite = call(() => new DatabaseSync(path, {
      readOnly: !!options.readonly, timeout, enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false, allowBareNamedParameters: true,
      allowUnknownNamedParameters: true,
    }));
    this.name = path;
    this.readonly = !!options.readonly;
  }
  get open() { return this.sqlite.isOpen; }
  get inTransaction() { return this.sqlite.isTransaction; }
  prepare(sql) { return new Statement(this, sql); }
  exec(sql) { call(() => this.sqlite.exec(sql)); return this; }
  pragma(sql, options = {}) {
    const statement = this.prepare(`PRAGMA ${sql}`);
    if (options.simple) return statement.raw().get()?.[0];
    return statement.all();
  }
  transaction(fn) {
    if (typeof fn !== 'function') throw new TypeError('Expected first argument to be a function');
    const db = this;
    const wrap = mode => function (...args) {
      const nested = db.inTransaction;
      const savepoint = `mcode_bun_${randomUUID().replaceAll('-', '')}`;
      db.exec(nested ? `SAVEPOINT ${savepoint}` : `BEGIN${mode ? ' ' + mode : ''}`);
      try {
        const result = fn.apply(this, args);
        if (result && typeof result.then === 'function') throw new TypeError('Transaction function cannot return a promise');
        db.exec(nested ? `RELEASE ${savepoint}` : 'COMMIT');
        return result;
      } catch (error) {
        if (db.inTransaction) {
          try {
            db.exec(nested ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : 'ROLLBACK');
          } catch (cleanupError) {
            // Keep callback/commit failure identity; attach cleanup context without replacing it.
            if (error && (typeof error === 'object' || typeof error === 'function')) {
              try { Object.defineProperty(error, 'rollbackError', { value: cleanupError, configurable: true }); } catch {}
            }
          }
        }
        throw error;
      }
    };
    const modes = { default: wrap(''), deferred: wrap('DEFERRED'), immediate: wrap('IMMEDIATE'), exclusive: wrap('EXCLUSIVE') };
    for (const transaction of Object.values(modes)) {
      for (const [name, value] of Object.entries(modes)) Object.defineProperty(transaction, name, { value });
      Object.defineProperty(transaction, 'database', { value: db, enumerable: true });
    }
    return modes.default;
  }
  async backup(path) {
    this.prepare('VACUUM INTO ?').run(path);
    return { totalPages: this.pragma('page_count', { simple: true }), remainingPages: 0 };
  }
  close() { if (this.open) call(() => this.sqlite.close()); return this; }
}
module.exports = Database;
module.exports.default = Database;

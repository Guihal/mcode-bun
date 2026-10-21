// Differential contracts for the synchronous SQLite surface used by MCode 0.6.12.
const assert = require('node:assert/strict');
const D = require(process.env.MCODE_TEST_DRIVER);
const fs = require('node:fs');
const dir = fs.mkdtempSync(require('node:path').join(process.env.MCODE_TEST_TMP ?? require('node:os').tmpdir(), 'mcode-sqlite-'));
const passed = [], failed = [];

async function test(name, run) {
  const connections = [];
  const open = (file = name + '.sqlite', options) => {
    const db = new D(`${dir}/${file}`, options);
    connections.push(db);
    return db;
  };
  try { await run(open); passed.push(name); }
  catch (error) { failed.push({ name, error }); }
  finally {
    for (const db of connections.reverse()) {
      try { if (db.open) db.close(); }
      catch (error) { failed.push({ name: name + ' close', error }); }
    }
  }
}

(async () => {
  await test('first-row-positional-and-toggle', open => {
    const d = open();
    let visits = 0;
    const count = value => { visits++; return value; };
    if (d.sqlite) d.sqlite.function('visit', count); else d.function('visit', count);
    const statement = d.prepare('WITH RECURSIVE t(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM t WHERE n<1000) SELECT visit(n) AS x,n+10 AS x,n+20 AS "0" FROM t');
    assert.deepEqual(statement.raw().get(), [1, 11, 21]);
    assert.equal(visits, 1, 'get must not visit later rows');
    assert.deepEqual(statement.raw(false).get(), { x: 11, 0: 21 });
    assert.equal(visits, 2);
    assert.deepEqual(statement.raw().get(), [1, 11, 21]);
    assert.equal(statement.database, d);
    assert.match(statement.source, /RECURSIVE/);
    assert.deepEqual(d.prepare('SELECT ? AS x, :named AS y').get({ named: 'b' }, 'a'), { x: 'a', y: 'b' });
    assert.deepEqual(d.prepare('SELECT @n AS n').bind({ n: 3 }).raw().get(), [3]);
    assert.deepEqual(d.prepare('SELECT ? AS n').get([4]), { n: 4 });
  });
  await test('integer-modes-all-shapes', open => {
    const d = open();
    const big = 9007199254740993n;
    d.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, f REAL)');
    const result = d.prepare('INSERT INTO t VALUES(?,1.5)').safeIntegers().run(big);
    assert.deepEqual(result, { changes: 1, lastInsertRowid: big });
    for (const raw of [false, true]) for (const safe of [false, true]) {
      const s = d.prepare('SELECT id, f FROM t').raw(raw).safeIntegers(safe);
      const row = raw ? [safe ? big : Number(big), 1.5] : { id: safe ? big : Number(big), f: 1.5 };
      assert.deepEqual(s.get(), row);
      assert.deepEqual(s.all(), [row]);
      assert.deepEqual([...s.iterate()], [row]);
      s.safeIntegers(!safe);
      assert.equal(typeof (raw ? s.get()[0] : s.get().id), safe ? 'number' : 'bigint');
    }
  });
  await test('defaults-and-programming-errors', open => {
    const d = open();
    assert.equal(d.pragma('foreign_keys', { simple: true }), 1);
    assert.throws(() => d.prepare('SELECT "missing"'), error => error.code === 'SQLITE_ERROR');
    assert.throws(() => d.prepare('SELECT FROM'), error => error.code === 'SQLITE_ERROR');
    assert.deepEqual(d.prepare('SELECT :n AS n').get({ n: 1, ignored: 2 }), { n: 1 });
    assert.throws(() => d.transaction(3), TypeError);
    assert.throws(() => d.prepare('SELECT ?').get(Symbol('invalid')), TypeError);
    assert.equal(d.name.endsWith('defaults-and-programming-errors.sqlite'), true);
    assert.equal(d.readonly, false); assert.equal(d.open, true);
    d.close(); assert.equal(d.open, false);
  });
  await test('returning-committed-and-rolled-back-effects', open => {
    const d = open();
    d.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, val TEXT)');
    assert.deepEqual(d.prepare('INSERT INTO t(val) VALUES (?),(?) RETURNING id,val').raw().get('a', 'b'), [1, 'a']);
    assert.equal(d.prepare('SELECT count(*) AS n FROM t').get().n, 2);
    assert.deepEqual(d.prepare('UPDATE t SET val=? RETURNING id,val').raw().get('c'), [1, 'c']);
    assert.deepEqual(d.prepare('SELECT val FROM t').all(), [{ val: 'c' }, { val: 'c' }]);
    assert.throws(() => d.transaction(() => { d.prepare('INSERT INTO t(val) VALUES (?) RETURNING id').raw().get('discard'); throw Error('abort'); })(), /abort/);
    assert.equal(d.prepare('SELECT count(*) AS n FROM t').get().n, 2);
  });
  await test('transaction-receiver-promises-and-self-rollback', open => {
    const d = open(); d.exec('CREATE TABLE t(id INTEGER)');
    const receiver = { value: 11 };
    const tx = d.transaction(function (value) { assert.equal(this, receiver); d.prepare('INSERT INTO t VALUES(?)').run(value); return this.value; });
    for (const mode of ['default', 'deferred', 'immediate', 'exclusive']) {
      assert.equal(tx[mode].call(receiver, 4), 11); assert.equal(d.inTransaction, false); assert.equal(tx[mode].database, d);
    }
    assert.throws(() => d.transaction(() => { d.exec('INSERT INTO t VALUES(5)'); return Promise.resolve(); })(), /promise/i);
    const original = Error('original');
    assert.throws(() => d.transaction(() => { d.exec('ROLLBACK'); throw original; })(), error => error === original);
    assert.equal(d.inTransaction, false);
    assert.equal(d.prepare('SELECT count(*) AS n FROM t').get().n, 4);
  });
  await test('raw-iteration-and-late-error', open => {
    const d = open();
    assert.deepEqual([...d.prepare('SELECT 1 AS x UNION ALL SELECT 2').raw().iterate()], [[1], [2]]);
    for (const row of d.prepare('SELECT 1 AS x UNION ALL SELECT 2').raw().iterate()) { assert.deepEqual(row, [1]); break; }
    const s = d.prepare("SELECT json_extract(value, '$') AS v FROM (SELECT '1' AS value UNION ALL SELECT 'invalid')");
    assert.throws(() => [...s.iterate()], error => error.code === 'SQLITE_ERROR');
    d.exec('CREATE TABLE after_error(id INTEGER)');
  });
  await test('rows-bindings-metadata', open => {
    const d = open();
    d.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, val TEXT UNIQUE, b BLOB)');
    const result = d.prepare('INSERT INTO t(val,b) VALUES (?,?)').run('a', Buffer.from([0, 255]));
    assert.equal(result.changes, 1);
    assert.equal(result.lastInsertRowid, 1);
    assert.deepEqual(d.prepare('SELECT id,val FROM t').raw().get(), [1, 'a']);
    assert.deepEqual(d.prepare('SELECT id,val FROM t').raw().all(), [[1, 'a']]);
    assert.equal(d.prepare('SELECT val FROM t WHERE id=?').get(99), undefined);
    assert.equal(d.prepare('SELECT val FROM t WHERE id=?').raw().get(99), undefined);
    assert.equal(d.prepare('SELECT val FROM t WHERE id=@id').get({ id: 1 }).val, 'a');
    assert.equal(d.prepare('SELECT val FROM t WHERE id=?').bind(1).get().val, 'a');
    assert.deepEqual(Buffer.from(d.prepare('SELECT b FROM t').get().b), Buffer.from([0, 255]));
  });
  await test('transactions-savepoints-rollback', open => {
    const d = open();
    d.exec('PRAGMA foreign_keys=ON; CREATE TABLE t(id INTEGER PRIMARY KEY, val TEXT UNIQUE)');
    const add = val => d.prepare('INSERT INTO t(val) VALUES (?)').run(val);
    const inner = d.transaction(() => { add('nested'); return 23; });
    const outer = d.transaction(() => {
      assert.equal(d.inTransaction, true);
      add('outer');
      assert.equal(inner(), 23);
      assert.throws(() => d.transaction(() => { add('discard'); throw Error('rollback'); })(), /rollback/);
      d.exec('SAVEPOINT fixture'); add('savepoint'); d.exec('ROLLBACK TO fixture; RELEASE fixture');
      return 42;
    });
    assert.equal(outer.immediate(), 42);
    assert.equal(d.inTransaction, false);
    assert.deepEqual(d.prepare('SELECT val FROM t ORDER BY id').all(), [{ val: 'outer' }, { val: 'nested' }]);
    assert.throws(() => d.transaction(() => { add('partial'); add('outer'); }).immediate(), error => error.code === 'SQLITE_CONSTRAINT_UNIQUE');
    assert.equal(d.prepare('SELECT count(*) AS n FROM t').get().n, 2);
    d.exec('CREATE TABLE child(parent INTEGER REFERENCES t(id))');
    assert.throws(() => d.prepare('INSERT INTO child VALUES (?)').run(99), error => error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY');
  });
  await test('iteration-early-close', open => {
    const d = open();
    d.exec('CREATE TABLE t(id INTEGER PRIMARY KEY); INSERT INTO t VALUES(1),(2),(3)');
    assert.deepEqual([...d.prepare('SELECT id FROM t ORDER BY id').iterate()], [{ id: 1 }, { id: 2 }, { id: 3 }]);
    for (const row of d.prepare('SELECT id FROM t ORDER BY id').iterate()) { assert.equal(row.id, 1); break; }
    d.prepare('INSERT INTO t VALUES(?)').run(4);
    assert.equal(d.prepare('SELECT count(*) AS n FROM t').get().n, 4);
  });
  await test('wal-lock-no-duplicate-write', open => {
    const a = open('wal.sqlite', { timeout: 10 });
    a.pragma('journal_mode=WAL');
    a.exec('CREATE TABLE t(id INTEGER PRIMARY KEY)');
    const b = open('wal.sqlite', { timeout: 10 });
    a.exec('BEGIN IMMEDIATE; INSERT INTO t VALUES(1)');
    assert.equal(b.prepare('SELECT count(*) AS n FROM t').get().n, 0);
    let calls = 0;
    const write = b.transaction(() => { calls++; b.exec('INSERT INTO t VALUES(2)'); });
    assert.throws(() => write.immediate(), error => error.code === 'SQLITE_BUSY');
    assert.equal(calls, 0);
    a.exec('COMMIT');
    assert.equal(b.prepare('SELECT count(*) AS n FROM t').get().n, 1);
    write.immediate();
    assert.equal(calls, 1);
    assert.equal(a.prepare('SELECT count(*) AS n FROM t').get().n, 2);
  });
  await test('backup-readonly-missing', async open => {
    const d = open();
    d.pragma('journal_mode=WAL');
    d.exec('CREATE TABLE t(id INTEGER); INSERT INTO t VALUES(1),(2)');
    const result = await d.backup(`${dir}/backup.sqlite`);
    assert.equal(result.remainingPages, 0);
    d.exec('INSERT INTO t VALUES(3)');
    const ro = open('backup.sqlite', { readonly: true, fileMustExist: true });
    assert.equal(ro.pragma('integrity_check', { simple: true }), 'ok');
    assert.equal(ro.prepare('SELECT count(*) AS n FROM t').get().n, 2);
    assert.throws(() => ro.exec('DELETE FROM t'), error => error.code === 'SQLITE_READONLY');
    assert.throws(() => open('missing.sqlite', { fileMustExist: true }));
    assert.throws(() => open('missing-ro.sqlite', { readonly: true }));
    assert.equal(fs.existsSync(`${dir}/missing.sqlite`), false);
    assert.equal(fs.existsSync(`${dir}/missing-ro.sqlite`), false);
    assert.throws(() => ro.prepare('DELETE FROM t').run(), error => error.code === 'SQLITE_READONLY');
    const denied = `${dir}/backup-denied`;
    fs.writeFileSync(denied, 'not a directory');
    await assert.rejects(() => d.backup(`${denied}/snapshot.sqlite`), error => error.code === 'SQLITE_CANTOPEN');
    if (d.sqlite) {
      await assert.rejects(() => d.backup(`${dir}/backup.sqlite`), error => error.code === 'SQLITE_ERROR');
      assert.equal(ro.prepare('SELECT count(*) AS n FROM t').get().n, 2);
    }
  });
  for (const { name, error } of failed) console.error(`${name}: ${error.stack}`);
  console.log(`SQLite contracts: ${passed.length} passed, ${failed.length} failed; ${passed.join(', ')}`);
  if (failed.length) process.exitCode = 1;
})().finally(() => fs.rmSync(dir, { recursive: true, force: true }));

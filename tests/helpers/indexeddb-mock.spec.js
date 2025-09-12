/**
 * Tests for tests/helpers/indexeddb-mock.js
 *
 * Testing framework: Jest (describe/it/expect). If the repository uses Vitest, these tests
 * should still run with minimal/no changes as APIs are compatible for this usage.
 *
 * We provide a minimal IndexedDB fake to cover:
 *  - DB creation with onupgradeneeded and object store 'handles' with keyPath 'name'
 *  - Successful put/get flows
 *  - Error propagation from open/put/get
 *  - Overwrite behavior on put with same key "library"
 */
import { storeLibraryHandle, getStoredLibraryHandle } from '../helpers/indexeddb-mock';

// Minimal in-memory IndexedDB fake sufficient for this module's usage
class FakeIDBRequest {
  constructor() {
    this.onsuccess = null;
    this.onerror = null;
  }
  succeed(result) {
    this.result = result;
    if (typeof this.onsuccess === 'function') this.onsuccess({ target: this });
  }
  fail(error) {
    this.error = error;
    if (typeof this.onerror === 'function') this.onerror({ target: this });
  }
}

class FakeObjectStore {
  constructor(state) {
    this._state = state; // Map-like object keyed by primary key
  }
  put(value) {
    const req = new FakeIDBRequest();
    queueMicrotask(() => {
      try {
        const key = value?.name;
        if (typeof key === 'undefined') {
          throw new Error('KeyPath name missing');
        }
        this._state.set(key, value);
        req.succeed(undefined);
      } catch (e) {
        req.fail(e);
      }
    });
    return req;
  }
  get(key) {
    const req = new FakeIDBRequest();
    queueMicrotask(() => {
      try {
        const val = this._state.get(key) ?? undefined;
        req.succeed(val);
      } catch (e) {
        req.fail(e);
      }
    });
    return req;
  }
}

class FakeTransaction {
  constructor(state) {
    this._state = state;
    this.mode = null;
  }
  objectStore(name) {
    if (name !== 'handles') throw new Error('Unknown store ' + name);
    return new FakeObjectStore(this._state);
  }
}

class FakeDB {
  constructor(state) {
    this._state = state;
    this._stores = new Map();
  }
  createObjectStore(name, opts) {
    // respect keyPath but our store class enforces 'name' anyway
    if (name !== 'handles' || !opts || opts.keyPath !== 'name') {
      throw new Error('Unexpected store definition');
    }
    // no-op: we use a shared state map
    return new FakeObjectStore(this._state);
  }
  transaction(name, mode) {
    const tx = new FakeTransaction(this._state);
    tx.mode = mode;
    return tx;
  }
}

class FakeIDBFactory {
  constructor(options = {}) {
    this.shouldOpenFail = options.shouldOpenFail ?? false;
    this.openError = options.openError ?? new Error('open failed');
    this.instances = new Map(); // dbName -> { version, stateMap, db }
  }
  open(name, version) {
    const req = new FakeIDBRequest();
    queueMicrotask(() => {
      if (this.shouldOpenFail) {
        req.fail(this.openError);
        return;
      }
      let rec = this.instances.get(name);
      const firstOpen = !rec;
      if (!rec) {
        rec = { version: version != null ? version : 1, stateMap: new Map(), db: null };
        this.instances.set(name, rec);
      }
      // Simulate upgrade needed only if first open or version increased
      const db = new FakeDB(rec.stateMap);
      rec.db = db;
      if (firstOpen) {
        if (typeof req.onupgradeneeded === 'function') {
          req.onupgradeneeded({ target: { result: db } });
        }
      }
      req.succeed(db);
    });
    return req;
  }
}

function installIndexedDBFake(options) {
  const factory = new FakeIDBFactory(options);
  global.indexedDB = factory;
  return factory;
}

describe('indexeddb-mock storeLibraryHandle/getStoredLibraryHandle', () => {
  beforeEach(() => {
    // Fresh fake for each test
    installIndexedDBFake();
  });

  afterEach(() => {
    // Cleanup global
    delete global.indexedDB;
  });

  it('creates the database and object store on first open (happy path)', async () => {
    await expect(storeLibraryHandle({ id: 123, kind: 'fs-handle' })).resolves.toBeUndefined();
    await expect(getStoredLibraryHandle()).resolves.toEqual({ id: 123, kind: 'fs-handle' });
  });

  it('returns null when no handle has been stored yet', async () => {
    await expect(getStoredLibraryHandle()).resolves.toBeNull();
  });

  it('overwrites existing handle when storing again with the same key "library"', async () => {
    await storeLibraryHandle({ id: 1 });
    await storeLibraryHandle({ id: 2, extra: true });
    await expect(getStoredLibraryHandle()).resolves.toEqual({ id: 2, extra: true });
  });

  it('propagates open errors from indexedDB.open()', async () => {
    installIndexedDBFake({ shouldOpenFail: true, openError: new Error('boom') });
    await expect(storeLibraryHandle({})).rejects.toThrow('boom');
  });

  it('propagates put errors (e.g., missing keyPath name)', async () => {
    // Patch FakeObjectStore to throw on put if value missing name; our fake already does that.
    // Call internal through exported API: storeLibraryHandle wraps value as { name: "library", handle }
    // To induce error, we will temporarily monkey-patch storeLibraryHandle to bypass the wrapper.
    // Instead, simulate by temporarily breaking FakeObjectStore's put via a custom fake.
    const originalIndexedDB = global.indexedDB;

    class ThrowOnPutStore extends FakeObjectStore {
      put(value) {
        const req = new FakeIDBRequest();
        queueMicrotask(() => req.fail(new Error('put failed')));
        return req;
      }
    }
    class ThrowOnPutDB extends FakeDB {
      createObjectStore(name, opts) { return new ThrowOnPutStore(this._state); }
      transaction(name, mode) { return new ThrowOnPutStore(this._state); }
    }
    class ThrowOnPutFactory extends FakeIDBFactory {
      open(name, version) {
        const req = new FakeIDBRequest();
        queueMicrotask(() => {
          const rec = { version, stateMap: new Map(), db: new ThrowOnPutDB(new Map()) };
          this.instances.set(name, rec);
          if (typeof req.onupgradeneeded === 'function') {
            req.onupgradeneeded({ target: { result: rec.db } });
          }
          req.succeed(rec.db);
        });
        return req;
      }
    }
    global.indexedDB = new ThrowOnPutFactory();

    await expect(storeLibraryHandle({ id: 7 })).rejects.toThrow('put failed');

    global.indexedDB = originalIndexedDB;
  });

  it('propagates get errors', async () => {
    // Custom store that throws on get
    const originalIndexedDB = global.indexedDB;

    class ThrowOnGetStore extends FakeObjectStore {
      get(key) {
        const req = new FakeIDBRequest();
        queueMicrotask(() => req.fail(new Error('get failed')));
        return req;
      }
    }
    class ThrowOnGetDB extends FakeDB {
      createObjectStore() { return new ThrowOnGetStore(this._state); }
      transaction() { return new ThrowOnGetStore(this._state); }
    }
    class ThrowOnGetFactory extends FakeIDBFactory {
      open(name, version) {
        const req = new FakeIDBRequest();
        queueMicrotask(() => {
          const rec = { version, stateMap: new Map(), db: new ThrowOnGetDB(new Map()) };
          this.instances.set(name, rec);
          if (typeof req.onupgradeneeded === 'function') {
            req.onupgradeneeded({ target: { result: rec.db } });
          }
          req.succeed(rec.db);
        });
        return req;
      }
    }
    global.indexedDB = new ThrowOnGetFactory();

    await expect(getStoredLibraryHandle()).rejects.toThrow('get failed');

    global.indexedDB = originalIndexedDB;
  });

  it('stores and retrieves complex handle objects by reference', async () => {
    const complex = { id: 42, nested: { a: 1 }, arr: [1, 2, 3] };
    await storeLibraryHandle(complex);
    const result = await getStoredLibraryHandle();
    expect(result).toEqual(complex);
    // Ensure deep equality holds
    expect(result.nested.a).toBe(1);

    expect(Array.isArray(result.arr)).toBe(true);
  });

  it('handles rapid consecutive writes and ensures last-write-wins', async () => {
    const writes = [];
    for (let i = 0; i < 10; i++) {
      writes.push(storeLibraryHandle({ seq: i }));
    }
    await Promise.all(writes);
    const result = await getStoredLibraryHandle();
    expect(result).toEqual({ seq: 9 });
  });
});
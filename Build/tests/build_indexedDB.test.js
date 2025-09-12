/**
 * Test runner/framework: Jest or Vitest (describe/it/expect).
 * These tests avoid external deps by installing a minimal in-memory IndexedDB mock.
 * They validate the public interfaces:
 *   - storeLibraryHandle(handle): Promise<void>
 *   - getStoredLibraryHandle(): Promise<Handle|null>
 */

const defer = (fn) => (typeof queueMicrotask === 'function' ? queueMicrotask(fn) : Promise.resolve().then(fn));

function installIndexedDBMock() {
  class FakeRequest {
    constructor() {
      this.result = undefined;
      this.error = null;
      this.onsuccess = null;
      this.onerror = null;
    }

    succeed(result) {
      this.result = result;
      if (typeof this.onsuccess === 'function') {
        this.onsuccess({ target: { result } });
      }
    }

    fail(error) {
      this.error = error;
      if (typeof this.onerror === 'function') {
        this.onerror({ target: { error } });
      }
    }
  }

  class FakeObjectStore {
    constructor(db, name) {
      this.db = db;
      this.name = name;
      if (!this.db.data[this.name]) {
        this.db.data[this.name] = new Map();
      }
    }

    put(record) {
      const req = new FakeRequest();
      defer(() => {
        if (this.db.control.failNextPut) {
          this.db.control.failNextPut = false;
          return req.fail(new Error('put failed'));
        }
        // Mimic keyPath: "name"
        if (!record || typeof record.name === 'undefined') {
          return req.fail(new Error('KeyPath "name" missing'));
        }
        this.db.data[this.name].set(record.name, record);
        req.succeed(undefined);
      });
      return req;
    }

    get(key) {
      const req = new FakeRequest();
      defer(() => {
        if (this.db.control.failNextGet) {
          this.db.control.failNextGet = false;
          return req.fail(new Error('get failed'));
        }
        const value = this.db.data[this.name].get(key);
        req.succeed(value);
      });
      return req;
    }
  }

  class FakeDB {
    constructor(control) {
      this.control = control;
      this.data = {}; // { storeName: Map(key -> record) }
      this.stores = new Set();
    }

    createObjectStore(name, _options) {
      this.stores.add(name);
      this.data[name] = this.data[name] || new Map();
      return new FakeObjectStore(this, name);
    }

    transaction(storeName, _mode) {
      // Minimal transaction mock returning an objectStore
      return {
        objectStore: (name) => new FakeObjectStore(this, name || storeName),
      };
    }
  }

  const control = {
    upgradeCalls: 0,
    failNextOpen: false,
    failNextPut: false,
    failNextGet: false,
    // Resets DB instance and error flags
    reset() {
      db = null;
      initialized = false;
      this.failNextOpen = false;
      this.failNextPut = false;
      this.failNextGet = false;
      this.upgradeCalls = 0;
    },
    // Clears only the data, preserving initialization state
    clearData() {
      if (db) {
        Object.keys(db.data).forEach((k) => {
          db.data[k] = new Map();
        });
      }
    },
    // For introspection in a couple of assertions
    _getDB() {
      return db;
    },
  };

  let db = null;
  let initialized = false;

  const indexedDBMock = {
    open(name, version) {
      const req = new FakeRequest();
      defer(() => {
        if (control.failNextOpen) {
          control.failNextOpen = false;
          return req.fail(new Error('open failed'));
        }
        if (!db) {
          db = new FakeDB(control);
        }
        // Simulate initial upgrade path
        if (!initialized) {
          if (typeof req.onupgradeneeded === 'function') {
            control.upgradeCalls += 1;
            req.onupgradeneeded({ target: { result: db } });
          }
          initialized = true;
        }
        if (typeof req.onsuccess === 'function') {
          req.onsuccess({ target: { result: db } });
        }
      });
      return req;
    },
  };

  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: indexedDBMock,
  });
  Object.defineProperty(globalThis, '__idbMock', {
    configurable: true,
    enumerable: false,
    writable: true,
    value: control,
  });
}

let storeLibraryHandle;
let getStoredLibraryHandle;

describe('IndexedDB library handle persistence', () => {
  beforeAll(async () => {
    installIndexedDBMock();

    // Dynamically import the module under test from likely locations.
    // This keeps tests flexible without adding config changes.
    async function loadModule() {
      const candidates = [
        '../src/build_indexedDB.js',
        '../build_indexedDB.js',
        '../src/utils/build_indexedDB.js',
        '../app/build_indexedDB.js',
      ];
      let lastErr;
      for (const p of candidates) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const mod = await import(p);
          return mod;
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr || new Error('Could not locate module under test');
    }

    const mod = await loadModule();
    storeLibraryHandle = mod.storeLibraryHandle;
    getStoredLibraryHandle = mod.getStoredLibraryHandle;
    if (typeof storeLibraryHandle !== 'function' || typeof getStoredLibraryHandle !== 'function') {
      throw new Error('Module does not export expected functions');
    }
  });

  beforeEach(() => {
    // Fresh state for every test
    globalThis.__idbMock.reset();
  });

  it('returns null when no library handle has been stored', async () => {
    const handle = await getStoredLibraryHandle();
    expect(handle).toBeNull();
  });

  it('stores and retrieves the same handle object (happy path)', async () => {
    const toStore = { id: 123, name: 'Main Library' };
    await storeLibraryHandle(toStore);
    const retrieved = await getStoredLibraryHandle();
    expect(retrieved).toEqual(toStore);
  });

  it('overwrites existing handle on subsequent store operations', async () => {
    await storeLibraryHandle({ id: 1, name: 'Old' });
    await storeLibraryHandle({ id: 2, name: 'New' });
    const retrieved = await getStoredLibraryHandle();
    expect(retrieved).toEqual({ id: 2, name: 'New' });
  });

  it('supports falsy handle values (e.g., 0) without coercing to null', async () => {
    await storeLibraryHandle(0);
    const retrieved = await getStoredLibraryHandle();
    expect(retrieved).toBe(0);
  });

  it('supports undefined handle value and returns undefined (not null) when present', async () => {
    await storeLibraryHandle(undefined);
    const retrieved = await getStoredLibraryHandle();
    expect(retrieved).toBeUndefined();
  });

  it('propagates open errors when establishing DB connection (store path)', async () => {
    globalThis.__idbMock.failNextOpen = true;
    await expect(storeLibraryHandle({ a: 1 })).rejects.toThrow(/open failed/);
  });

  it('propagates open errors when establishing DB connection (get path)', async () => {
    globalThis.__idbMock.failNextOpen = true;
    await expect(getStoredLibraryHandle()).rejects.toThrow(/open failed/);
  });

  it('rejects when objectStore.put fails', async () => {
    globalThis.__idbMock.failNextPut = true;
    await expect(storeLibraryHandle({ id: 9 })).rejects.toThrow(/put failed/);
  });

  it('rejects when objectStore.get fails', async () => {
    globalThis.__idbMock.failNextGet = true;
    await expect(getStoredLibraryHandle()).rejects.toThrow(/get failed/);
  });

  it('invokes onupgradeneeded exactly once across multiple opens (no re-creation)', async () => {
    // Do not reset between calls within this test
    globalThis.__idbMock.reset();
    expect(globalThis.__idbMock.upgradeCalls).toBe(0);

    // First call should create store via onupgradeneeded
    await getStoredLibraryHandle();
    expect(globalThis.__idbMock.upgradeCalls).toBe(1);

    // Subsequent call should reuse DB without triggering upgrade
    await getStoredLibraryHandle();
    expect(globalThis.__idbMock.upgradeCalls).toBe(1);
  });
});
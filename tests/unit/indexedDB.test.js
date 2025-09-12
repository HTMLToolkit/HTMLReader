/**
 * Test framework: Jest (jsdom environment assumed).
 * If using Vitest, this file should still run as-is in a compatible environment.
 */

// We will import the module under test. Adjust the path if implementation file differs.
let mod;
const importModule = async () => {
  // Try common paths; the repository may place the implementation in src/indexedDB.js or similar.
  try {
    mod = await import('../../src/indexedDB.js');
  } catch (e1) {
    try {
      mod = await import('../../indexedDB.js');
    } catch (e2) {
      try {
        mod = await import('../../src/utils/indexedDB.js');
      } catch (e3) {
        // Last resort: path used in tests matches PR context
        mod = await import('../../src/lib/indexedDB.js');
      }
    }
  }
};

const createMockIDB = () => {
  // Minimal IndexedDB mock graph with evented IDBRequests
  class IDBRequest {
    constructor() {
      this.result = undefined;
      this.error = undefined;
      this.onsuccess = null;
      this.onerror = null;
    }
    succeed(result) {
      this.result = result;
      if (typeof this.onsuccess === 'function') {
        this.onsuccess({ target: { result: this.result } });
      }
    }
    fail(err) {
      this.error = err;
      if (typeof this.onerror === 'function') {
        this.onerror({ target: { error: this.error } });
      }
    }
  }

  class ObjectStore {
    constructor(map) {
      this.map = map;
    }
    put(value) {
      const req = new IDBRequest();
      // emulate async
      queueMicrotask(() => {
        try {
          if (!value || typeof value.name === 'undefined') {
            throw new Error('Invalid record');
          }
          this.map.set(value.name, value);
          req.succeed(undefined);
        } catch (e) {
          req.fail(e);
        }
      });
      return req;
    }
    get(key) {
      const req = new IDBRequest();
      queueMicrotask(() => {
        try {
          req.succeed(this.map.has(key) ? this.map.get(key) : undefined);
        } catch (e) {
          req.fail(e);
        }
      });
      return req;
    }
  }

  class Transaction {
    constructor(map, mode) {
      this.mode = mode;
      this._store = new ObjectStore(map);
    }
    objectStore(name) {
      if (name !== 'handles') {
        throw new Error('Unknown store: ' + name);
      }
      return this._store;
    }
  }

  class DB {
    constructor() {
      this.stores = new Map(); // name -> Map()
    }
    createObjectStore(name, _opts) {
      if (!this.stores.has(name)) {
        this.stores.set(name, new Map());
      }
      return this.stores.get(name);
    }
    transaction(name, mode) {
      if (!this.stores.has(name)) {
        throw new Error('Store does not exist: ' + name);
      }
      return new Transaction(this.stores.get(name), mode);
    }
  }

  const db = new DB();

  const indexedDB = {
    open: jest.fn((_name, _version) => {
      const req = new IDBRequest();
      // Attach a "result" carrying the DB on success
      // Triggering of onupgradeneeded/onsuccess is controlled by tests via helpers below
      // Expose a handle so tests can drive the lifecycle
      req._driveUpgrade = () => {
        const event = { target: { result: db } };
        if (typeof req.onupgradeneeded === 'function') {
          req.onupgradeneeded(event);
        }
      };
      req._succeedOpen = () => {
        const event = { target: { result: db } };
        if (typeof req.onsuccess === 'function') {
          req.onsuccess(event);
        }
      };
      req._failOpen = (err) => {
        req.fail(err);
      };
      return req;
    }),
  };

  return { indexedDB, DB, ObjectStore, Transaction, IDBRequest };
};

describe('indexedDB helpers: storeLibraryHandle and getStoredLibraryHandle', () => {
  let restoreIndexedDB;
  let mock;

  beforeEach(async () => {
    jest.useFakeTimers(); // in case timers are used
    mock = createMockIDB();
    restoreIndexedDB = global.indexedDB;
    global.indexedDB = mock.indexedDB;
    await importModule();
  });

  afterEach(() => {
    jest.useRealTimers();
    global.indexedDB = restoreIndexedDB;
    // reset module cache between tests to isolate state if needed
    jest.resetModules();
  });

  test('getDB creates "handles" store on upgrade and resolves db on success', async () => {
    // Arrange
    const openReq = global.indexedDB.open.mock.results[0]?.value || global.indexedDB.open('htmlreader-db', 1);
    // Act: trigger upgrade then success
    openReq._driveUpgrade();
    openReq._succeedOpen();

    // Assert via calling a public API that awaits getDB internally
    await expect(mod.storeLibraryHandle({ foo: 'bar' })).resolves.toBeUndefined();

    // Validate that put indeed landed in the store by reading back
    await expect(mod.getStoredLibraryHandle()).resolves.toEqual({ foo: 'bar' });
  });

  test('storeLibraryHandle: writes the "library" handle successfully', async () => {
    const openReq = global.indexedDB.open('htmlreader-db', 1);
    openReq._driveUpgrade();
    openReq._succeedOpen();

    const handle = { id: 1, name: 'lib' };
    await expect(mod.storeLibraryHandle(handle)).resolves.toBeUndefined();

    await expect(mod.getStoredLibraryHandle()).resolves.toEqual(handle);
  });

  test('storeLibraryHandle: rejects when objectStore.put fails', async () => {
    const openReq = global.indexedDB.open('htmlreader-db', 1);
    openReq._driveUpgrade();
    openReq._succeedOpen();

    // Cause failure by passing a value lacking required "name" in record builder
    // store.put({ name: "library", handle }) always sets name, so we need to sabotage the ObjectStore.put.
    // Replace put to throw.
    const db = (openReq.onsuccess && { result: null }) || null; // noop line for clarity
    // Monkey-patch the underlying object store to throw
    const origOpen = global.indexedDB.open;
    global.indexedDB.open = jest.fn((_n, _v) => {
      const req = origOpen(_n, _v);
      req._driveUpgrade = () => {
        if (typeof req.onupgradeneeded === 'function') {
          const upgradeEvent = { target: { result: new (class extends (new (function(){})().constructor){})() } }; // dummy
        }
      };
      req._succeedOpen = () => {
        // Provide a db with a failing store.put
        const failingDb = {
          createObjectStore: () => {},
          transaction: (_name, _mode) => ({
            objectStore: (_nm) => ({
              put: () => {
                const r = new mock.IDBRequest();
                queueMicrotask(() => r.fail(new Error('put failed')));
                return r;
              },
            }),
          }),
        };
        if (typeof req.onsuccess === 'function') {
          req.onsuccess({ target: { result: failingDb } });
        }
      };
      return req;
    });

    const req2 = global.indexedDB.open('htmlreader-db', 1);

    req2._succeedOpen();

    await expect(mod.storeLibraryHandle({})).rejects.toThrow('put failed');

    // restore
    global.indexedDB.open = origOpen;
  });

  test('getStoredLibraryHandle: returns null when no value stored', async () => {
    const openReq = global.indexedDB.open('htmlreader-db', 1);
    openReq._driveUpgrade();
    openReq._succeedOpen();

    await expect(mod.getStoredLibraryHandle()).resolves.toBeNull();
  });

  test('getStoredLibraryHandle: rejects when objectStore.get fails', async () => {
    const origOpen = global.indexedDB.open;
    global.indexedDB.open = jest.fn((_n, _v) => {
      const req = origOpen(_n, _v);
      req._driveUpgrade = () => {};
      req._succeedOpen = () => {
        const failingDb = {
          transaction: () => ({
            objectStore: () => ({
              get: () => {
                const r = new mock.IDBRequest();
                queueMicrotask(() => r.fail(new Error('get failed')));
                return r;
              },
            }),
          }),
        };
        if (typeof req.onsuccess === 'function') {
          req.onsuccess({ target: { result: failingDb } });
        }
      };
      return req;
    });

    const req2 = global.indexedDB.open('htmlreader-db', 1);
    req2._succeedOpen();

    await expect(mod.getStoredLibraryHandle()).rejects.toThrow('get failed');

    global.indexedDB.open = origOpen;
  });

  test('getDB rejects when opening the DB fails', async () => {
    const req = global.indexedDB.open('htmlreader-db', 1);
    req._failOpen(new Error('open error'));

    // Invoke a public method that relies on getDB to surface the rejection
    await expect(mod.storeLibraryHandle({})).rejects.toThrow('open error');
  });
});
/**
 * Tests for IndexedDB helpers:
 * - storeLibraryHandle(handle)
 * - getStoredLibraryHandle()
 *
 * Framework: Jest (describe/test/expect patterns). If your project uses Vitest or Mocha, the syntax is largely compatible,
 * but update imports/globals accordingly.
 *
 * We provide a minimal IndexedDB mock sufficient for tested operations:
 * - indexedDB.open(name, version) triggers onupgradeneeded once per db name/version and then onsuccess.
 * - db.createObjectStore("handles", { keyPath: "name" })
 * - db.transaction(storeName, mode).objectStore(storeName).put({ name, handle }) / get(key)
 *   returning IDBRequest-like objects with onsuccess/onerror callbacks.
 *
 * The mock stores data per-db per-store in memory. All operations resolve asynchronously (queueMicrotask).
 */

let moduleUnderTest;

// Minimal IDB mock
class IDBRequestMock {
  constructor(executor) {
    this.onsuccess = null;
    this.onerror = null;
    // executor must call resolve(result) or reject(error)
    executor(
      (result) => queueMicrotask(() => this.onsuccess && this.onsuccess({ target: { result, source: undefined } })),
      (error) => queueMicrotask(() => this.onerror && this.onerror({ target: { error } }))
    );
  }
}

class ObjectStoreMock {
  constructor(storeName, storage, keyPath = "name") {
    this._storeName = storeName;
    this._storage = storage; // Map
    this._keyPath = keyPath;
  }
  put(value) {
    return new IDBRequestMock((resolve, reject) => {
      try {
        const key = value?.[this._keyPath];
        if (key === undefined) throw new Error("KeyPath missing");
        this._storage.set(String(key), value);
        resolve(undefined);
      } catch (e) {
        reject(e);
      }
    });
  }
  get(key) {
    return new IDBRequestMock((resolve, reject) => {
      try {
        resolve(this._storage.has(String(key)) ? this._storage.get(String(key)) : undefined);
      } catch (e) {
        reject(e);
      }
    });
  }
}

class TransactionMock {
  constructor(storeName, mode, dbState) {
    if (!dbState.objectStores.has(storeName)) throw new Error("NotFoundError");
    this._storeName = storeName;
    this._mode = mode;
    this._dbState = dbState;
  }
  objectStore(name) {
    if (name !== this._storeName) throw new Error("NotFoundError");
    const storeState = this._dbState.objectStores.get(name);
    return new ObjectStoreMock(name, storeState.storage, storeState.keyPath);
  }
}

class DBMock {
  constructor(dbState) {
    this._state = dbState;
  }
  createObjectStore(name, options = {}) {
    if (!this._state.objectStores.has(name)) {
      this._state.objectStores.set(name, {
        keyPath: options.keyPath || "id",
        storage: new Map()
      });
    }
    return true;
  }
  transaction(storeName, mode) {
    return new TransactionMock(storeName, mode, this._state);
  }
}

const __idbDatabases = new Map(); // key: name@version -> { objectStores: Map }

global.indexedDB = {
  open(name, version) {
    const request = new (class {
      constructor() {
        this.onupgradeneeded = null;
        this.onsuccess = null;
        this.onerror = null;
        // emulate async open
        queueMicrotask(() => {
          try {
            const key = `${name}@${version || 1}`;
            let dbState = __idbDatabases.get(key);
            const isNew = !dbState;
            if (!dbState) {
              dbState = { objectStores: new Map() };
              __idbDatabases.set(key, dbState);
            }
            const db = new DBMock(dbState);
            if (isNew && this.onupgradeneeded) {
              this.onupgradeneeded({ target: { result: db } });
            }
            this.onsuccess && this.onsuccess({ target: { result: db } });
          } catch (e) {
            this.onerror && this.onerror({ target: { error: e } });
          }
        });
      }
    })();
    return request;
  }
};

describe("IndexedDB helpers (storeLibraryHandle/getStoredLibraryHandle)", () => {
  // Dynamically import the module under test from its known path.
  // Try common paths; adjust if your file lives elsewhere.
  beforeAll(async () => {
    // Attempt multiple likely module paths in priority order.
    const candidates = [
      "src/indexedDB.js",
      "src/utils/indexedDB.js",
      "src/lib/indexedDB.js",
      "indexedDB.js",
    ];
    let lastErr;
    for (const p of candidates) {
      try {
        // eslint-disable-next-line no-await-in-loop
        moduleUnderTest = await import(require("path").isAbsolute(p) ? p : ("../".repeat(2) + p));
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!moduleUnderTest) {
      // Fallback to the file colocated under tests/unit if repository places code there (for the challenge context).
      try {
        moduleUnderTest = await import("./indexedDB.js");
      } catch (_) {
        throw lastErr || new Error("Failed to locate module exporting storeLibraryHandle/getStoredLibraryHandle");
      }
    }
  });

  beforeEach(() => {
    // Clear database state for isolation between tests
    __idbDatabases.clear();
  });

  test("creates database and object store on first open (implicit via successful store)", async () => {
    const { storeLibraryHandle, getStoredLibraryHandle } = moduleUnderTest;
    const handle = { type: "fs", id: "abc" };
    await expect(storeLibraryHandle(handle)).resolves.toBeUndefined();
    await expect(getStoredLibraryHandle()).resolves.toEqual(handle);
  });

  test("overwrites existing 'library' handle on subsequent stores", async () => {
    const { storeLibraryHandle, getStoredLibraryHandle } = moduleUnderTest;
    await storeLibraryHandle({ type: "fs", id: "one" });
    await storeLibraryHandle({ type: "fs", id: "two" });
    await expect(getStoredLibraryHandle()).resolves.toEqual({ type: "fs", id: "two" });
  });

  test("returns null when no 'library' entry exists", async () => {
    const { getStoredLibraryHandle } = moduleUnderTest;
    await expect(getStoredLibraryHandle()).resolves.toBeNull();
  });

  test("handles arbitrary serializable handle objects", async () => {
    const { storeLibraryHandle, getStoredLibraryHandle } = moduleUnderTest;
    const complex = { nested: { arr: [1, { x: true }], date: new Date(0).toISOString() }, n: 42 };
    await storeLibraryHandle(complex);
    await expect(getStoredLibraryHandle()).resolves.toEqual(complex);
  });

  test("propagates put error when keyPath is missing (simulated by tampering with store API)", async () => {
    const { storeLibraryHandle } = moduleUnderTest;

    // Monkey-patch the objectStore to remove name field before put to simulate keyPath error.
    const originalOpen = global.indexedDB.open;
    global.indexedDB.open = function(name, version) {
      const req = originalOpen(name, version);
      const origOnSuccessSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(req), "onsuccess")?.set;
      // Instead, wrap by overriding after creation; simpler approach: intercept onsuccess event:
      const origThen = req.onsuccess;
      req.onsuccess = null;
      queueMicrotask(() => {
        // After db creation, replace transaction.objectStore to a faulty one
        const oldHandler = req.onsuccess;
        req.onsuccess = (e) => {
          const db = e.target.result;
          const origTx = db.transaction.bind(db);
          db.transaction = (storeName, mode) => {
            const tx = origTx(storeName, mode);
            const origOS = tx.objectStore.bind(tx);
            tx.objectStore = (name) => {
              const os = origOS(name);
              const origPut = os.put.bind(os);
              os.put = (val) => origPut({ ...val, name: undefined }); // remove keyPath to trigger error
              return os;
            };
            return tx;
          };
          oldHandler && oldHandler(e);
        };
      });
      return req;
    };

    await expect(storeLibraryHandle({ any: "thing", name: "will-be-removed" })).rejects.toBeInstanceOf(Error);

    // restore
    global.indexedDB.open = originalOpen;
  });

  test("propagates get error (simulated by throwing inside get)", async () => {
    const { storeLibraryHandle, getStoredLibraryHandle } = moduleUnderTest;

    await storeLibraryHandle({ name: "library", ok: true });

    // Patch get to throw
    const originalOpen = global.indexedDB.open;
    global.indexedDB.open = function(name, version) {
      const req = originalOpen(name, version);
      const origThen = req.onsuccess;
      req.onsuccess = null;
      queueMicrotask(() => {
        const prev = req.onsuccess;
        req.onsuccess = (e) => {
          const db = e.target.result;
          const origTx = db.transaction.bind(db);
          db.transaction = (storeName, mode) => {
            const tx = origTx(storeName, mode);
            const origOS = tx.objectStore.bind(tx);
            tx.objectStore = (name) => {
              const os = origOS(name);
              os.get = () => new (class {
                constructor() {
                  this.onsuccess = null;
                  this.onerror = null;
                  queueMicrotask(() => {
                    this.onerror && this.onerror({ target: { error: new Error("boom") } });
                  });
                }
              })();
              return os;
            };
            return tx;
          };
          prev && prev(e);
        };
      });
      return req;
    };

    await expect(getStoredLibraryHandle()).rejects.toThrow("boom");

    global.indexedDB.open = originalOpen;
  });

  test("rejects when opening DB fails", async () => {
    const { storeLibraryHandle } = moduleUnderTest;
    const originalOpen = global.indexedDB.open;
    global.indexedDB.open = function() {
      // Return a request that errors immediately
      const r = {
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null
      };
      queueMicrotask(() => r.onerror && r.onerror({ target: { error: new Error("open failed") } }));
      return r;
    };
    await expect(storeLibraryHandle({ x: 1 })).rejects.toThrow("open failed");
    global.indexedDB.open = originalOpen;
  });
});
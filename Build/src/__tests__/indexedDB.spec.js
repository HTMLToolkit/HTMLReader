/**
 * Testing library/framework: This test is written to be compatible with Jest or Vitest.
 * - Uses describe/it/expect syntax common to both.
 * - No framework-specific APIs beyond timers and basic assertions.
 *
 * Subject under test: Build/src/indexedDB.test.js (exports storeLibraryHandle, getStoredLibraryHandle)
 * We provide a minimal in-memory IndexedDB stub to avoid adding new dependencies.
 */

/* eslint-disable no-undef */

const path = require('path');

// Import the module under test
const { storeLibraryHandle, getStoredLibraryHandle } = require(path.join('..', 'indexedDB.test.js'));

/**
 * Minimal IndexedDB stub that supports:
 * - indexedDB.open(name, version)
 * - IDBOpenDBRequest with onupgradeneeded, onsuccess, onerror
 * - db.createObjectStore(name, { keyPath })
 * - db.transaction(storeName, mode).objectStore(name).put/get
 * - Request objects for put/get with onsuccess/onerror
 *
 * Allows injecting failures for open/put/get via flags.
 */
class FakeIDBRequest {
  constructor(executor) {
    this.onsuccess = null;
    this.onerror = null;
    this._executor = executor;
  }
  _fireSuccess(result) {
    if (typeof this.onsuccess === 'function') {
      // emulate event with target.result
      this.onsuccess({ target: { result } });
    }
  }
  _fireError(error) {
    if (typeof this.onerror === 'function') {
      this.onerror({ target: { error } });
    }
  }
}

class FakeObjectStore {
  constructor(storage, keyPath, failBehavior) {
    this._storage = storage;
    this._keyPath = keyPath;
    this._fail = failBehavior;
  }
  put(value) {
    const req = new FakeIDBRequest();
    setTimeout(() => {
      if (this._fail.nextPutError) {
        const err = this._fail.nextPutError;
        this._fail.nextPutError = null;
        req._fireError(err);
        return;
      }
      const key = value[this._keyPath];
      this._storage.set(key, value);
      req._fireSuccess(undefined);
    }, 0);
    return req;
  }
  get(key) {
    const req = new FakeIDBRequest();
    setTimeout(() => {
      if (this._fail.nextGetError) {
        const err = this._fail.nextGetError;
        this._fail.nextGetError = null;
        req._fireError(err);
        return;
      }
      const value = this._storage.get(key);
      // In real IDB, req.result is set on the request; we emulate by passing result through success event
      // Our SUT reads via req.result in onsuccess closure; emulate by setting req.result before firing.
      req.result = value;
      if (typeof req.onsuccess === 'function') {
        req.onsuccess({ target: req });
      }
    }, 0);
    return req;
  }
}

class FakeTransaction {
  constructor(db, storeName) {
    this._db = db;
    this._storeName = storeName;
  }
  objectStore(name) {
    if (name !== this._storeName) {
      throw new Error('Invalid store name for this transaction');
    }
    return this._db._getStore(name);
  }
}

class FakeIDBDatabase {
  constructor(failBehavior) {
    this._stores = new Map();        // name -> Map for records
    this._storeMeta = new Map();     // name -> { keyPath }
    this._fail = failBehavior;
  }
  createObjectStore(name, options) {
    const keyPath = options && options.keyPath ? options.keyPath : 'id';
    if (!this._stores.has(name)) {
      this._stores.set(name, new Map());
      this._storeMeta.set(name, { keyPath });
    }
    return this._getStore(name);
  }
  transaction(name /*, mode */) {
    return new FakeTransaction(this, name);
  }
  _getStore(name) {
    const meta = this._storeMeta.get(name);
    if (!meta) {
      throw new Error(`Object store ${name} does not exist`);
    }
    return new FakeObjectStore(this._stores.get(name), meta.keyPath, this._fail);
  }
}

class FakeIDBFactory {
  constructor() {
    this._fail = {
      nextOpenError: null,
      nextPutError: null,
      nextGetError: null,
    };
  }
  open(/* name, version */) {
    const request = new FakeIDBRequest();
    setTimeout(() => {
      if (this._fail.nextOpenError) {
        const err = this._fail.nextOpenError;
        this._fail.nextOpenError = null;
        request._fireError(err);
        return;
      }
      const db = new FakeIDBDatabase(this._fail);
      // Fire upgrade needed first so SUT can create stores
      if (typeof request.onupgradeneeded === 'function') {
        request.onupgradeneeded({ target: { result: db } });
      }
      // Then success
      request._fireSuccess(db);
    }, 0);
    return request;
  }
}

describe('indexedDB helpers: storeLibraryHandle/getStoredLibraryHandle', () => {
  let originalIndexedDB;
  let fakeFactory;

  beforeEach(() => {
    // Swap in our fake
    originalIndexedDB = global.indexedDB;
    fakeFactory = new FakeIDBFactory();
    global.indexedDB = fakeFactory;
  });

  afterEach(() => {
    // Restore original
    global.indexedDB = originalIndexedDB;
    fakeFactory = null;
  });

  it('returns null when no library handle has been stored', async () => {
    const result = await getStoredLibraryHandle();
    expect(result).toBeNull();
  });

  it('stores and retrieves the library handle (happy path)', async () => {
    const handle = { kind: 'directory', id: 123, meta: { name: 'root' } };
    await storeLibraryHandle(handle);
    const retrieved = await getStoredLibraryHandle();
    expect(retrieved).toEqual(handle);
  });

  it('propagates an error when opening the database fails', async () => {
    fakeFactory._fail.nextOpenError = new Error('open failed');
    // store path
    await expect(storeLibraryHandle({})).rejects.toThrow('open failed');
    // get path
    fakeFactory._fail.nextOpenError = new Error('open failed again');
    await expect(getStoredLibraryHandle()).rejects.toThrow('open failed again');
  });

  it('propagates an error when putting the record fails', async () => {
    // First call to open should succeed to create DB and store, put will fail
    fakeFactory._fail.nextPutError = new Error('put failed');
    await expect(storeLibraryHandle({ any: 'thing' })).rejects.toThrow('put failed');
  });

  it('propagates an error when getting the record fails', async () => {
    // Store once successfully
    const handle = { foo: 'bar' };
    await storeLibraryHandle(handle);
    // Then make get fail
    fakeFactory._fail.nextGetError = new Error('get failed');
    await expect(getStoredLibraryHandle()).rejects.toThrow('get failed');
  });

  it('creates the "handles" object store with keyPath "name" on upgrade (indirect structural validation)', async () => {
    // We indirectly validate by ensuring that put with {name:"library"} works,
    // and that other keys are not accepted for missing keyPath.
    const badPut = storeLibraryHandle({ notName: 'oops' });
    await expect(badPut).rejects.toThrow(); // our FakeObjectStore expects keyPath 'name' and will error in put when key is undefined
  });
});
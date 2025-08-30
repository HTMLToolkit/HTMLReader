function getDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("htmlreader-db", 1);
    request.onupgradeneeded = e => {
      const db = e.target.result;
      db.createObjectStore("handles", { keyPath: "name" });
    };
    request.onsuccess = e => resolve(e.target.result);
    request.onerror = e => reject(e.target.error);
  });
}
export async function storeLibraryHandle(handle) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("handles", "readwrite");
    const store = tx.objectStore("handles");
    const req = store.put({ name: "library", handle });
    req.onsuccess = () => resolve();
    req.onerror = e => reject(e.target.error);
  });
}
export async function getStoredLibraryHandle() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("handles", "readonly");
    const store = tx.objectStore("handles");
    const req = store.get("library");
    req.onsuccess = () => resolve(req.result ? req.result.handle : null);
    req.onerror = e => reject(e.target.error);
  });
}
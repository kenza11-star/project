// Penyimpanan file besar (GLB/VRM/gambar) di IndexedDB.
const DB = 'bl-db';
const ST = 'files';

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(ST);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function tx<T = any>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  return new Promise<T>((res, rej) => {
    const t = db.transaction(ST, mode);
    const rq = fn(t.objectStore(ST));
    t.oncomplete = () => { db.close(); res(rq.result as T); };
    t.onerror = () => { db.close(); rej(t.error); };
    t.onabort = () => { db.close(); rej(t.error); };
  });
}

export const fileStore = {
  put: (key: string, blob: Blob) => tx('readwrite', (s) => s.put(blob, key)),
  get: (key: string) => tx<Blob | undefined>('readonly', (s) => s.get(key)),
  del: (key: string) => tx('readwrite', (s) => s.delete(key)),
};

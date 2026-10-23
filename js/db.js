/* IndexedDB storage for cards. Images are stored as Blobs inside each record. */
(function (global) {
  'use strict';

  const DB_NAME = 'karticky';
  const DB_VERSION = 1;
  const STORE = 'cards';

  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('box', 'box');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  // Runs fn inside one transaction and resolves with the result of the
  // request fn returns (if any) once the transaction has committed.
  async function run(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      let result;
      const req = fn(tx.objectStore(STORE));
      if (req) req.onsuccess = () => { result = req.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  }

  // Writes announce themselves so reminders can resync the due dates.
  async function write(fn) {
    const result = await run('readwrite', fn);
    global.dispatchEvent(new Event('karticky:changed'));
    return result;
  }

  global.DB = {
    all: () => run('readonly', (s) => s.getAll()),
    get: (id) => run('readonly', (s) => s.get(id)),
    byBox: (box) => run('readonly', (s) => s.index('box').getAll(box)),
    put: (card) => write((s) => s.put(card)),
    putMany: (cards) => write((s) => { cards.forEach((c) => s.put(c)); }),
    remove: (id) => write((s) => s.delete(id)),
  };
})(self); // `self` so the service worker can importScripts() this file too

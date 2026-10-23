/* IndexedDB storage for decks and cards. Images are stored as Blobs inside each card. */
(function (global) {
  'use strict';

  const DB_NAME = 'karticky';
  const DB_VERSION = 2;

  // Cards created before decks existed are moved into this deck.
  const DEFAULT_DECK = { id: 'default', name: 'Moje kartičky', color: 0 };

  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => upgrade(req.result, req.transaction, e.oldVersion);
        req.onsuccess = () => {
          const db = req.result;
          // Step aside when a newer app version (e.g. the updated page) needs to upgrade.
          db.onversionchange = () => { db.close(); dbPromise = null; };
          resolve(db);
        };
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  function upgrade(db, tx, oldVersion) {
    if (oldVersion < 1) {
      db.createObjectStore('cards', { keyPath: 'id' }).createIndex('box', 'box');
    }
    if (oldVersion < 2) {
      db.createObjectStore('decks', { keyPath: 'id' });
      const cards = tx.objectStore('cards');
      cards.createIndex('deckId', 'deckId');

      let defaultCreated = false;
      cards.openCursor().onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) return;
        if (!cursor.value.deckId) {
          if (!defaultCreated) {
            tx.objectStore('decks').put({ ...DEFAULT_DECK, createdAt: new Date().toISOString() });
            defaultCreated = true;
          }
          cursor.update({ ...cursor.value, deckId: DEFAULT_DECK.id });
        }
        cursor.continue();
      };
    }
  }

  // Runs fn inside one transaction and resolves with the result of the
  // request fn returns (if any) once the transaction has committed.
  async function run(stores, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let result;
      const req = fn(tx);
      if (req) req.onsuccess = () => { result = req.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  }

  // Writes announce themselves so reminders can resync the due dates.
  async function write(stores, fn) {
    const result = await run(stores, 'readwrite', fn);
    global.dispatchEvent(new Event('karticky:changed'));
    return result;
  }

  const cards = (tx) => tx.objectStore('cards');
  const decks = (tx) => tx.objectStore('decks');

  global.DB = {
    DEFAULT_DECK,

    all: () => run('cards', 'readonly', (tx) => cards(tx).getAll()),
    get: (id) => run('cards', 'readonly', (tx) => cards(tx).get(id)),
    byDeck: (deckId) => run('cards', 'readonly', (tx) => cards(tx).index('deckId').getAll(deckId)),
    put: (card) => write('cards', (tx) => cards(tx).put(card)),
    remove: (id) => write('cards', (tx) => cards(tx).delete(id)),

    decks: () => run('decks', 'readonly', (tx) => decks(tx).getAll()),
    getDeck: (id) => run('decks', 'readonly', (tx) => decks(tx).get(id)),
    putDeck: (deck) => write('decks', (tx) => decks(tx).put(deck)),

    // Deletes the deck together with all of its cards.
    removeDeck: (id) => write(['decks', 'cards'], (tx) => {
      decks(tx).delete(id);
      cards(tx).index('deckId').openCursor(IDBKeyRange.only(id)).onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
    }),

    importAll: (deckList, cardList) => write(['decks', 'cards'], (tx) => {
      deckList.forEach((d) => decks(tx).put(d));
      cardList.forEach((c) => cards(tx).put(c));
    }),
  };
})(self); // `self` so the service worker can importScripts() this file too

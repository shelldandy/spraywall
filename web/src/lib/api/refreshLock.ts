// IndexedDB supplies cross-tab locking on plain HTTP, where Web Locks are unavailable.
const LOCK_DB = "spraywall-auth-lock";
const LOCK_STORE = "locks";
const LOCK_KEY = "refresh";
const LEASE_MS = 60_000;
const RENEW_MS = 15_000;

type LockEntry = { owner: string; expiresAt: number };

let database: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (!database) {
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(LOCK_DB, 1);
      request.onupgradeneeded = () => { request.result.createObjectStore(LOCK_STORE); };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
    });
    database = opening;
    void opening.catch(() => {
      if (database === opening) database = undefined;
    });
  }
  return database!;
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Lock transaction aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("Lock transaction failed"));
  });
}

async function acquire(owner: string): Promise<boolean> {
  const transaction = (await openDatabase()).transaction(LOCK_STORE, "readwrite");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(LOCK_STORE);
  let acquired = false;
  const request = store.get(LOCK_KEY);
  request.onsuccess = () => {
    const current = request.result as LockEntry | undefined;
    if (!current || current.expiresAt <= Date.now()) {
      store.put({ owner, expiresAt: Date.now() + LEASE_MS } satisfies LockEntry, LOCK_KEY);
      acquired = true;
    }
  };
  await done;
  return acquired;
}

async function renew(owner: string): Promise<void> {
  const transaction = (await openDatabase()).transaction(LOCK_STORE, "readwrite");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(LOCK_STORE);
  const request = store.get(LOCK_KEY);
  request.onsuccess = () => {
    const current = request.result as LockEntry | undefined;
    if (current?.owner === owner) {
      store.put({ owner, expiresAt: Date.now() + LEASE_MS } satisfies LockEntry, LOCK_KEY);
    }
  };
  await done;
}

async function release(owner: string): Promise<void> {
  const transaction = (await openDatabase()).transaction(LOCK_STORE, "readwrite");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(LOCK_STORE);
  const request = store.get(LOCK_KEY);
  request.onsuccess = () => {
    const current = request.result as LockEntry | undefined;
    if (current?.owner === owner) store.delete(LOCK_KEY);
  };
  await done;
}

async function withIndexedDBLock<T>(task: () => Promise<T>): Promise<T> {
  const owner = `${Date.now()}-${Math.random()}`;
  while (!(await acquire(owner))) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const heartbeat = setInterval(() => {
    void renew(owner).catch(() => {});
  }, RENEW_MS);
  try {
    return await task();
  } finally {
    clearInterval(heartbeat);
    await release(owner).catch(() => {});
  }
}

export function withAuthLock<T>(task: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request("spraywall-auth-refresh", task);
  }
  return withIndexedDBLock(task);
}

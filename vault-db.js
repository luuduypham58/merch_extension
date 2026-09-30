(function merchFlowVaultDb(global) {
  const DB_NAME = "merch-flow-vault";
  const DB_VERSION = 1;
  const STORE = "designs";

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("jobId", "jobId", { unique: false });
          store.createIndex("createdAt", "createdAt", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Không mở được Vault IndexedDB"));
    });
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
    });
  }

  async function withStore(mode, operation) {
    const db = await openDb();
    try {
      const transaction = db.transaction(STORE, mode);
      const store = transaction.objectStore(STORE);
      const result = await operation(store);
      await transactionDone(transaction);
      return result;
    } finally {
      db.close();
    }
  }

  async function putDesign(design) {
    if (!design?.id || !design?.jobId || !/^data:image\/(?:png|jpe?g|webp);base64,/i.test(String(design.artworkDataUrl || ""))) {
      throw new Error("Vault design thiếu id/jobId/artwork");
    }
    await withStore("readwrite", (store) => requestResult(store.put(design)));
    return design;
  }

  async function getAllDesigns() {
    return withStore("readonly", (store) => requestResult(store.getAll()));
  }

  async function deleteDesign(id) {
    if (!id) return;
    await withStore("readwrite", (store) => requestResult(store.delete(id)));
  }

  async function clearDesigns() {
    await withStore("readwrite", (store) => requestResult(store.clear()));
  }

  function metadataFromDesign(design) {
    const nicheProfile = design?.nicheProfile && typeof design.nicheProfile === "object"
      ? { ...design.nicheProfile, referenceDataUrl: "" }
      : {};
    return {
      id: String(design?.id || ""),
      jobId: String(design?.jobId || ""),
      createdAt: Number(design?.createdAt || Date.now()),
      artworkName: String(design?.artworkName || ""),
      listing: design?.listing && typeof design.listing === "object" ? { ...design.listing } : {},
      nicheProfile,
      batchId: String(design?.batchId || ""),
      batchIndex: Number(design?.batchIndex || 0),
      conversationKey: String(design?.conversationKey || ""),
      creativeFingerprint: String(design?.creativeFingerprint || ""),
      source: String(design?.source || "saved"),
      artworkStore: "indexeddb"
    };
  }

  async function migrateLegacy(savedDesigns) {
    const source = Array.isArray(savedDesigns) ? savedDesigns : [];
    let changed = false;
    const metadata = [];
    for (const item of source) {
      if (!item || typeof item !== "object") continue;
      if (/^data:image\/(?:png|jpe?g|webp);base64,/i.test(String(item.artworkDataUrl || ""))) {
        await putDesign(item);
        metadata.push(metadataFromDesign(item));
        changed = true;
      } else {
        const { artworkDataUrl: _legacyArtwork, ...rest } = item;
        metadata.push({ ...rest, artworkStore: item.artworkStore || "indexeddb" });
      }
    }
    return { metadata, changed };
  }

  global.MerchFlowVaultDB = {
    putDesign,
    getAllDesigns,
    deleteDesign,
    clearDesigns,
    metadataFromDesign,
    migrateLegacy
  };
})(globalThis);

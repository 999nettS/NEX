// storage.js — IndexedDB persistence for NEX.
// Replaces the old single localStorage blob ("novaPhoneV2") with a real
// database: separate object stores for conversations, messages, memories,
// and settings, so writes are transactional and one giant JSON blob can't
// get corrupted or blow past storage quotas silently.

const DB_NAME = "nexPhoneDB";
const DB_VERSION = 1;
const OLD_LOCALSTORAGE_KEY = "novaPhoneV2"; // for one-time migration only

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("conversations")) {
        db.createObjectStore("conversations", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("messages")) {
        const store = db.createObjectStore("messages", { keyPath: "id" });
        store.createIndex("byConversation", "conversationId");
      }
      if (!db.objectStoreNames.contains("memories")) {
        db.createObjectStore("memories", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    const result = fn(store);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const Storage = {
  uid,

  // ---- settings (key/value) ----
  async getSetting(key, fallback = null) {
    const db = await openDB();
    return new Promise((resolve) => {
      const t = db.transaction("settings", "readonly");
      const req = t.objectStore("settings").get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : fallback);
      req.onerror = () => resolve(fallback);
    });
  },
  async setSetting(key, value) {
    return tx("settings", "readwrite", (store) => store.put({ key, value }));
  },

  // ---- conversations ----
  async createConversation(title = "New chat") {
    const conv = { id: uid(), title, createdAt: Date.now(), updatedAt: Date.now() };
    await tx("conversations", "readwrite", (store) => store.put(conv));
    return conv;
  },
  async touchConversation(id, title) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction("conversations", "readwrite");
      const store = t.objectStore("conversations");
      const req = store.get(id);
      req.onsuccess = () => {
        const conv = req.result;
        if (conv) {
          conv.updatedAt = Date.now();
          if (title) conv.title = title;
          store.put(conv);
        }
      };
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },
  async listConversations() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction("conversations", "readonly");
      const req = t.objectStore("conversations").getAll();
      req.onsuccess = () => resolve(req.result.sort((a, b) => b.updatedAt - a.updatedAt));
      req.onerror = () => reject(req.error);
    });
  },
  async deleteConversation(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction(["conversations", "messages"], "readwrite");
      t.objectStore("conversations").delete(id);
      const msgStore = t.objectStore("messages");
      const idx = msgStore.index("byConversation");
      const req = idx.openCursor(IDBKeyRange.only(id));
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },

  // ---- messages ----
  async addMessage(conversationId, role, content, extra = {}) {
    const msg = { id: uid(), conversationId, role, content, createdAt: Date.now(), ...extra };
    await tx("messages", "readwrite", (store) => store.put(msg));
    await this.touchConversation(conversationId);
    return msg;
  },
  async listMessages(conversationId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction("messages", "readonly");
      const idx = t.objectStore("messages").index("byConversation");
      const req = idx.getAll(IDBKeyRange.only(conversationId));
      req.onsuccess = () => resolve(req.result.sort((a, b) => a.createdAt - b.createdAt));
      req.onerror = () => reject(req.error);
    });
  },

  // ---- memories ----
  // Each memory: { id, text, category, createdAt, source: 'explicit' }
  async addMemory(text, category = "preference") {
    const mem = { id: uid(), text, category, createdAt: Date.now(), source: "explicit" };
    await tx("memories", "readwrite", (store) => store.put(mem));
    return mem;
  },
  async listMemories() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction("memories", "readonly");
      const req = t.objectStore("memories").getAll();
      req.onsuccess = () => resolve(req.result.sort((a, b) => b.createdAt - a.createdAt));
      req.onerror = () => reject(req.error);
    });
  },
  async deleteMemory(id) {
    return tx("memories", "readwrite", (store) => store.delete(id));
  },

  // ---- export / import ----
  async exportAll() {
    const [conversations, memories] = await Promise.all([this.listConversations(), this.listMemories()]);
    const messages = [];
    for (const c of conversations) {
      messages.push(...(await this.listMessages(c.id)));
    }
    const settingsDb = await openDB();
    const settings = await new Promise((resolve, reject) => {
      const t = settingsDb.transaction("settings", "readonly");
      const req = t.objectStore("settings").getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return {
      schema: "nex-export-v1",
      exportedAt: new Date().toISOString(),
      conversations,
      messages,
      memories,
      settings,
    };
  },

  // Strict schema validation before anything touches the database.
  // Returns { valid, errors, summary } — never partially imports on failure.
  validateImport(data) {
    const errors = [];
    if (!data || typeof data !== "object") errors.push("Top-level value is not an object.");
    else {
      if (data.schema !== "nex-export-v1") errors.push(`Unrecognized schema "${data.schema}".`);
      for (const key of ["conversations", "messages", "memories"]) {
        if (!Array.isArray(data[key])) errors.push(`"${key}" must be an array.`);
      }
      if (Array.isArray(data.conversations)) {
        data.conversations.forEach((c, i) => {
          if (!c || typeof c.id !== "string" || typeof c.title !== "string") {
            errors.push(`conversations[${i}] is missing required string fields (id, title).`);
          }
        });
      }
      if (Array.isArray(data.messages)) {
        data.messages.forEach((m, i) => {
          if (!m || typeof m.id !== "string" || typeof m.conversationId !== "string") {
            errors.push(`messages[${i}] is missing required fields (id, conversationId).`);
          } else if (m.role !== "user" && m.role !== "assistant" && m.role !== "system") {
            errors.push(`messages[${i}] has invalid role "${m.role}".`);
          } else if (typeof m.content !== "string" || m.content.length > 50000) {
            errors.push(`messages[${i}] content must be a string under 50,000 characters.`);
          }
        });
      }
      if (Array.isArray(data.memories)) {
        data.memories.forEach((mm, i) => {
          if (!mm || typeof mm.id !== "string" || typeof mm.text !== "string" || mm.text.length > 2000) {
            errors.push(`memories[${i}] must have id (string) and text (string, <2000 chars).`);
          }
        });
      }
    }
    return {
      valid: errors.length === 0,
      errors,
      summary: errors.length === 0
        ? `${data.conversations.length} conversation(s), ${data.messages.length} message(s), ${data.memories.length} memor${data.memories.length === 1 ? "y" : "ies"}.`
        : null,
    };
  },

  async importAll(data) {
    const check = this.validateImport(data);
    if (!check.valid) {
      throw new Error("Import rejected — malformed backup:\n" + check.errors.slice(0, 8).join("\n"));
    }
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const t = db.transaction(["conversations", "messages", "memories"], "readwrite");
      const convStore = t.objectStore("conversations");
      const msgStore = t.objectStore("messages");
      const memStore = t.objectStore("memories");
      for (const c of data.conversations) convStore.put(c);
      for (const m of data.messages) msgStore.put(m);
      for (const mm of data.memories) memStore.put(mm);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
    return check.summary;
  },

  // One-time migration from the old Nova localStorage blob, if present.
  async migrateFromLocalStorageIfNeeded() {
    const already = await this.getSetting("migratedFromLocalStorage", false);
    if (already) return false;
    let raw;
    try {
      raw = localStorage.getItem(OLD_LOCALSTORAGE_KEY);
    } catch {
      raw = null;
    }
    if (!raw) {
      await this.setSetting("migratedFromLocalStorage", true);
      return false;
    }
    try {
      const old = JSON.parse(raw);
      const conv = await this.createConversation("Imported chat");
      if (Array.isArray(old.messages)) {
        for (const m of old.messages) {
          if (m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant")) {
            await this.addMessage(conv.id, m.role, m.content.slice(0, 50000));
          }
        }
      }
      if (Array.isArray(old.memories)) {
        for (const mm of old.memories) {
          const text = typeof mm === "string" ? mm : mm?.text;
          if (text) await this.addMemory(String(text).slice(0, 2000), "legacy");
        }
      }
      localStorage.removeItem(OLD_LOCALSTORAGE_KEY);
    } catch {
      // Malformed legacy blob — don't let it break startup.
    } finally {
      await this.setSetting("migratedFromLocalStorage", true);
    }
    return true;
  },
};

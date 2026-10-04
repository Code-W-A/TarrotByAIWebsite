// In-memory Firestore model with real materialized-cache reads/writes.
export function createVideoCacheDb(rows = []) {
  const source = new Map(rows.map(row => [row.id, row]));
  const caches = new Map();
  const reads = [];
  let beforeChunkWrite = null;
  const snap = (id, data) => ({ id, exists: data !== undefined, data: () => data });
  function collection(name) {
    const store = name === "internalCaches" ? caches : source;
    function query(filters = [], maximum = null, order = null) {
      function results() {
        let found = [...store.values()].filter(row => filters.every(([key, value]) => row[key] === value));
        if (order) found.sort((a, b) => new Date(b[order] || 0) - new Date(a[order] || 0));
        return maximum === null ? found : found.slice(0, maximum);
      }
      return {
        where: (key, op, value) => { if (op !== "==") throw new Error("Unsupported query"); return query([...filters, [key, value]], maximum, order); },
        orderBy: key => query(filters, maximum, key),
        limit: value => query(filters, value, order),
        select: () => query(filters, maximum, order),
        count: () => ({ get: async () => { reads.push({ name, kind: "count" }); return { data: () => ({ count: results().length }) }; } }),
        get: async () => {
          reads.push({ name, kind: "query", order });
          const docs = results().map(row => snap(row.id, row));
          return { docs, size: docs.length, forEach: fn => docs.forEach(fn) };
        },
      };
    }
    return {
      ...query(),
      doc: id => ({
        id,
        get: async () => { reads.push({ name, id }); return snap(id, store.get(id)); },
        set: async (data, options) => {
          if (id.startsWith("videoLibraryPublic__") && beforeChunkWrite) await beforeChunkWrite(id, data);
          store.set(id, options?.merge ? { ...store.get(id), ...data } : data);
        },
      }),
    };
  }
  // Serialize transactions like Firestore; chunk writes can overlap.
  let transaction = Promise.resolve();
  const db = {
    collection,
    runTransaction(callback) {
      const next = transaction.then(async () => {
        const writes = [];
        const result = await callback({ get: ref => ref.get(), set: (ref, data, options) => writes.push(() => ref.set(data, options)) });
        for (const write of writes) await write();
        return result;
      });
      transaction = next.catch(() => {});
      return next;
    },
  };
  return { db, source, caches, reads, onChunkWrite: callback => { beforeChunkWrite = callback; } };
}

export const videoRow = (index, extra = {}) => ({
  id: `v${index}`, title: `Video ${index}`, isPublished: true, isPremium: true,
  category: "Tarot", platform: "youtube", videoUrl: "https://youtu.be/abc123",
  createdAt: new Date(1700000000000 + index * 1000).toISOString(),
  updatedAt: new Date(1700000000000 + index * 1000).toISOString(), ...extra,
});

export function makeVideoRes() {
  const res = { headers: {}, statusCode: 200 };
  res.setHeader = (key, value) => { res.headers[key] = value; };
  res.status = code => { res.statusCode = code; return res; };
  res.json = payload => { res.body = payload; return res; };
  return res;
}

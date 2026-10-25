import { FieldValue, Timestamp } from 'firebase-admin/firestore';

export function createVideoAdminDb(initial = {}) {
  const store = new Map(Object.entries(initial).map(([key, value]) => [key, { value, version: 1 }]));
  let version = 1, chain = Promise.resolve();
  const reads = [], writes = [];
  let beforeCommit = null;
  function snapshot(key) {
    const row = store.get(key);
    return { id: key.split('/').at(-1), exists: !!row, data: () => row?.value,
      updateTime: row ? new Timestamp(row.version, 0) : undefined };
  }
  function ref(key) {
    return { key, id: key.split('/').at(-1), get: async () => { reads.push(key); return snapshot(key); } };
  }
  function collection(name, filters = [], maximum = Infinity, sort = null) {
    return {
      doc: id => ref(`${name}/${id}`),
      where: (field, _op, value) => collection(name, [...filters, [field, value]], maximum, sort),
      orderBy: field => collection(name, filters, maximum, field),
      limit: n => collection(name, filters, n, sort),
      get: async () => {
        reads.push(name);
        let keys = [...store.keys()].filter(k => k.startsWith(name + '/') && filters.every(([f, v]) => store.get(k).value[f] === v));
        if (sort) keys.sort((a, b) => (store.get(b).value[sort] || 0) - (store.get(a).value[sort] || 0));
        return { docs: keys.slice(0, maximum).map(snapshot) };
      },
    };
  }
  function write(reference, value, options) {
    const resolved = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, v instanceof FieldValue ? new Timestamp(++version, 0) : v]));
    store.set(reference.key, { value: options?.merge ? { ...store.get(reference.key)?.value, ...resolved } : resolved, version: ++version });
    writes.push(reference.key);
  }
  const db = { collection, runTransaction: callback => {
    const result = chain.then(async () => {
      if (beforeCommit) await beforeCommit();
      const pending = [];
      const out = await callback({ get: reference => reference.get(), set: (...args) => pending.push(args) });
      pending.forEach(args => write(...args));
      return out;
    });
    chain = result.catch(() => {});
    return result;
  } };
  return { db, reads, writes, store, set: (key, value) => write(ref(key), value), onTransaction: fn => { beforeCommit = fn; } };
}

export function memoryDb(initial = {}) {
  const rows = new Map(Object.entries(initial));
  let queue = Promise.resolve();
  const reference = (path) => ({
    path,
    id: path.split("/").at(-1),
    get: async () => ({ exists: rows.has(path), data: () => rows.get(path) }),
    set: async (value, options) =>
      rows.set(path, options?.merge ? { ...rows.get(path), ...value } : value),
  });
  const db = {
    rows,
    collection: (name) => ({ doc: (id) => reference(`${name}/${id}`) }),
    runTransaction: (callback) => {
      const operation = queue.then(async () => {
        const writes = [];
        const result = await callback({
          get: (ref) => ref.get(),
          set: (ref, data, options) =>
            writes.push(() => ref.set(data, options)),
        });
        for (const write of writes) await write();
        return result;
      });
      queue = operation.catch(() => {});
      return operation;
    },
  };
  return db;
}
export function subscription(id = "sub_one", changes = {}) {
  return {
    id,
    customer: "cus_one",
    metadata: { uid: "alice", flow: "site_premium" },
    status: "active",
    cancel_at_period_end: false,
    current_period_end: Math.floor(Date.now() / 1000) + 864000,
    items: {
      data: [
        {
          price: {
            unit_amount: 500,
            currency: "eur",
            recurring: { interval: "month" },
          },
        },
      ],
    },
    ...changes,
  };
}
export function stripeFixture(subscriptions, pageSize = 100) {
  const rows = new Map(
    subscriptions.map((sub) => [sub.id, structuredClone(sub)]),
  );
  return {
    rows,
    customers: {
      retrieve: jest.fn(async () => ({ metadata: { uid: "alice" } })),
    },
    subscriptions: {
      list: jest.fn(async ({ starting_after }) => {
        const all = [...rows.values()];
        const start = starting_after
          ? all.findIndex((sub) => sub.id === starting_after) + 1
          : 0;
        return {
          data: structuredClone(all.slice(start, start + pageSize)),
          has_more: start + pageSize < all.length,
        };
      }),
      retrieve: jest.fn(async (id) => {
        if (!rows.has(id)) throw new Error("not_found");
        return structuredClone(rows.get(id));
      }),
      update: jest.fn(async (id, patch) => {
        const sub = rows.get(id);
        Object.assign(sub, patch, {
          metadata: { ...sub.metadata, ...patch.metadata },
        });
        return structuredClone(sub);
      }),
    },
  };
}

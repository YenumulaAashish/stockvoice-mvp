import { MongoClient } from 'mongodb';
import { randomUUID } from 'node:crypto';
export function seed() {
  return [ ['Rice', 'kg', 42, 60, 10], ['Sunflower oil', 'litre', 8, 145, 10], ['Sugar', 'kg', 24, 45, 5], ['Milk', 'litre', 6, 56, 10], ['Eggs', 'dozen', 18, 72, 5], ['Wheat flour', 'kg', 32, 48, 8] ].map(([name, unit, quantity, price, lowStockThreshold]) => ({ id: randomUUID(), name, unit, quantity, price, lowStockThreshold, version: 1 }));
}
export function memoryStore(initial = seed()) {
  let state = { products: initial, events: [], pending: [] };
  const users = new Map();
  const read = ownerId => Object.fromEntries(Object.entries(state).map(([name, rows]) => [name, structuredClone(ownerId ? rows.filter(r => r.ownerId === ownerId) : rows)]));
  function mutate(fn, ownerId) {
    const next = read(ownerId), result = fn(next);
    for (const name of Object.keys(state)) {
      if (ownerId) state[name] = [...state[name].filter(r => r.ownerId !== ownerId), ...next[name].map(r => ({ ...r, ownerId }))];
      else state[name] = next[name];
    }
    return result;
  }
  return {
    read: async () => read(), mutate: async fn => mutate(fn), close: async () => {},
    forOwner: ownerId => ({ read: async () => read(ownerId), mutate: async fn => mutate(fn, ownerId) }),
    users: {
      findById: async id => structuredClone(users.get(id)),
      findByIdentifier: async identifier => structuredClone([...users.values()].find(u => u.username === identifier || u.email === identifier)),
      create: async user => { if ([...users.values()].some(u => u.username === user.username || u.email === user.email)) throw Object.assign(new Error('Duplicate account'), { code: 11000 }); users.set(user.id, structuredClone(user)); },
      revoke: async (id, version) => { const user = users.get(id); if (user?.authVersion === version) { user.authVersion++; user.updatedAt = new Date().toISOString(); } }
    }
  };
}
// Mongo transactions keep product changes, audit entries, and confirmation consumption atomic.
export async function mongoStore(uri, database) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  const hello = await client.db('admin').command({ hello: 1 });
  if (!hello.setName && hello.msg !== 'isdbgrid') { await client.close(); throw new Error('MongoDB must run as a replica set. Use Atlas or follow the README local setup.'); }
  const db = client.db(database);
  for (const name of ['products', 'events', 'pending', 'users']) { if (!(await db.listCollections({ name }).hasNext())) await db.createCollection(name); }
  await db.collection('products').createIndex({ ownerId: 1, nameKey: 1 }, { unique: true });
  const indexes = await db.collection('products').indexes();
  const legacy = indexes.find(index => index.unique && Object.keys(index.key).length === 1 && index.key.nameKey === 1);
  if (legacy) await db.collection('products').dropIndex(legacy.name);
  await db.collection('users').createIndex({ username: 1 }, { unique: true });
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
  await db.collection('pending').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  async function read(session, ownerId) {
    if (!ownerId) throw new Error('Owner required');
    const state = {};
    for (const name of ['products', 'events', 'pending']) state[name] = (await db.collection(name).find({ ownerId }, { session }).toArray()).map(({ _id, ...row }) => row);
    return state;
  }
  const mutate = async (fn, ownerId) => {
    const session = client.startSession();
    try { return await session.withTransaction(async () => {
      const before = await read(session, ownerId), after = structuredClone(before);
      const result = fn(after);
      for (const name of ['products', 'events', 'pending']) {
        const old = new Map(before[name].map(x => [x.id, x]));
        for (const row of after[name]) {
          if (ownerId) row.ownerId = ownerId;
          if (!old.has(row.id)) await db.collection(name).insertOne({ ...row, _id: row.id }, { session });
          else if (JSON.stringify(row) !== JSON.stringify(old.get(row.id))) await db.collection(name).replaceOne({ _id: row.id, ownerId }, { ...row, _id: row.id }, { session });
          old.delete(row.id);
        }
        for (const id of old.keys()) await db.collection(name).deleteOne({ _id: id, ownerId }, { session });
      }
      return result;
    }); } finally { await session.endSession(); }
  };
  return {
    close: () => client.close(),
    forOwner: ownerId => { if (!ownerId) throw new Error('Owner required'); return { read: () => read(undefined, ownerId), mutate: fn => mutate(fn, ownerId) }; },
    users: {
      findById: id => db.collection('users').findOne({ _id: id }),
      findByIdentifier: identifier => db.collection('users').findOne({ $or: [{ username: identifier }, { email: identifier }] }),
      create: user => db.collection('users').insertOne({ ...user, _id: user.id }),
      revoke: (id, version) => db.collection('users').updateOne({ _id: id, authVersion: version }, { $inc: { authVersion: 1 }, $set: { updatedAt: new Date().toISOString() } })
    }
  };
}

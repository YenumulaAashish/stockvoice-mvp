import { register, seedOwner, jwtSecret } from './fixtures.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app.js';
import { memoryStore, seed } from '../store.js';
import { extractIntent, parseDemo } from '../services/intent.js';
import { transcribe } from '../services/stt.js';

async function setup(dependencies = {}) {
  const store = memoryStore();
  const app = createApp(store, { demo: true, port: 3001, jwtSecret }, dependencies);
  const { agent, user } = await register(app);
  await seedOwner(store, user.id);
  return { store, agent, app };
}
async function prepare(agent, transcript = 'add 5 kg Rice') { return (await agent.post('/api/commands').send({ transcript }).expect(200)).body.confirmation; }
test('preview and cancel never change stock or audit history', async () => {
  const { store, agent } = await setup(); const before = await store.read();
  const pending = await prepare(agent);
  assert.equal(pending.before, 42); assert.equal(pending.after, 47);
  assert.deepEqual((await store.read()).products, before.products);
  await agent.delete(`/api/confirmations/${pending.id}`).expect(204);
  await agent.post(`/api/confirmations/${pending.id}`).send({}).expect(409);
  assert.equal((await store.read()).events.length, 0);
});
test('confirmation applies exactly once and preserves original transcript', async () => {
  const { store, agent } = await setup(); const pending = await prepare(agent);
  await agent.post(`/api/confirmations/${pending.id}`).send({}).expect(200);
  await agent.post(`/api/confirmations/${pending.id}`).send({}).expect(409);
  const state = await store.read(); assert.equal(state.products.find(p => p.name === 'Rice').quantity, 47);
  assert.equal(state.events.length, 1); assert.equal(state.events[0].transcript, 'add 5 kg Rice');
});
test('simultaneous removals reject stale preview and prevent negative stock', async () => {
  const { store, agent } = await setup(); const a = await prepare(agent, 'remove 30 kg Rice'), b = await prepare(agent, 'remove 30 kg Rice');
  const results = await Promise.all([a, b].map(p => agent.post(`/api/confirmations/${p.id}`).send({})));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal((await store.read()).products.find(p => p.name === 'Rice').quantity, 12);
});
test('another browser cannot consume the confirmation', async () => {
  const { agent, app } = await setup(); const p = await prepare(agent);
  await request(app).post(`/api/confirmations/${p.id}`).send({}).expect(401);
  await agent.post(`/api/confirmations/${p.id}`).send({}).expect(200);
});
test('expired confirmations cannot mutate inventory', async () => {
  const { agent, store } = await setup(); const p = await prepare(agent);
  await store.mutate(s => { s.pending[0].expiresAt = new Date(0); });
  await agent.post(`/api/confirmations/${p.id}`).send({}).expect(409);
  assert.equal((await store.read()).events.length, 0);
});
test('unsafe and unsupported demo commands are rejected', async () => {
  const { agent, store } = await setup();
  for (const transcript of ['remove 100 kg Rice', 'add 0 kg Rice', 'add -5 kg Rice', 'add 5 litre Rice', 'add 5 kg Unknown', 'add 1.5 dozen Eggs', 'add 1000001 kg Rice', 'add 0.0001 kg Rice', 'add Rice', 'remove 2 kg Rice at 99', 'add 2 kg Rice and remove 1 kg Sugar']) await agent.post('/api/commands').send({ transcript }).expect(400);
  assert.equal((await store.read()).events.length, 0);
});
test('query commands are read-only', async () => {
  const { agent, store } = await setup();
  const check = await agent.post('/api/commands').send({ transcript: 'check Rice' }).expect(200);
  assert.equal(check.body.products[0].quantity, 42);
  const low = await agent.post('/api/commands').send({ transcript: 'low stock' }).expect(200);
  assert.equal(low.body.products.length, 2); assert.equal((await store.read()).pending.length, 0);
});
test('manual create, edit, delete are confirmed and retained in history', async () => {
  const { agent, store } = await setup();
  const product = { name: 'Salt', quantity: 3, unit: 'kg', price: 20, lowStockThreshold: 2 };
  const created = await agent.post('/api/products/prepare').send({ operation: 'CREATE', product }).expect(200);
  assert.equal((await store.read()).products.length, 6);
  const saved = await agent.post(`/api/confirmations/${created.body.confirmation.id}`).send({}).expect(200);
  const id = saved.body.product.id;
  const update = await agent.post('/api/products/prepare').send({ operation: 'UPDATE', id, product: { ...product, quantity: 5, price: 21 } }).expect(200);
  await agent.post(`/api/confirmations/${update.body.confirmation.id}`).send({}).expect(200);
  const remove = await agent.post('/api/products/prepare').send({ operation: 'DELETE', id }).expect(200);
  await agent.post(`/api/confirmations/${remove.body.confirmation.id}`).send({}).expect(200);
  const state = await store.read(); assert.equal(state.products.length, 6); assert.equal(state.events.length, 3); assert.equal(state.events[2].before, 5);
});
test('manual validation rejects duplicates, negative fields and unit changes', async () => {
  const { agent, store } = await setup(); const rice = (await store.read()).products[0];
  const product = { name: ' rice ', quantity: 1, unit: 'kg', price: 1, lowStockThreshold: 1 };
  await agent.post('/api/products/prepare').send({ operation: 'CREATE', product }).expect(409);
  for (const change of [{ quantity: -1 }, { price: -1 }, { unit: 'ton' }, { lowStockThreshold: -1 }, { name: '' }]) await agent.post('/api/products/prepare').send({ operation: 'CREATE', product: { ...product, ...change } }).expect(400);
  await agent.post('/api/products/prepare').send({ operation: 'UPDATE', id: rice.id, product: { ...product, unit: 'litre' } }).expect(400);
});
test('price change is included in preview and only saved on confirmation', async () => {
  const { agent, store } = await setup(); const p = await prepare(agent, 'add 2 kg Rice at 65');
  assert.equal(p.price, 65); assert.equal(p.previousPrice, 60);
  assert.equal((await store.read()).products[0].price, 60);
  await agent.post(`/api/confirmations/${p.id}`).send({}).expect(200);
  assert.equal((await store.read()).products[0].price, 65);
});
test('invalid AI output is blocked by deterministic validation', async () => {
  for (const change of [{ quantity: -2 }, { quantity: '2' }, { intent: 'DELETE_ALL' }, { unit: 'ton' }, { price: -20 }, { needsClarification: true }, { injected: true }]) {
    const { agent, store } = await setup({ extractIntent: async () => ({ ...parseDemo('add 2 kg Rice'), ...change }) });
    await agent.post('/api/commands').send({ transcript: 'some speech' }).expect(400);
    assert.equal((await store.read()).pending.length, 0);
  }
});
test('Gemini adapter sends schema and parses strict JSON, no tools', async () => {
  const config = { geminiKey: 'test-key', geminiModel: 'test-model' };
  const expected = parseDemo('add 5 kg Rice');
  const value = await extractIntent('Rice 5 kg add cheyyi', seed(), config, async (url, options) => {
    const body = JSON.parse(options.body); assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.equal(body.tools, undefined); assert.ok(body.systemInstruction); assert.equal(options.headers['x-goog-api-key'], 'test-key');
    return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(expected) }] } }] }) };
  });
  assert.deepEqual(value, expected);
  for (const text of ['```json\n{}\n```', '{"intent":"DELETE"}', 'not json']) await assert.rejects(extractIntent('test', [], config, async () => ({ ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] }) })), /could not understand/);
});
test('cross-origin mutation and missing voice settings produce actionable errors', async () => {
  const { agent } = await setup();
  await agent.post('/api/commands').set('Origin', 'https://evil.example').send({ transcript: 'check Rice' }).expect(403);
  await agent.post('/api/transcribe').expect(503);
});
test('production accepts same-origin mutations and rejects cross-origin mutations', async () => {
  const store = memoryStore();
  const app = createApp(store, { demo: true, port: 3001, jwtSecret, production: true });
  const { agent, user, cookie } = await register(app, 'origin');
  await seedOwner(store, user.id);
  await agent.post('/api/commands').set('Cookie', cookie).set('Host', 'stockvoice.example').set('Origin', 'https://stockvoice.example').send({ transcript: 'check Rice' }).expect(200);
  await agent.post('/api/commands').set('Host', 'stockvoice.example').set('Origin', 'https://evil.example').send({ transcript: 'check Rice' }).expect(403);
});

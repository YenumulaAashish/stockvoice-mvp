import { installAuth } from './auth.js';
import express from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { z, ZodError } from 'zod';
import { productSchema, validateProduct, resolveCommand, transcriptSchema, key, fail } from './rules.js';
import { extractIntent } from './services/intent.js';
import { transcribe } from './services/stt.js';

export function createApp(store, config, dependencies = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (config.production) app.set('trust proxy', 1);
  app.use(express.json({ limit: '16kb' }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin) {
      let originHost;
      try { originHost = new URL(req.headers.origin).host; } catch { return res.status(403).json({ error: 'Origin not allowed.' }); }
      const developmentOrigins = new Set(['localhost:5173', '127.0.0.1:5173', `localhost:${config.port}`, `127.0.0.1:${config.port}`]);
      if (originHost !== req.headers.host && (config.production || !developmentOrigins.has(originHost))) return res.status(403).json({ error: 'Origin not allowed.' });
    }
    next();
  });
  app.use('/api', rateLimit({ windowMs: 60000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many requests. Wait a minute and try again.' } }));
  installAuth(app, store, config);
  const costly = rateLimit({ windowMs: 60000, limit: 15, message: { error: 'Too many AI requests. Wait a minute and try again.' } });
  app.get('/api/dashboard', async (req, res) => {
    const state = await req.inventory.read();
    res.json({ products: state.products.sort((a, b) => a.name.localeCompare(b.name)), transactions: state.events.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50), mode: config.demo ? 'demo' : 'live', voiceReady: Boolean(config.geminiKey && config.sttModel) });
  });
  async function prepare(req, action) {
    return req.inventory.mutate(state => {
      state.pending = state.pending.filter(p => new Date(p.expiresAt).getTime() > Date.now());
      if (state.pending.filter(p => p.owner === req.owner).length >= 20) fail('Too many pending changes. Cancel a change or wait five minutes.', 429);
      const pending = { ...action, id: randomUUID(), owner: req.owner, ownerId: req.owner, expiresAt: new Date(Date.now() + 5 * 60000) };
      state.pending.push(pending);
      return { id: pending.id, expiresAt: pending.expiresAt, ...action.preview };
    });
  }
  app.post('/api/commands', costly, async (req, res) => {
    const transcript = transcriptSchema.parse(req.body?.transcript);
    const state = await req.inventory.read();
    const raw = await (dependencies.extractIntent || extractIntent)(transcript, state.products, config);
    const result = resolveCommand(raw, state.products);
    if (result.products) return res.json({ type: 'result', intent: result.command.intent, products: result.products });
    const { product, command, after } = result;
    const preview = { title: command.intent === 'ADD_STOCK' ? 'Add stock' : 'Remove stock', name: product.name, unit: product.unit, before: product.quantity, after, price: command.price ?? product.price, previousPrice: product.price, quantity: command.quantity, transcript };
    res.json({ type: 'confirmation', confirmation: await prepare(req, { kind: 'COMMAND', command, productId: product.id, version: product.version, transcript, preview }) });
  });
  // Manual CRUD uses the same preview/confirm protocol as spoken stock changes.
  app.post('/api/products/prepare', async (req, res) => {
    const body = z.object({ operation: z.enum(['CREATE', 'UPDATE', 'DELETE']), id: z.string().uuid().optional(), product: productSchema.optional() }).strict().parse(req.body);
    const state = await req.inventory.read();
    const existing = state.products.find(p => p.id === body.id);
    if (body.operation !== 'CREATE' && !existing) fail('Product no longer exists.', 404);
    if (body.operation !== 'DELETE') {
      if (!body.product) fail('Product details are required.');
      validateProduct(body.product);
      if (existing && existing.unit !== body.product.unit) fail('Units cannot be changed. Create a separate product for a different unit.');
      if (state.products.some(p => p.id !== body.id && key(p.name) === key(body.product.name))) fail('A product with that name already exists.', 409);
    }
    const preview = { title: { CREATE: 'Create product', UPDATE: 'Update product', DELETE: 'Delete product' }[body.operation], name: body.product?.name ?? existing.name, unit: body.product?.unit ?? existing.unit, before: existing?.quantity ?? 0, after: body.operation === 'DELETE' ? null : body.product.quantity, price: body.product?.price ?? existing.price, previousPrice: existing?.price, lowStockThreshold: body.product?.lowStockThreshold, transcript: `Manual ${body.operation.toLowerCase()}: ${body.product?.name ?? existing.name}` };
    res.json({ confirmation: await prepare(req, { kind: body.operation, productId: existing?.id ?? randomUUID(), version: existing?.version, product: body.product, transcript: preview.transcript, preview }) });
  });
  app.delete('/api/confirmations/:id', async (req, res) => {
    await req.inventory.mutate(state => { state.pending = state.pending.filter(p => !(p.id === req.params.id && p.owner === req.owner)); });
    res.status(204).end();
  });
  app.post('/api/confirmations/:id', async (req, res) => {
    const outcome = await req.inventory.mutate(state => {
      const pending = state.pending.find(p => p.id === req.params.id && p.owner === req.owner);
      if (!pending || new Date(pending.expiresAt).getTime() <= Date.now()) fail('Confirmation expired or already used. Prepare the change again.', 409);
      const existing = state.products.find(p => p.id === pending.productId);
      if (pending.kind !== 'CREATE' && (!existing || existing.version !== pending.version)) fail('Stock changed since this preview. Cancel and prepare the command again.', 409);
      const before = existing ? structuredClone(existing) : null;
      let after, type = pending.kind;
      if (pending.kind === 'COMMAND') {
        const resolved = resolveCommand(pending.command, state.products);
        existing.quantity = resolved.after;
        existing.price = pending.command.price ?? existing.price;
        existing.version++;
        after = existing;
        type = pending.command.intent;
      } else if (pending.kind === 'DELETE') {
        state.products = state.products.filter(p => p.id !== pending.productId);
        after = null;
      } else {
        validateProduct(pending.product);
        if (state.products.some(p => p.id !== pending.productId && key(p.name) === key(pending.product.name))) fail('A product with that name already exists.', 409);
        after = { ...pending.product, ownerId: req.owner, id: pending.productId, nameKey: key(pending.product.name), version: (existing?.version ?? 0) + 1 };
        if (existing) Object.assign(existing, after); else state.products.push(after);
      }
      const event = { id: randomUUID(), ownerId: req.owner, productId: pending.productId, type, name: after?.name ?? before.name, unit: after?.unit ?? before.unit, before: before?.quantity ?? 0, after: after?.quantity ?? 0, previousPrice: before?.price ?? null, price: after?.price ?? null, transcript: pending.transcript, createdAt: new Date().toISOString() };
      state.events.push(event);
      state.pending = state.pending.filter(p => p.id !== pending.id);
      return { transaction: event, product: after };
    });
    res.json(outcome);
  });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 1, fields: 1 } });
  app.post('/api/transcribe', costly, upload.single('audio'), async (req, res) => {
    res.json({ transcript: await (dependencies.transcribe || transcribe)(req.file, req.body?.language || 'auto', config) });
  });
  app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));
  app.use((error, req, res, next) => {
    if (error instanceof ZodError) return res.status(400).json({ error: error.issues.map(i => `${i.path.join('.') || 'Input'}: ${i.message}`).join('; ') });
    if (error instanceof multer.MulterError) return res.status(400).json({ error: 'Recording too large or invalid. Limit recordings to 60 seconds / 12 MB.' });
    if (error.code === 11000) return res.status(409).json({ error: 'A product with that name already exists.' });
    if (['TimeoutError', 'AbortError'].includes(error.name)) return res.status(504).json({ error: 'The provider took too long. Please try again.' });
    const status = error.status || 500;
    if (status === 500) console.error('Request failed:', error.name);
    res.status(status).json({ error: status === 500 ? 'Something went wrong. Please try again.' : error.message });
  });
  return app;
}

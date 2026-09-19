import { register, seedOwner, jwtSecret } from './fixtures.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { transcribe } from '../services/stt.js';
import { createApp } from '../app.js';
import { memoryStore } from '../store.js';

const config = { jwtSecret, demo: false, geminiKey: 'test-secret', sttModel: 'gemini-3.5-transcribe', port: 3001 };
const audio = { size: 4, buffer: Buffer.from('test'), mimetype: 'audio/webm;codecs=opus' };
test('Gemini receives audio bytes, verbatim mode and language hints for every supported format', async () => {
  for (const language of ['auto', 'en', 'te']) for (const mime of ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg']) {
    const output = await transcribe({ ...audio, mimetype: mime }, language, config, { interactions: { create: async (body, options) => {
      assert.equal(body.model, config.sttModel);
      assert.equal(body.store, false);
      assert.equal(body.input[0].data, audio.buffer.toString('base64'));
      assert.equal(body.input[0].mime_type, mime === 'audio/mp4' ? 'audio/m4a' : mime === 'audio/x-wav' ? 'audio/wav' : mime);
      assert.deepEqual(body.generation_config.transcription_config.mode, { type: 'verbatim' });
      assert.deepEqual(body.generation_config.transcription_config.language_codes, language === 'auto' ? undefined : [language === 'te' ? 'te-IN' : 'en-US']);
      assert.ok(options.signal);
      return { output_text: '  Rice rendu kg ammesanu  ' };
    } } });
    assert.equal(output, 'Rice rendu kg ammesanu');
  }
});
test('Gemini readiness needs key and model, without a separate STT key', async () => {
  for (const [settings, ready] of [[config, true], [{ ...config, geminiKey: '' }, false], [{ ...config, sttModel: '' }, false]]) {
    const { agent } = await register(createApp(memoryStore(), settings));
    const result = await agent.get('/api/dashboard').expect(200);
    assert.equal(result.body.voiceReady, ready);
  }
});
test('empty audio, unsupported input and missing configuration fail before provider calls', async () => {
  await assert.rejects(transcribe(audio, 'auto', {}), { status: 503 });
  await assert.rejects(transcribe(null, 'auto', config), { status: 400 });
  await assert.rejects(transcribe({ ...audio, mimetype: 'text/plain' }, 'auto', config), { status: 400 });
  await assert.rejects(transcribe(audio, 'fr', config), { status: 400 });
  await assert.rejects(transcribe(audio, 'auto', config, { interactions: { create: async () => ({ output_text: ' ' }) } }), { status: 422 });
  const original = console.error; console.error = () => {};
  try {
    await assert.rejects(transcribe(audio, 'auto', config, { interactions: { create: async () => { const error = new Error('timeout'); error.name = 'RequestTimeoutError'; throw error; } } }), { status: 504 });
  } finally { console.error = original; }
});
test('provider errors are redacted in logs and clean in the frontend', async () => {
  const original = console.error; const logs = []; console.error = (...args) => logs.push(JSON.stringify(args));
  try {
    await assert.rejects(transcribe(audio, 'auto', config, { interactions: { create: async () => { throw new Error('provider error test-secret'); } } }), error => error.status === 502 && !error.message.includes('test-secret'));
    assert.ok(!logs[0].includes('test-secret'));
  } finally { console.error = original; }
});
const cases = [
  ['Add 5 kg rice', 'ADD_STOCK', 5], ['Rice 5 kg add cheyyi', 'ADD_STOCK', 5],
  ['Rice rendu kg ammesanu', 'REMOVE_STOCK', 2], ['Rice entha undi?', 'CHECK_STOCK', null], ['Low stock items enti?', 'LOW_STOCK', null]
];
for (const [text, intent, quantity] of cases) test(`transcript routing and confirmation: ${text}`, async () => {
  const store = memoryStore();
  const app = createApp(store, config, {
    transcribe: (file, language, settings) => transcribe(file, language, settings, { interactions: { create: async () => ({ output_text: text }) } }),
    extractIntent: async () => ({ intent, quantity, product: intent === 'LOW_STOCK' ? null : 'Rice', unit: quantity ? 'kg' : null, price: null, needsClarification: false })
  });
  const { agent, user } = await register(app);
  await seedOwner(store, user.id);
  const before = (await store.read()).products;
  const speech = await agent.post('/api/transcribe').field('language', 'auto').attach('audio', audio.buffer, { filename: 'speech.webm', contentType: 'audio/webm' }).expect(200);
  assert.equal(speech.body.transcript, text);
  const result = await agent.post('/api/commands').send({ transcript: speech.body.transcript }).expect(200);
  assert.deepEqual((await store.read()).products, before);
  assert.equal(result.body.type, quantity ? 'confirmation' : 'result');
  if (quantity) { await agent.post(`/api/confirmations/${result.body.confirmation.id}`).send({}).expect(200); assert.equal((await store.read()).events[0].transcript, text); }
});

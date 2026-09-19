import test from 'node:test';
import assert from 'node:assert/strict';
import { withRetry, TEMPORARY_MESSAGE } from '../services/retry.js';
import { extractIntent, parseDemo } from '../services/intent.js';
import { transcribe } from '../services/stt.js';
import { resolveCommand } from '../rules.js';
import { seed } from '../store.js';
import { speakResponse, transactionReply, resultReply } from '../../src/speech.js';

test('temporary provider failures get exactly three retries at 1, 2, 4 seconds', async () => {
  for (const status of [429, 503]) {
    let calls = 0; const delays = [], logs = [];
    await assert.rejects(withRetry(async () => { calls++; throw Object.assign(new Error('secret provider details'), { status }); }, { wait: async ms => delays.push(ms), log: text => logs.push(text) }), e => e.message === TEMPORARY_MESSAGE && e.status === 503);
    assert.equal(calls, 4); assert.deepEqual(delays, [1000, 2000, 4000]); assert.equal(logs.length, 3);
    assert.ok(logs.every(s => !s.includes('secret')));
  }
});
test('successful retry returns once; invalid, auth and validation errors are never retried', async () => {
  let calls = 0;
  assert.equal(await withRetry(async () => { if (++calls < 3) throw { statusCode: 503 }; return 'ok'; }, { wait: async () => {}, log: () => {} }), 'ok');
  for (const status of [400, 401, 403, 404, 422, 500, undefined]) {
    calls = 0;
    await assert.rejects(withRetry(async () => { calls++; throw Object.assign(new Error('failed'), { status }); }, { wait: async () => assert.fail('Must not back off') }));
    assert.equal(calls, 1);
  }
});
test('intent provider retries HTTP 503 before parsing the command', async () => {
  let calls = 0; const expected = parseDemo('add 5 kg Rice');
  const result = await extractIntent('Add 5 kg Rice', seed(), { geminiKey: 'test', geminiModel: 'test' }, async () => ++calls === 1 ? { ok: false, status: 503 } : { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(expected) }] } }] }) });
  assert.equal(calls, 2); assert.deepEqual(result, expected);
});
test('transcription retries SDK 429 and disables SDK automatic retries', async () => {
  let calls = 0;
  const value = await transcribe({ size: 1, buffer: Buffer.from('a'), mimetype: 'audio/webm' }, 'auto', { geminiKey: 'test', sttModel: 'gemini-3.5-transcribe' }, { interactions: { create: async (body, options) => {
    assert.deepEqual(options.retries, { strategy: 'none' });
    if (++calls === 1) throw Object.assign(new Error('limited'), { statusCode: 429 });
    return { output_text: 'Rice entha undi?' };
  } } });
  assert.equal(calls, 2); assert.equal(value, 'Rice entha undi?');
});
test('quantity clarification and insufficient-stock response use deterministic checks', () => {
  assert.throws(() => resolveCommand({ ...parseDemo('add 5 kg Rice'), quantity: null, needsClarification: true }, seed()), /Quantity is missing/);
  assert.throws(() => resolveCommand(parseDemo('remove 100 kg Rice'), seed()), /Only 42 kg are available/);
});
test('spoken stock results and success quantities come only from backend data', () => {
  assert.equal(resultReply({ intent: 'CHECK_STOCK', products: [{ name: 'Rice', quantity: 12, unit: 'kg' }] }), 'Rice stock is 12 kilograms.');
  assert.equal(transactionReply({ type: 'ADD_STOCK', name: 'Rice', before: 12, after: 17, unit: 'kg' }), '5 kilograms of Rice added successfully. Current stock is 17 kilograms.');
  assert.equal(transactionReply({ type: 'REMOVE_STOCK', name: 'Rice', before: 17, after: 15, unit: 'kg' }), '2 kilograms of Rice removed successfully. Current stock is 15 kilograms.');
  assert.match(resultReply({ intent: 'LOW_STOCK', products: [{ name: 'Rice', quantity: 3, unit: 'kg' }] }), /Only 3 kilograms/);
  assert.equal(resultReply({ intent: 'LOW_STOCK', products: [] }), 'No products are running low.');
  assert.match(resultReply({ intent: 'LOW_STOCK', products: ['Rice', 'Oil', 'Biscuits'].map(name => ({ name })) }), /^3 products are running low/);
});
test('speech cancels the previous utterance and selects Telugu only when available', () => {
  const events = []; let voices = [{ lang: 'te-IN' }, { lang: 'en-IN' }];
  const browser = { SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } }, speechSynthesis: { cancel: () => events.push('cancel'), getVoices: () => voices, speak: u => events.push(u) } };
  speakResponse({ englishText: 'Stock is 5 kilograms.', teluguText: 'స్టాక్ 5 కిలోలు ఉంది.', replyLanguage: 'te' }, browser);
  assert.equal(events[0], 'cancel'); assert.equal(events[1].lang, 'te-IN');
  voices = []; speakResponse({ englishText: 'Stock is 5 kilograms.', teluguText: 'స్టాక్ 5 కిలోలు ఉంది.', replyLanguage: 'te' }, browser); assert.equal(events[3].lang, 'te-IN');
  speakResponse({ englishText: 'Query result', teluguText: 'ఫలితం', replyLanguage: 'en' }, browser); assert.equal(events[5].lang, 'en-IN');
  assert.doesNotThrow(() => speakResponse({ englishText: 'Still show text', teluguText: 'ఫలితం', replyLanguage: 'en' }, {}));
});

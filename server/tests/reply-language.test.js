import test from 'node:test';
import assert from 'node:assert/strict';
import { resultResponse, transactionResponse, messageResponse, speakResponse, replyText, loadReplyLanguage, saveReplyLanguage } from '../../src/speech.js';
test('English and Telugu response templates retain backend quantities', () => {
  const response = resultResponse({ intent: 'CHECK_STOCK', products: [{ name: 'Rice', quantity: 12, unit: 'kg' }] });
  assert.equal(response.englishText, 'Rice stock is 12 kilograms.');
  assert.equal(response.teluguText, 'బియ్యం స్టాక్ 12 కిలోలు ఉంది.');
  for (const [type, before, after] of [['ADD_STOCK', 12, 17], ['REMOVE_STOCK', 17, 15]]) {
    const saved = transactionResponse({ type, before, after, unit: 'kg', name: 'Rice' });
    assert.ok(saved.teluguText.includes(String(Math.abs(after - before))));
    assert.ok(saved.teluguText.includes(`స్టాక్ ${after} కిలోలు`));
  }
  assert.match(messageResponse('Unable to remove 20 kg of Rice. Only 8 kg are available.').teluguText, /20.*8/);
  for (const message of ['Operation cancelled.', 'Quantity is missing. Please say the command again.', 'I could not understand that inventory command. Please try again.', 'Something went wrong. Please try again.', 'AI service is temporarily unavailable. Please try again.']) assert.match(messageResponse(message).teluguText, /[\u0c00-\u0c7f]/);
});
test('reply preference persists and is independent of any input language', () => {
  const values = new Map(); const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.equal(loadReplyLanguage(storage), 'en'); saveReplyLanguage('te', storage); assert.equal(loadReplyLanguage(storage), 'te');
  assert.equal(values.get('stockvoice_reply_language'), 'te');
  const response = resultResponse({ intent: 'CHECK_STOCK', products: [{ name: 'Rice', quantity: 12, unit: 'kg' }] });
  for (const input of ['English input', 'Telugu input', 'Mixed input']) assert.equal(replyText(response, loadReplyLanguage(storage)), 'బియ్యం స్టాక్ 12 కిలోలు ఉంది.');
  assert.equal(loadReplyLanguage({ getItem: () => { throw new Error('blocked'); } }), 'en');
});
test('missing Telugu voice still requests Telugu, displays warning and keeps Telugu text', () => {
  let spoken; const notices = [];
  const browser = { SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } }, speechSynthesis: { cancel() {}, getVoices: () => [{ lang: 'en-IN' }], speak: utterance => { spoken = utterance; } } };
  speakResponse({ englishText: 'Cancelled', teluguText: 'రద్దు చేయబడింది.', replyLanguage: 'te', onUnavailable: value => notices.push(value) }, browser);
  assert.equal(spoken.lang, 'te-IN'); assert.equal(spoken.text, 'రద్దు చేయబడింది.'); assert.equal(spoken.voice, undefined);
  assert.equal(notices[0], 'Telugu voice is not available on this device.');
});

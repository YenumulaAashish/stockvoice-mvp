export function stopSpeaking(browser = globalThis.window) {
  try { browser?.speechSynthesis?.cancel(); } catch { /* Text remains available. */ }
}
export function speakResponse({ englishText, teluguText, replyLanguage = 'en', onUnavailable = () => {} }, browser = globalThis.window) {
  if (!browser?.speechSynthesis || !browser.SpeechSynthesisUtterance) {
    if (replyLanguage === 'te') onUnavailable('Telugu voice is not available on this device.');
    return;
  }
  try {
    const synth = browser.speechSynthesis;
    synth.cancel();
    const lang = replyLanguage === 'te' ? 'te-IN' : 'en-IN';
    const voices = synth.getVoices();
    const voice = voices.find(v => v.lang.toLowerCase() === lang.toLowerCase()) || voices.find(v => v.lang.toLowerCase().startsWith(replyLanguage));
    const utterance = new browser.SpeechSynthesisUtterance(replyLanguage === 'te' ? teluguText : englishText);
    utterance.lang = lang;
    if (voice) utterance.voice = voice;
    if (replyLanguage === 'te' && !voice) onUnavailable('Telugu voice is not available on this device.');
    utterance.onerror = event => { if (replyLanguage === 'te' && !['canceled', 'interrupted'].includes(event.error)) onUnavailable('Telugu voice is not available on this device.'); };
    synth.speak(utterance);
  } catch { if (replyLanguage === 'te') onUnavailable('Telugu voice is not available on this device.'); }
}
export function loadReplyLanguage(storage) {
  try { return (storage ?? globalThis.localStorage)?.getItem('stockvoice_reply_language') === 'te' ? 'te' : 'en'; } catch { return 'en'; }
}
export function saveReplyLanguage(value, storage) {
  try { (storage ?? globalThis.localStorage)?.setItem('stockvoice_reply_language', value === 'te' ? 'te' : 'en'); } catch { /* Storage may be unavailable. */ }
}
export const replyText = (response, language) => language === 'te' ? response.teluguText : response.englishText;
const productTe = name => ({ rice: 'బియ్యం', sugar: 'చక్కెర', milk: 'పాలు', mango: 'మామిడి', eggs: 'గుడ్లు', 'sunflower oil': 'పొద్దుతిరుగుడు నూనె', 'wheat flour': 'గోధుమ పిండి' }[name.toLowerCase()] || name);
const amountTe = (n, unit) => `${n} ${{ kg: 'కిలోలు', litre: 'లీటర్లు', piece: 'ముక్కలు', bag: 'బస్తాలు', dozen: 'డజన్లు' }[unit] || unit}`;
const pair = (englishText, teluguText) => ({ englishText, teluguText });
export function resultResponse(result) {
  const items = result.products;
  let te;
  if (result.intent === 'CHECK_STOCK') te = items.map(p => `${productTe(p.name)} స్టాక్ ${amountTe(p.quantity, p.unit)} ఉంది.`).join(' ');
  else if (!items.length) te = 'ఏ ఉత్పత్తి స్టాక్ తక్కువగా లేదు.';
  else if (items.length === 1) { const p = items[0]; te = `${productTe(p.name)} స్టాక్ తక్కువగా ఉంది. ఇంకా ${amountTe(p.quantity, p.unit)} మాత్రమే ఉన్నాయి.`; }
  else te = `${items.length} ఉత్పత్తుల స్టాక్ తక్కువగా ఉంది. ${items.slice(0, 3).map(p => productTe(p.name)).join(', ')}${items.length > 3 ? ', మరియు ఇతర ఉత్పత్తులు' : ''}.`;
  return pair(resultReply(result), te);
}
export function transactionResponse(t) {
  const name = productTe(t.name), quantity = Math.round(Math.abs(t.after - t.before) * 1000) / 1000;
  const current = `ప్రస్తుతం స్టాక్ ${amountTe(t.after, t.unit)} ఉంది.`;
  const te = t.type === 'ADD_STOCK' ? `${amountTe(quantity, t.unit)} ${name} విజయవంతంగా జోడించబడింది. ${current}`
    : t.type === 'REMOVE_STOCK' ? `${amountTe(quantity, t.unit)} ${name} విజయవంతంగా తీసివేయబడింది. ${current}`
    : t.type === 'DELETE' ? `${name} విజయవంతంగా తొలగించబడింది.` : `${name} విజయవంతంగా సేవ్ చేయబడింది. ${current}`;
  return pair(transactionReply(t), te);
}
export function messageResponse(message) {
  const translations = {
    'Operation cancelled.': 'ఆపరేషన్ రద్దు చేయబడింది.',
    'Something went wrong. Please try again.': 'ఏదో సమస్య వచ్చింది. దయచేసి మళ్లీ ప్రయత్నించండి.',
    'AI service is temporarily unavailable. Please try again.': 'AI సేవ ప్రస్తుతం అందుబాటులో లేదు. దయచేసి మళ్లీ ప్రయత్నించండి.',
    'I could not understand that. Please try again.': 'మీ మాట స్పష్టంగా అర్థం కాలేదు. దయచేసి మళ్లీ ప్రయత్నించండి.',
    'I could not understand the voice clearly. Please try again.': 'మీ మాట స్పష్టంగా అర్థం కాలేదు. దయచేసి మళ్లీ ప్రయత్నించండి.',
    'I could not understand that inventory command. Please try again.': 'ఆ ఇన్వెంటరీ కమాండ్ నాకు అర్థం కాలేదు. దయచేసి మళ్లీ ప్రయత్నించండి.',
    'Quantity is missing. Please say the command again.': 'పరిమాణం చెప్పలేదు. దయచేసి కమాండ్‌ను మళ్లీ చెప్పండి.',
    'Unit is missing. Please say the command again.': 'ప్రమాణం చెప్పలేదు. దయచేసి కమాండ్‌ను మళ్లీ చెప్పండి.',
    'Confirmation required. Please review the stock change.': 'దయచేసి స్టాక్ మార్పును పరిశీలించి నిర్ధారించండి.',
    'Confirmation required. Please review the change.': 'దయచేసి మార్పును పరిశీలించి నిర్ధారించండి.',
    'Transcript ready. Check the words, then select Review command.': 'మీ మాటలు సిద్ధంగా ఉన్నాయి. పరిశీలించి కమాండ్‌ను సమీక్షించండి.',
    'Microphone access was unavailable. Allow microphone access or type your command.': 'మైక్రోఫోన్ అనుమతి లేదు. అనుమతి ఇవ్వండి లేదా కమాండ్‌ను టైప్ చేయండి.',
    'Microphone recording requires localhost or HTTPS and a supported browser. Use text input below.': 'మైక్రోఫోన్ ఈ బ్రౌజర్‌లో అందుబాటులో లేదు. కింద కమాండ్‌ను టైప్ చేయండి.',
    'Stock changed since this preview. Cancel and prepare the command again.': 'స్టాక్ మారింది. రద్దు చేసి కమాండ్‌ను మళ్లీ ఇవ్వండి.',
    'Confirmation expired or already used. Prepare the change again.': 'నిర్ధారణ గడువు ముగిసింది లేదా ఇప్పటికే ఉపయోగించబడింది. మళ్లీ ప్రయత్నించండి.',
    'Enter a quantity greater than zero.': 'సున్నా కంటే ఎక్కువ పరిమాణాన్ని ఇవ్వండి.',
    'Use a whole number for piece, bag, and dozen.': 'ముక్కలు, బస్తాలు, డజన్లకు పూర్ణ సంఖ్య ఇవ్వండి.',
    'Which product do you mean?': 'ఏ ఉత్పత్తి గురించి చెబుతున్నారు?',
    'Please log in to continue.': 'కొనసాగించడానికి లాగిన్ అవ్వండి.'
  };
  const match = message.match(/^Unable to remove ([\d.]+) (\w+) of (.+)\. Only ([\d.]+) (\w+) are available\.$/);
  if (match) return pair(`Unable to remove ${amount(Number(match[1]), match[2])} of ${match[3]}. Only ${amount(Number(match[4]), match[5])} are available.`, `${amountTe(match[1], match[2])} ${productTe(match[3])} తీసివేయడం సాధ్యం కాదు. కేవలం ${amountTe(match[4], match[5])} మాత్రమే అందుబాటులో ఉన్నాయి.`);
  return pair(message, translations[message] || 'ఈ చర్యను పూర్తి చేయలేకపోయాము. వివరాలను పరిశీలించి మళ్లీ ప్రయత్నించండి.');
}
export function amount(quantity, unit) {
  const names = { kg: ['kilogram', 'kilograms'], litre: ['litre', 'litres'], piece: ['piece', 'pieces'], bag: ['bag', 'bags'], dozen: ['dozen', 'dozen'] };
  return `${quantity} ${names[unit]?.[quantity === 1 ? 0 : 1] || unit}`;
}
// All inputs are confirmed API results, never the model's guessed inventory.
export function resultReply(result) {
  const items = result.products;
  if (result.intent === 'CHECK_STOCK') return items.map(p => `${p.name} stock is ${amount(p.quantity, p.unit)}.`).join(' ');
  if (!items.length) return 'No products are running low.';
  if (items.length === 1) { const p = items[0]; return `${p.name} is running low. Only ${amount(p.quantity, p.unit)} remaining.`; }
  return `${items.length} products are running low. ${items.slice(0, 3).map(p => p.name).join(', ')}${items.length > 3 ? ', and others' : ''}.`;
}
export function transactionReply(transaction) {
  const t = transaction;
  if (['ADD_STOCK', 'REMOVE_STOCK'].includes(t.type)) {
    const delta = Math.round(Math.abs(t.after - t.before) * 1000) / 1000;
    return `${amount(delta, t.unit)} of ${t.name} ${t.type === 'ADD_STOCK' ? 'added' : 'removed'} successfully. Current stock is ${amount(t.after, t.unit)}.`;
  }
  if (t.type === 'DELETE') return `${t.name} deleted successfully.`;
  return `${t.name} ${t.type === 'CREATE' ? 'created' : 'updated'} successfully. Current stock is ${amount(t.after, t.unit)}.`;
}

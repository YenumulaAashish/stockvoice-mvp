import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { extractIntent } from './services/intent.js';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
const key = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const redact = text => String(text).replaceAll(key || '__NO_KEY__', '[redacted]').replace(/AIza[\w-]+/g, '[redacted]');
console.log(`Testing model: ${model}`);
console.log('Synthetic product only. This test cannot update MongoDB.');
try {
  const command = await extractIntent(process.argv[2] || 'Add 5 kg Mango', [{ name: 'Mango', unit: 'kg' }], { geminiKey: key, geminiModel: model }, async (url, options) => {
    const response = await fetch(url, options);
    console.log(`Google HTTP status: ${response.status}`);
    if (!response.ok) {
      const body = await response.clone().json().catch(() => null);
      console.log('Google error: ' + redact(JSON.stringify(body?.error || { message: 'No JSON error returned' })).slice(0, 3000));
    }
    return response;
  });
  console.log('Structured command received and validated:');
  console.log(JSON.stringify(command, null, 2));
} catch (error) {
  console.error(redact(error.message));
  process.exitCode = 1;
}

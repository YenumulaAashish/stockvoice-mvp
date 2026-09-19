import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
const key = process.env.GEMINI_API_KEY;
if (!key) {
  console.error('Set GEMINI_API_KEY in .env first.');
  process.exit(1);
}
try {
  const names = [];
  let pageToken;
  do {
    const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
    url.searchParams.set('pageSize', '1000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetch(url, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(15000) });
    const data = await response.json();
    if (!response.ok) throw new Error(`Google returned HTTP ${response.status} (${data.error?.status || 'request failed'}). Check key permissions and API access.`);
    names.push(...(data.models || []).filter(model => model.supportedGenerationMethods?.includes('generateContent')).map(model => model.name.replace(/^models\//, '')));
    pageToken = data.nextPageToken;
  } while (pageToken);
  const configured = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  console.log(`Configured model: ${configured}`);
  console.log(`Listed for text generation: ${names.includes(configured) ? 'YES' : 'NO'}`);
  console.log('\nAvailable text-generation models:');
  console.log(names.join('\n') || '(none)');
  console.log('\nModel listing verifies availability, not quota or structured-output support.');
} catch (error) {
  console.error(error.name === 'TimeoutError' ? 'Google model lookup timed out.' : error.message.replaceAll(key, '[redacted]'));
  process.exitCode = 1;
}

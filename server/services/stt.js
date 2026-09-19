import { withRetry } from './retry.js';
import { GoogleGenAI } from '@google/genai';
import { fail } from '../rules.js';

// SDK 2.23 supports inline base64 AudioContent.data and output_text.
export async function transcribe(file, language, config, client) {
  if (!config.geminiKey || !config.sttModel) fail('Speech transcription is not configured. Set GEMINI_API_KEY and STT_MODEL.', 503);
  if (!file?.size || !file.buffer?.length) fail('Record some audio first.');
  if (file.size > 12 * 1024 * 1024) fail('Recording too large. Limit recordings to 60 seconds / 12 MB.');
  const mimeType = file.mimetype?.split(';')[0].trim();
  if (!['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg'].includes(mimeType)) fail('Unsupported recording format. Try Chrome or Edge.');
  if (!['auto', 'en', 'te'].includes(language)) fail('Choose English, Telugu, or automatic language detection.');
  const ai = client || new GoogleGenAI({ apiKey: config.geminiKey });
  let interaction;
  try {
    interaction = await withRetry(() => ai.interactions.create({
      model: config.sttModel,
      store: false,
      input: [{ type: 'audio', data: file.buffer.toString('base64'), mime_type: mimeType === 'audio/x-wav' ? 'audio/wav' : mimeType === 'audio/mp4' ? 'audio/m4a' : mimeType }],
      generation_config: { transcription_config: {
        mode: { type: 'verbatim' },
        ...(language === 'auto' ? {} : { language_codes: [language === 'en' ? 'en-US' : 'te-IN'] }),
        custom_vocabulary: ['piece', 'kg', 'kilogram', 'litre', 'bag', 'dozen', 'rice', 'stock', 'inventory', 'rupees']
      } }
    }, { signal: AbortSignal.timeout(45000), retries: { strategy: 'none' } }));
  } catch (error) {
    if (error.temporaryAI) throw error;
    console.error('Gemini transcription failed.', { status: Number(error.status || error.statusCode) || undefined });
    if (['AbortError', 'TimeoutError', 'RequestTimeoutError'].includes(error.name)) fail('Something went wrong. Please try again.', 504);
    fail('Something went wrong. Please try again.', 502);
  }
  const transcript = interaction.output_text?.trim();
  if (!transcript || !/[\p{L}\p{N}]/u.test(transcript)) fail('I could not understand that. Please try again.', 422);
  return transcript;
}

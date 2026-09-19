export const TEMPORARY_MESSAGE = 'AI service is temporarily unavailable. Please try again.';
export function providerStatus(error) {
  return Number(error?.status ?? error?.statusCode ?? error?.response?.status ?? error?.error?.code);
}
// Only provider calls belong here, never confirmation or database writes.
export async function withRetry(operation, { wait = ms => new Promise(resolve => setTimeout(resolve, ms)), log = console.warn } = {}) {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (![429, 503].includes(providerStatus(error))) throw error;
      if (attempt === 3) {
        const exhausted = new Error(TEMPORARY_MESSAGE);
        exhausted.status = 503;
        exhausted.temporaryAI = true;
        throw exhausted;
      }
      log(`Gemini temporarily unavailable. Retry ${attempt + 1}/3...`);
      await wait(1000 * 2 ** attempt);
    }
  }
}

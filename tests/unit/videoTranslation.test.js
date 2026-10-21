import { MAX_TRANSLATION_BYTES, payloadBytes, splitTranslationText, utf8Bytes } from '../../lib/translationPayload';
import { createVideoTranslationSession, runVideoTranslationSession, requestVideoTranslation, retryDelay } from '../../src/features/video-library-admin/services/videoTranslation';

const response = (status, body, retryAfter = null) => ({ ok: status === 200, status, json: async () => body, headers: { get: () => retryAfter } });

it('splits escaped Unicode into bounded JSON requests without losing paragraphs or characters', () => {
  const source = ('Berbec ♈️: Bună, îți mulțumesc! "Început" \\ azi. '.repeat(400)) + '\n\nTAUR\n' + '🪐'.repeat(4000) + '\r\n\r\nFinal.';
  const parts = splitTranslationText(source, 'fr');
  expect(parts.map(x => x.text + x.separator).join('')).toBe(source);
  expect(parts.filter(x => x.text).length).toBeGreaterThan(5);
  for (const part of parts.filter(x => x.text)) {
    expect(payloadBytes(part.text, 'fr')).toBeLessThanOrEqual(MAX_TRANSLATION_BYTES);
    expect(utf8Bytes(JSON.stringify({ from: 'ro', to: 'fr', text: part.text, quality: 'nmt' }))).toBe(Buffer.byteLength(JSON.stringify({ from: 'ro', to: 'fr', text: part.text, quality: 'nmt' })));
    expect(part.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);
  }
});

it('keeps only completed locales and resumes at the failed fragment', async () => {
  const args = { title: 'Titlu', description: 'Prima parte.\n\nA doua parte.', languages: ['ro', 'en', 'fr'] };
  const session = createVideoTranslationSession(args.title, args.description, args.languages);
  const onLocale = jest.fn();
  const translated = jest.fn(async (text, lang) => {
    if (lang === 'fr' && text === 'A doua parte.') throw new Error('Failed');
    return `${lang}: ${text}`;
  });
  await expect(runVideoTranslationSession(session, { ...args, onLocale, translate: translated })).rejects.toThrow('Failed');
  expect(Object.keys(session.completed)).toEqual(['ro', 'en']);
  expect(onLocale.mock.calls.map(x => x[0])).toEqual(['ro', 'en']);
  const resume = jest.fn(async text => `fr: ${text}`);
  const result = await runVideoTranslationSession(session, { ...args, translate: resume });
  expect(resume).toHaveBeenCalledTimes(1);
  expect(resume.mock.calls[0][0]).toBe('A doua parte.');
  expect(result.fr.description).toBe('fr: Prima parte.\n\nfr: A doua parte.');
});

it('keeps combined emoji and decomposed accents intact at hard boundaries', () => {
  for (const symbol of ['👨‍👩‍👧‍👦', '🇷🇴', 'a\u0306']) {
    const source = symbol.repeat(4000);
    const parts = splitTranslationText(source, 'en');
    expect(parts.map(p => p.text + p.separator).join('')).toBe(source);
    for (const part of parts) {
      expect(part.text).toBe(symbol.repeat(part.text.length / symbol.length));
      expect(payloadBytes(part.text, 'en')).toBeLessThanOrEqual(MAX_TRANSLATION_BYTES);
    }
  }
});

it('does not retain a result arriving after unmount/abort', async () => {
  const args = { title: 'Titlu', description: '', languages: ['en'] };
  const session = createVideoTranslationSession(args.title, args.description, args.languages);
  const controller = new AbortController();
  await expect(runVideoTranslationSession(session, { ...args, signal: controller.signal, translate: async () => { controller.abort(); return 'Late'; } })).rejects.toMatchObject({ name: 'AbortError' });
  expect(session.completed).toEqual({});
  expect(session.fragments.size).toBe(0);
});

it('retries 429 and server errors sequentially, respects Retry-After, and sends explicit Romanian', async () => {
  jest.useFakeTimers();
  const fetchImpl = jest.fn().mockResolvedValueOnce(response(429, { error: 'Limit' }, '2')).mockResolvedValueOnce(response(503, { error: 'Unavailable' })).mockResolvedValue(response(200, { trans: 'Hello' }));
  const promise = requestVideoTranslation('Bună', 'en', { fetchImpl });
  await jest.advanceTimersByTimeAsync(1999);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(2000);
  expect(await promise).toBe('Hello');
  expect(fetchImpl).toHaveBeenCalledTimes(3);
  expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ text: 'Bună', target: 'en', source: 'ro', quality: 'nmt' });
  jest.useRealTimers();
});

it('does not retry oversized payloads or return empty success', async () => {
  const fetchImpl = jest.fn(async () => response(413, { code: 'PAYLOAD_TOO_LARGE', details: 'Too big' }));
  await expect(requestVideoTranslation('text', 'en', { fetchImpl })).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  await expect(requestVideoTranslation('text', 'en', { fetchImpl: async () => response(200, { trans: '' }) })).rejects.toThrow('goală');
  expect(retryDelay('Wed, 21 Oct 2026 15:00:00 GMT', 0, Date.parse('2026-10-21T14:59:57Z'))).toBe(3000);
});

it('times out and exhausts exactly three attempts', async () => {
  jest.useFakeTimers();
  const fetchImpl = jest.fn((_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Timeout', 'AbortError')))));
  const outcome = requestVideoTranslation('text', 'en', { fetchImpl }).catch(error => error);
  await jest.advanceTimersByTimeAsync(100000);
  expect((await outcome).code).toBe('TRANSLATION_TIMEOUT');
  expect(fetchImpl).toHaveBeenCalledTimes(3);
  jest.useRealTimers();
});

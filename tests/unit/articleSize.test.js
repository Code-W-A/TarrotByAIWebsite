import { articleDocumentBytes, assertArticleSize, firestoreValueBytes, MAX_ARTICLE_BYTES, articleSaveError } from '../../lib/articleSize';
const path = 'BlogArticole/test';
const sized = bytes => ({ content: 'a'.repeat(bytes - articleDocumentBytes({ content: '' }, path)) });
it.each([-1, 0, 1])('enforces the threshold with offset %i', delta => {
  const data = sized(MAX_ARTICLE_BYTES + delta);
  expect(articleDocumentBytes(data, path)).toBe(MAX_ARTICLE_BYTES + delta);
  if (delta > 0) expect(() => assertArticleSize(data, path)).toThrow('900 KiB');
  else expect(assertArticleSize(data, path)).toBe(MAX_ARTICLE_BYTES + delta);
});
it('counts UTF8 and Firestore map overhead independently', () => {
  const value = { text: 'ă😀<p>"\\</p>', nested: { title: 'Știință' }, arr: [true, 4, null], date: new Date() };
  const str = text => Buffer.byteLength(text) + 1;
  const expected = 32 + str('text') + str(value.text) + str('nested') + 32 + str('title') + str(value.nested.title) + str('arr') + 1 + 8 + 1 + str('date') + 8;
  expect(firestoreValueBytes(value)).toBe(expected);
});
it('rejects combined languages even when each content is small', () => {
  const info = Object.fromEntries(Array.from({ length: 18 }, (_, i) => [String(i), { content: '<p>' + 'x'.repeat(60 * 1024) + '</p>' }]));
  expect(() => assertArticleSize({ info })).toThrow();
});
it('includes embedded images and extra preserved fields', () => {
  expect(() => assertArticleSize({ ...sized(MAX_ARTICLE_BYTES), image: { finalUri: 'data:image/png;base64,' + 'A'.repeat(1000) } }, path)).toThrow();
});
it('accepts a reduced article after a failed size check', () => {
  expect(() => assertArticleSize(sized(MAX_ARTICLE_BYTES + 1), path)).toThrow();
  expect(() => assertArticleSize({ info: { en: { content: '<p>Short</p>' } } }, path)).not.toThrow();
});
it.each(['permission-denied', 'unauthenticated', 'firestore/permission-denied', 'unavailable', 'deadline-exceeded', 'network-request-failed', 'unknown'])('produces a visible message for %s', code => {
  expect(articleSaveError({ code }).title).toBeTruthy();
  expect(articleSaveError({ code }).message).toBeTruthy();
});
it('maps size errors to an actionable dialog', () => {
  try { assertArticleSize(sized(MAX_ARTICLE_BYTES + 1), path); } catch (error) {
    expect(articleSaveError(error)).toMatchObject({ title: 'Articolul este prea mare pentru salvare', message: expect.stringContaining('900 KiB') });
  }
});

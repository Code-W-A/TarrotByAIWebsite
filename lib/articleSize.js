import { utf8Bytes } from './translationPayload';

export const MAX_ARTICLE_BYTES = 900 * 1024;
const stringSize = value => utf8Bytes(value) + 1;

// Firestore storage sizing: maps include 32 bytes; strings include a terminator.
export function firestoreValueBytes(value) {
  if (value == null || typeof value === 'boolean') return 1;
  if (typeof value === 'string') return stringSize(value);
  if (typeof value === 'number' || value instanceof Date || typeof value?.toDate === 'function') return 8;
  if (value instanceof Uint8Array) return value.byteLength;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + firestoreValueBytes(item), 0);
  if (typeof value === 'object') {
    if (typeof value.path === 'string' && value.firestore) return documentNameBytes(value.path);
    if (typeof value.latitude === 'number' && typeof value.longitude === 'number') return 16;
    return 32 + Object.entries(value).reduce((sum, [key, item]) => sum + stringSize(key) + firestoreValueBytes(item), 0);
  }
  throw new Error('Articolul conține o valoare care nu poate fi salvată.');
}
function documentNameBytes(path) {
  return path.split('/').reduce((sum, segment) => sum + stringSize(segment), 16);
}
export function articleDocumentBytes(data, path = 'BlogArticole/00000000000000000000') {
  return documentNameBytes(path) + firestoreValueBytes(data);
}
export function assertArticleSize(data, path) {
  const bytes = articleDocumentBytes(data, path);
  if (bytes > MAX_ARTICLE_BYTES) {
    const error = new Error(`Articolul are ${(bytes / 1024).toFixed(1)} KiB. Limita de siguranță este 900 KiB. Scurtează conținutul sau elimină imaginile încorporate în text, apoi reîncearcă.`);
    error.code = 'ARTICLE_TOO_LARGE';
    error.bytes = bytes;
    throw error;
  }
  return bytes;
}
export function articleSaveError(error) {
  const code = String(error?.code || '').replace(/^firestore\//, '');
  if (code === 'ARTICLE_TOO_LARGE') return { title: 'Articolul este prea mare pentru salvare', message: error.message };
  if (code === 'permission-denied' || code === 'unauthenticated') return { title: 'Salvarea nu este permisă', message: 'Verifică autentificarea și drepturile contului, apoi reîncearcă.' };
  if (['unavailable', 'deadline-exceeded', 'network-request-failed'].includes(code)) return { title: 'Salvarea nu a fost confirmată', message: 'Verifică conexiunea și reîncearcă. Conținutul este păstrat în formular.' };
  if (/size|too large|maximum.*bytes/i.test(error?.message || '')) return { title: 'Articolul este prea mare pentru salvare', message: 'Firebase a respins dimensiunea articolului. Redu conținutul și reîncearcă.' };
  return { title: 'Articolul nu a putut fi salvat', message: 'Conținutul este păstrat în formular. Reîncearcă. Detalii: ' + (error?.message || 'Eroare necunoscută.') };
}

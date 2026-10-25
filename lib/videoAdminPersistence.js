import { createHash } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from './firebaseAdmin';
import { normalizeVideoChapters } from './videoChapters';
import { resolveVideoNotificationAt } from './videoReleaseSchedule';
import { validateVideoInput } from '../src/features/video-library-admin/utils/videoValidation';
import { prepareDescriptions, makeDocument, writeDescriptions, resolveDescriptions, hasSanity } from './videoDescriptionStorage.cjs';

const error = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const fields = ['title', 'description', 'platform', 'videoUrl', 'thumbnailUrl', 'category', 'publishAt', 'publicReleaseAt', 'isPublished', 'isPremium', 'order', 'durationSeconds', 'chapters', 'locales', 'featuredOnHome', 'descriptionStorage'];
const dates = ['publishAt', 'publicReleaseAt'];
const millis = value => value?.toMillis?.() ?? null;
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
// View counters and delivery receipts can change while the editor is open.
// Only editable content participates in the conflict token.
const revision = snap => snap.exists ? hash(canonical(Object.fromEntries(fields.filter(k => snap.data()[k] !== undefined).map(k => [k, snap.data()[k]])))) : null;
const activeFeatured = row => row.featuredOnHome === true && row.isPublished === true && !(millis(row.publishAt) > Date.now());
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function notificationFields(current, next, isNew) {
  const notificationAt = resolveVideoNotificationAt(next);
  const result = { notificationAt };
  if (isNew) return { ...result, notificationState: next.isPublished && notificationAt ? 'pending' : 'sent', notificationSentAt: null };
  if (!next.isPublished || !notificationAt) return { ...result, notificationState: 'sent' };
  const changed = millis(current.notificationAt ?? resolveVideoNotificationAt(current)) !== millis(notificationAt);
  const sent = current.notificationState === 'sent' || current.notificationSentAt != null;
  if (!(sent && !changed) && ((!current.isPublished && next.isPublished) || changed)) {
    return { ...result, notificationState: 'pending', notificationSentAt: null };
  }
  return result;
}

function parseInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw error('Date video invalide.');
  const out = Object.fromEntries(fields.filter(k => input[k] !== undefined).map(k => [k, input[k]]));
  if (out.descriptionStorage !== undefined && (!out.descriptionStorage || typeof out.descriptionStorage !== 'object' || Array.isArray(out.descriptionStorage))) throw error('Sursele descrierilor sunt invalide.');
  for (const key of ['title', 'description', 'videoUrl', 'thumbnailUrl', 'category']) {
    if (Object.hasOwn(out, key) && typeof out[key] !== 'string') throw error(`Câmpul ${key} trebuie să fie text.`);
  }
  if (out.platform !== undefined && !['youtube', 'vimeo', 'bunny'].includes(out.platform)) throw error('Platformă video invalidă.');
  for (const key of ['isPublished', 'isPremium', 'featuredOnHome']) {
    if (Object.hasOwn(out, key) && typeof out[key] !== 'boolean') throw error(`Câmpul ${key} este invalid.`);
  }
  for (const key of ['order', 'durationSeconds']) {
    if (out[key] != null && (typeof out[key] !== 'number' || !Number.isFinite(out[key]) || out[key] < 0)) throw error(`Câmpul ${key} este invalid.`);
  }
  if (out.locales !== undefined) {
    if (!out.locales || typeof out.locales !== 'object' || Array.isArray(out.locales)) throw error('Localizări invalide.');
    for (const entry of Object.values(out.locales)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
          ['title', 'description', 'videoUrl'].some(k => Object.hasOwn(entry, k) && typeof entry[k] !== 'string')) throw error('Textele localizărilor sunt invalide.');
    }
  }
  for (const key of dates) {
    if (!Object.hasOwn(out, key) || out[key] == null) continue;
    const value = out[key];
    const seconds = value.seconds ?? value._seconds, nanos = value.nanoseconds ?? value._nanoseconds ?? 0;
    if (!Number.isInteger(seconds) || !Number.isInteger(nanos) || nanos < 0 || nanos >= 1e9) throw error('Data publicării este invalidă.');
    try { out[key] = new Timestamp(seconds, nanos); } catch { throw error('Data publicării este invalidă.'); }
  }
  return out;
}
// Firestore's documented storage sizing; reserve the document name and timestamp transforms.
function valueBytes(v) {
  if (v == null || typeof v === 'boolean') return 1;
  if (typeof v === 'string') return Buffer.byteLength(v) + 1;
  if (typeof v === 'number') return 8;
  if (v instanceof Timestamp || v instanceof Date) return 8;
  if (Array.isArray(v)) return v.reduce((n, x) => n + valueBytes(x), 0);
  if (typeof v === 'object') return 32 + Object.entries(v).reduce((n, [k, x]) => n + Buffer.byteLength(k) + 1 + valueBytes(x), 0);
  throw error('Valoare video nesuportată.');
}
export function assertVideoDocumentSize(row) {
  if (valueBytes(row) + 512 >= 1048576) throw error('Documentul Firebase depășește 1 MiB. Selectează Sanity pentru descrierile lungi. Textele nu au fost scurtate.', 413);
}
export async function readVideoForEdit(id) {
  if (typeof id !== 'string' || !/^[\w-]{1,128}$/.test(id) || id.startsWith('_')) throw error('ID video invalid.');
  const snap = await getAdminDb().collection('videosVideoModule').doc(id).get();
  if (!snap.exists) throw error('Videoclipul nu există.', 404);
  const [row] = await resolveDescriptions([{ ...snap.data(), id }]);
  return { ...row, editRevision: revision(snap) };
}
export async function saveAdminVideo({ videoId, input, mutationId, expectedRevision }) {
  if (typeof mutationId !== 'string' || !/^[\w-]{16,100}$/.test(mutationId)) throw error('Cheia salvării este invalidă.');
  if (videoId != null && (typeof videoId !== 'string' || !/^[\w-]{1,128}$/.test(videoId) || videoId.startsWith('_'))) throw error('ID video invalid.');
  const db = getAdminDb(), collection = db.collection('videosVideoModule');
  const id = videoId || `video-${hash(mutationId).slice(0, 32)}`;
  const ref = collection.doc(id), operation = db.collection('videoAdminMutations').doc(mutationId);
  const payloadHash = hash({ videoId: videoId || null, input, expectedRevision: expectedRevision || null });
  const completed = await operation.get();
  if (completed.exists) {
    if (completed.data().payloadHash !== payloadHash) throw error('Cheia salvării a fost deja folosită pentru alte date.', 409);
    return { id: completed.data().videoId, replayed: true };
  }
  const initial = await ref.get();
  const conflict = videoId && !initial.exists ? error('Videoclipul nu există.', 404)
    : !videoId && initial.exists ? error('Videoclipul există deja.', 409)
    : expectedRevision && expectedRevision !== revision(initial) ? error('Videoclipul a fost modificat între timp. Redeschide editorul.', 409) : null;
  if (conflict) {
    // The first attempt may have committed between the operation and video reads.
    const recent = await operation.get();
    if (recent.exists && recent.data().payloadHash === payloadHash) return { id: recent.data().videoId, replayed: true };
    throw conflict;
  }
  const current = initial.exists ? initial.data() : {};
  const [hydrated] = await resolveDescriptions([{ ...current, id }]);
  const parsed = parseInput(input);
  const next = { ...hydrated, ...parsed };
  delete next.id; delete next.editRevision;
  next.title = typeof next.title === 'string' ? next.title.trim() : '';
  next.isPublished = next.isPublished === true;
  next.chapters = normalizeVideoChapters(next.chapters, { locale: 'ro', includeLocales: true });
  const validation = validateVideoInput(next);
  if (Object.keys(validation).length) throw error(Object.values(validation).find(v => typeof v === 'string') || 'Verifică datele videoclipului.');
  const prepared = prepareDescriptions(next);
  const document = hasSanity(prepared.storage) ? makeDocument(id, prepared.external) : null;
  if (document) prepared.storage.sanityId = document._id;
  const stored = { ...prepared.fields, descriptionStorage: prepared.storage };
  assertVideoDocumentSize(stored);
  if (document) await writeDescriptions(document);
  await db.runTransaction(async tx => {
    const [latest, done] = await Promise.all([tx.get(ref), tx.get(operation)]);
    if (done.exists) {
      if (done.data().payloadHash !== payloadHash) throw error('Cheia salvării este deja utilizată.', 409);
      return;
    }
    if (revision(latest) !== revision(initial) || latest.exists !== initial.exists) throw error('Videoclipul a fost modificat între timp. Redeschide editorul.', 409);
    if (activeFeatured(stored)) {
      const featured = await tx.get(collection.where('featuredOnHome', '==', true));
      if (featured.docs.filter(d => d.id !== id && activeFeatured(d.data())).length >= 2) throw error('Poți evidenția maximum 2 videoclipuri publice pe homepage.');
    }
    let order = stored.order;
    const metaRef = collection.doc('_meta');
    if (!initial.exists && order == null) {
      const meta = await tx.get(metaRef);
      let lastOrder = meta.data()?.lastOrder;
      if (typeof lastOrder !== 'number') {
        const last = await tx.get(collection.orderBy('order', 'desc').limit(1));
        lastOrder = last.docs[0]?.data()?.order ?? 0;
      }
      order = lastOrder + 1;
    }
    const editable = Object.fromEntries(fields.filter(k => Object.hasOwn(stored, k)).map(k => [k, stored[k]]));
    const payload = { ...(latest.data() || {}), ...editable, ...notificationFields(latest.data() || {}, next, !initial.exists),
      ...(order != null ? { order } : {}), updatedAt: FieldValue.serverTimestamp(),
      ...(!initial.exists ? { createdAt: FieldValue.serverTimestamp() } : {}) };
    if (!Object.hasOwn(stored, 'description')) delete payload.description;
    assertVideoDocumentSize(payload);
    if (!initial.exists && stored.order == null) tx.set(metaRef, { lastOrder: order }, { merge: true });
    tx.set(ref, payload);
    tx.set(operation, { videoId: id, payloadHash, createdAt: FieldValue.serverTimestamp() });
  });
  return { id, replayed: false };
}

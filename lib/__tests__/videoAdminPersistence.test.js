jest.mock('../firebaseAdmin', () => ({ getAdminDb: jest.fn() }));
import { getAdminDb } from '../firebaseAdmin';
import { saveAdminVideo, readVideoForEdit, assertVideoDocumentSize } from '../videoAdminPersistence';
import { createVideoAdminDb } from '../../tests/helpers/videoAdminDb';
import { Timestamp } from 'firebase-admin/firestore';
const { clearDescriptionMemoryCache } = require('../videoDescriptionStorage.cjs');

const originalEnv = { ...process.env };
const base = { title: 'Video nou', platform: 'youtube', videoUrl: 'https://youtu.be/abc123', isPublished: false,
  description: 'Română originală', locales: { en: { title: 'Title', description: 'Full English' } } };
const source = { version: 1, root: 'sanity', locales: { en: 'sanity' } };
let model, sanity, failMutation, failCommit;
const save = (input = base, extra = {}) => saveAdminVideo({ input, mutationId: 'operation-00000001', ...extra });
beforeEach(() => {
  clearDescriptionMemoryCache(); sanity = new Map(); failMutation = false; failCommit = false;
  model = createVideoAdminDb(); getAdminDb.mockReturnValue(model.db);
  Object.assign(process.env, { SANITY_PROJECT_ID: 'test', SANITY_DATASET: 'private', SANITY_READ_TOKEN: 'read-test', SANITY_WRITE_TOKEN: 'write-test' });
  global.fetch = jest.fn(async (url, options = {}) => {
    if (url.endsWith('/datasets')) return { ok: true, json: async () => [{ name: 'private', aclMode: 'private' }] };
    const body = JSON.parse(options.body);
    if (url.includes('/mutate/')) {
      if (failMutation) throw new Error('network');
      const document = body.mutations[0].createIfNotExists;
      sanity.set(document._id, document);
      return { ok: true, json: async () => ({}) };
    }
    return { ok: true, json: async () => ({ result: body.params.ids.flatMap(id => sanity.has(id) ? [sanity.get(id)] : []) }) };
  });
  model.onTransaction(() => { if (failCommit) throw new Error('Firestore unavailable'); });
});
afterEach(() => { process.env = { ...originalEnv }; delete global.fetch; });
it('saves legacy Firebase content, keeps existing unknown fields, and needs no Sanity configuration', async () => {
  delete process.env.SANITY_READ_TOKEN;
  const { id } = await save();
  let video = await readVideoForEdit(id);
  expect(video).toMatchObject(base);
  model.set(`videosVideoModule/${id}`, { ...model.store.get(`videosVideoModule/${id}`).value, viewsCount: 55 });
  video = await readVideoForEdit(id);
  await save({ title: 'Edited' }, { videoId: id, expectedRevision: video.editRevision, mutationId: 'operation-00000002' });
  expect(await readVideoForEdit(id)).toMatchObject({ title: 'Edited', description: base.description, viewsCount: 55, order: 1 });
  expect(fetch).not.toHaveBeenCalled();
});
it('writes Sanity before publishing its pointer, reopens exact text and removes Firebase duplication', async () => {
  const { id } = await save({ ...base, descriptionStorage: source });
  const raw = model.store.get(`videosVideoModule/${id}`).value;
  expect(raw).not.toHaveProperty('description'); expect(raw.locales.en).not.toHaveProperty('description');
  expect(raw.descriptionStorage.sanityId).toMatch(/^video-description-/);
  const readCount = model.reads.length;
  expect(await readVideoForEdit(id)).toMatchObject(base);
  expect(model.reads.length - readCount).toBe(1);
  expect(sanity.size).toBe(1);
  const opened = await readVideoForEdit(id);
  await save({ descriptionStorage: { version: 1, root: 'firebase', locales: { en: 'firebase' } } }, { videoId: id, expectedRevision: opened.editRevision, mutationId: 'operation-00000002' });
  expect(model.store.get(`videosVideoModule/${id}`).value).toMatchObject({ description: base.description, locales: base.locales, descriptionStorage: { sanityId: null } });
});
it('does not publish incomplete data on Sanity failure; retry succeeds once', async () => {
  failMutation = true;
  await expect(save({ ...base, descriptionStorage: source })).rejects.toThrow('Sanity');
  expect(model.writes).toHaveLength(0);
  failMutation = false;
  const result = await save({ ...base, descriptionStorage: source });
  expect(await save({ ...base, descriptionStorage: source })).toEqual({ ...result, replayed: true });
  expect(model.writes.filter(key => key.startsWith('videosVideoModule/video-'))).toHaveLength(1);
});
it('keeps the old pointer on Firestore failure, then retries without duplicate versions', async () => {
  const { id } = await save({ ...base, descriptionStorage: source });
  const before = await readVideoForEdit(id);
  const request = { ...base, description: 'New complete root', descriptionStorage: source };
  failCommit = true;
  await expect(save(request, { videoId: id, expectedRevision: before.editRevision, mutationId: 'operation-00000002' })).rejects.toThrow('Firestore');
  expect((await readVideoForEdit(id)).description).toBe(base.description);
  failCommit = false;
  await save(request, { videoId: id, expectedRevision: before.editRevision, mutationId: 'operation-00000002' });
  expect((await readVideoForEdit(id)).description).toBe('New complete root');
  expect(sanity.size).toBe(2);
});
it('serializes concurrent creates with one operation key and rejects changed payload reuse', async () => {
  const results = await Promise.all([save(), save()]);
  expect(results[0].id).toBe(results[1].id);
  expect(model.writes.filter(key => key.startsWith('videosVideoModule/video-'))).toHaveLength(1);
  expect(model.store.get('videosVideoModule/_meta').value.lastOrder).toBe(1);
  await expect(save({ ...base, title: 'Other input' })).rejects.toMatchObject({ statusCode: 409 });
});
it('rejects stale editors and conflicting simultaneous updates', async () => {
  const { id } = await save(); const opened = await readVideoForEdit(id);
  const results = await Promise.allSettled([
    save({ title: 'Editor A' }, { videoId: id, expectedRevision: opened.editRevision, mutationId: 'operation-00000002' }),
    save({ title: 'Editor B' }, { videoId: id, expectedRevision: opened.editRevision, mutationId: 'operation-00000003' }),
  ]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.find(r => r.status === 'rejected').reason.statusCode).toBe(409);
  await expect(save({ title: 'Stale' }, { videoId: id, expectedRevision: opened.editRevision, mutationId: 'operation-00000004' })).rejects.toMatchObject({ statusCode: 409 });
});
it('preserves views and delivery receipts changed while the content editor was open', async () => {
  const { id } = await save(); const opened = await readVideoForEdit(id);
  model.onTransaction(() => model.set(`videosVideoModule/${id}`, {
    ...model.store.get(`videosVideoModule/${id}`).value,
    viewsCount: 99, viewsByLocale: { ro: 99 }, notificationState: 'sent', notificationSentAt: new Timestamp(12, 0),
  }));
  await save({ title: 'Edited content' }, { videoId: id, expectedRevision: opened.editRevision, mutationId: 'operation-00000002' });
  expect(model.store.get(`videosVideoModule/${id}`).value).toMatchObject({ title: 'Edited content', viewsCount: 99, viewsByLocale: { ro: 99 }, notificationSentAt: new Timestamp(12, 0) });
});
it('checks document sizes and rejects oversized new descriptions before writing to either source', async () => {
  const description = '🙂'.repeat(280000);
  expect(() => assertVideoDocumentSize({ description })).toThrow('1 MiB');
  await expect(save({ ...base, description })).rejects.toMatchObject({ statusCode: 400 });
  await expect(save({ ...base, description, descriptionStorage: source })).rejects.toThrow('6.000');
  expect(model.writes).toHaveLength(0);
  expect(fetch).not.toHaveBeenCalled();
});
it.each(['firebase', 'sanity'])('accepts exactly 6000 Unicode characters in %s and rejects 6001 in localized descriptions', async storage => {
  const description = '🙂'.repeat(6000);
  const { id } = await save({ ...base, description, descriptionStorage: storage === 'sanity' ? source : undefined });
  expect((await readVideoForEdit(id)).description).toBe(description);
  const before = model.writes.length;
  await expect(save({ locales: { en: { title: 'Title', description: description + 'a' } } }, { videoId: id, mutationId: 'operation-00000002' })).rejects.toThrow('EN:');
  expect(model.writes).toHaveLength(before);
});
it.each(['firebase', 'sanity'])('allows unchanged legacy oversized %s text but blocks editing it above the limit', async storage => {
  const { id } = await save();
  const description = 'ă'.repeat(6001);
  const row = { ...model.store.get(`videosVideoModule/${id}`).value, description,
    locales: { en: { title: 'Title', description } } };
  if (storage === 'sanity') {
    const { prepareDescriptions, makeDocument } = require('../videoDescriptionStorage.cjs');
    const prepared = prepareDescriptions({ ...row, descriptionStorage: source });
    const doc = makeDocument(id, prepared.external); sanity.set(doc._id, doc);
    model.set(`videosVideoModule/${id}`, { ...prepared.fields, descriptionStorage: { ...prepared.storage, sanityId: doc._id } });
  } else model.set(`videosVideoModule/${id}`, row);
  await save({ title: 'Other title' }, { videoId: id, mutationId: 'operation-00000002' });
  expect((await readVideoForEdit(id)).description).toBe(description);
  await expect(save({ description: description + 'x' }, { videoId: id, mutationId: 'operation-00000003' })).rejects.toThrow('6.000');
  await expect(save({ locales: { en: { title: 'Title', description: description + 'x' } } }, { videoId: id, mutationId: 'operation-00000004' })).rejects.toThrow('EN:');
  await save({ description: 'Reduced', locales: { en: { title: 'Title', description: 'Reduced English' } } }, { videoId: id, mutationId: 'operation-00000005' });
  expect((await readVideoForEdit(id)).description).toBe('Reduced');
});
it('preserves notification history and resets it only when the publish schedule changes', async () => {
  const future = new Timestamp(Math.floor(Date.now() / 1000) + 10000, 0);
  const { id } = await save({ ...base, isPublished: true, publishAt: future });
  expect(model.store.get(`videosVideoModule/${id}`).value.notificationState).toBe('pending');
  model.set(`videosVideoModule/${id}`, { ...model.store.get(`videosVideoModule/${id}`).value, notificationState: 'sent', notificationSentAt: future });
  await save({ title: 'Text edit' }, { videoId: id, mutationId: 'operation-00000002' });
  expect(model.store.get(`videosVideoModule/${id}`).value.notificationState).toBe('sent');
  await save({ publishAt: new Timestamp(future.seconds + 1000, 0) }, { videoId: id, mutationId: 'operation-00000003' });
  expect(model.store.get(`videosVideoModule/${id}`).value).toMatchObject({ notificationState: 'pending', notificationSentAt: null });
});
it('enforces featured capacity inside the transaction and rejects invalid links', async () => {
  for (let i = 0; i < 2; i++) model.set(`videosVideoModule/f${i}`, { ...base, isPublished: true, featuredOnHome: true });
  await expect(save({ ...base, isPublished: true, featuredOnHome: true })).rejects.toThrow('maximum 2');
  await expect(save({ ...base, videoUrl: '' })).rejects.toThrow('RO');
});
it('rejects missing write credentials and malformed fields without changing Firestore', async () => {
  delete process.env.SANITY_WRITE_TOKEN;
  await expect(save({ ...base, descriptionStorage: source })).rejects.toMatchObject({ statusCode: 503 });
  for (const input of [{ ...base, locales: [] }, { ...base, isPublished: 'yes' }, { ...base, order: -1 }, { ...base, platform: 'invalid' }]) {
    await expect(save(input)).rejects.toMatchObject({ statusCode: 400 });
  }
  expect(model.writes).toHaveLength(0);
});

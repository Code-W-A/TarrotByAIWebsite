import { handleUploadFirestore, handleUpdateFirestore } from '../../utils/firestoreUtils';
import { getDoc, setDoc, updateDoc } from 'firebase/firestore';
jest.mock('../../firebase', () => ({ db: {}, authentication: { currentUser: { uid: 'test' } } }));
jest.mock('../../utils/authUtils', () => ({ handleDeleteAccount: jest.fn() }));
jest.mock('../../utils/commonUtils', () => ({ filterArticlesBeforeCurrentTime: jest.fn() }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn((_db, path) => ({ path })),
  doc: jest.fn((ref, path) => ({ id: 'test', path: path || `${ref.path}/test` })),
  getCountFromServer: jest.fn(async () => ({ data: () => ({ count: 0 }) })),
  getDoc: jest.fn(), setDoc: jest.fn(), updateDoc: jest.fn(),
}));
beforeEach(() => {
  jest.clearAllMocks();
  getDoc.mockResolvedValue({ exists: () => true, data: () => ({}) });
  setDoc.mockResolvedValue(); updateDoc.mockResolvedValue();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
it('blocks oversized creation before setDoc', async () => {
  await expect(handleUploadFirestore({ info: { en: { content: 'a'.repeat(901 * 1024) } } }, 'BlogArticole')).rejects.toMatchObject({ code: 'ARTICLE_TOO_LARGE' });
  expect(setDoc).not.toHaveBeenCalled();
});
it('includes fields retained from the existing document when validating an update', async () => {
  getDoc.mockResolvedValue({ exists: () => true, data: () => ({ retained: 'a'.repeat(899 * 1024) }) });
  await expect(handleUpdateFirestore('BlogArticole/test', { info: { en: { content: 'b'.repeat(2048) } } })).rejects.toMatchObject({ code: 'ARTICLE_TOO_LARGE' });
  expect(updateDoc).not.toHaveBeenCalled();
});
it('validates the missing-document setDoc branch too', async () => {
  getDoc.mockResolvedValue({ exists: () => false });
  await expect(handleUpdateFirestore('BlogArticole/test', { content: 'a'.repeat(901 * 1024) })).rejects.toMatchObject({ code: 'ARTICLE_TOO_LARGE' });
  expect(setDoc).not.toHaveBeenCalled();
});
it.each(['create', 'edit'])('propagates Firebase permissions errors on %s', async mode => {
  const error = Object.assign(new Error('Denied'), { code: 'permission-denied' });
  setDoc.mockRejectedValue(error); updateDoc.mockRejectedValue(error);
  await expect(mode === 'create' ? handleUploadFirestore({}, 'BlogArticole') : handleUpdateFirestore('BlogArticole/test', {})).rejects.toBe(error);
});
it('allows a smaller retry with the original content schema', async () => {
  await expect(handleUpdateFirestore('BlogArticole/test', { content: 'a'.repeat(901 * 1024) })).rejects.toThrow();
  const info = { en: { content: '<p>Short</p>' } };
  const result = await handleUpdateFirestore('BlogArticole/test', { info });
  expect(result.info).toEqual(info);
  expect(updateDoc).toHaveBeenCalledTimes(1);
});
it('does not change error handling for unrelated collections', async () => {
  updateDoc.mockRejectedValue(new Error('legacy'));
  await expect(handleUpdateFirestore('Other/test', {})).resolves.toBeUndefined();
});

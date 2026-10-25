import handler from '../../pages/api/translate';
const run = async (body) => {
  const res = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  await handler({ method: 'POST', body }, res);
  return res;
};
beforeEach(() => { process.env.RAPIDAPI_TRANSLATE_KEY = 'test'; global.fetch = jest.fn(); });
afterEach(() => jest.useRealTimers());
it('rejects oversized UTF-8 JSON before contacting the provider', async () => {
  const res = await run({ text: '😀'.repeat(2000), target: 'fr', source: 'ro', quality: 'nmt' });
  expect(res.status).toHaveBeenCalledWith(413);
  expect(fetch).not.toHaveBeenCalled();
});
it.each([413, 429, 503])('reports upstream %s explicitly', async status => {
  fetch.mockResolvedValue({ ok: false, status, headers: { get: () => '2' }, json: async () => ({ message: 'Provider failure' }) });
  const res = await run({ text: 'Bună', target: 'fr', source: 'ro' });
  expect(res.status).toHaveBeenCalledWith(status);
  expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '2');
});
it('preserves the legacy response and optional quality', async () => {
  fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ trans: 'Bonjour' }) });
  const res = await run({ text: 'Bună', target: 'fr' });
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ translation: 'Bonjour', trans: 'Bonjour', provider: 'rapidapi' }));
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ from: 'auto', to: 'fr', text: 'Bună' });
});
it('reports the real RapidAPI gateway timeout and its plural messages field', async () => {
  fetch.mockResolvedValue({ ok: false, status: 504, headers: { get: () => null }, json: async () => ({
    messages: 'The request to the API has timed out.',
  }) });
  const res = await run({ text: 'Titlu scurt', target: 'sq', source: 'ro', quality: 'nmt' });
  expect(res.status).toHaveBeenCalledWith(504);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
    code: 'TRANSLATION_TIMEOUT', details: 'The request to the API has timed out.',
  }));
});
it('gives an explicit availability error when the provider supplies no details', async () => {
  fetch.mockResolvedValue({ ok: false, status: 503, headers: { get: () => null }, json: async () => ({}) });
  const res = await run({ text: 'Bună', target: 'en' });
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
    error: 'Serviciul de traducere nu este disponibil. Reîncearcă mai târziu.', details: null,
  }));
});
it('aborts the provider after 30 seconds', async () => {
  jest.useFakeTimers();
  fetch.mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('timeout')))));
  const pending = run({ text: 'Bună', target: 'fr' });
  await jest.advanceTimersByTimeAsync(30000);
  expect((await pending).status).toHaveBeenCalledWith(504);
});

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PortableText from '../../components/Ebooks/PortableText';
import { ebookRequest } from '../../components/Ebooks/api';
jest.mock('next/router', () => ({ useRouter: () => ({ query: { ebookId: 'demo', preview: '1' }, locale: 'ro' }) }));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ currentUser: null, loading: false }) }));
jest.mock('next-i18next/serverSideTranslations', () => ({ serverSideTranslations: jest.fn() }));
import EbookReader, { hasReadableContent } from '../../pages/ebooks/[ebookId]/read';
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; jest.useRealTimers(); });
it('renders a dedicated reader with accessible loading and controls, without the site menu', () => {
  const html = renderToStaticMarkup(<EbookReader />);
  expect(html).toContain('Se încarcă ebookul');
  expect(html).toContain('Previzualizare admin');
  expect(html).toContain('aria-controls="reader-toc"');
  expect(html).toContain('Mărește textul');
  expect(html).not.toContain('Consultații');
});
it('recognizes empty text, supported text and standalone images', () => {
  expect(hasReadableContent([])).toBe(false);
  expect(hasReadableContent(null)).toBe(false);
  expect(hasReadableContent([{ _type: 'block', children: [{ _type: 'span', text: '  ' }] }])).toBe(false);
  expect(hasReadableContent([{ _type: 'block', children: [{ _type: 'span', text: 'Text' }] }])).toBe(true);
  expect(hasReadableContent([{ _type: 'image', url: 'https://example.com/image.jpg' }])).toBe(true);
});
it('preserves formatted text, images, RTL and safe links', () => {
  const html = renderToStaticMarkup(<PortableText rtl fontSize={26} blocks={[
    { _type: 'block', style: 'h2', children: [{ _type: 'span', text: 'Titlu' }] },
    { _type: 'block', children: [{ _type: 'span', text: 'Text', marks: ['strong', 'em', 'bad'] }], markDefs: [{ _key: 'bad', href: 'javascript:alert(1)' }] },
    { _type: 'block', listItem: 'number', children: [{ _type: 'span', text: 'Listă' }] },
    { _type: 'image', url: 'https://example.com/image.jpg', alt: 'Imagine' }
  ]} />);
  expect(html).toContain('dir="rtl"'); expect(html).toContain('font-size:26px');
  expect(html).toContain('<h2>Titlu</h2>'); expect(html).toContain('<em><strong>Text</strong></em>');
  expect(html).toContain('1. '); expect(html).toContain('alt="Imagine"'); expect(html).not.toContain('javascript:');
});
it('aborts a stalled request after 20 seconds with a recognizable error', async () => {
  jest.useFakeTimers();
  global.fetch = jest.fn((_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Aborted')))));
  const pending = ebookRequest('/demo', null, { timeoutMs: 20000 });
  const rejected = expect(pending).rejects.toMatchObject({ code: 'EBOOK_TIMEOUT' });
  await jest.advanceTimersByTimeAsync(20000);
  await rejected;
  expect(jest.getTimerCount()).toBe(0);
});
it('retains authentication, private cache policy and cleans up successful request timers', async () => {
  jest.useFakeTimers();
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ title: 'Book' }) }));
  expect(await ebookRequest('/demo', { getIdToken: async () => 'test-token' }, { timeoutMs: 20000 })).toEqual({ title: 'Book' });
  expect(global.fetch).toHaveBeenCalledWith('/api/ebooks/demo', expect.objectContaining({ headers: { Authorization: 'Bearer test-token' }, cache: 'no-store', credentials: 'same-origin' }));
  expect(jest.getTimerCount()).toBe(0);
});
it('preserves server rejection messages', async () => {
  global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({ error: 'No access' }) }));
  await expect(ebookRequest('/demo', null, { timeoutMs: 20000 })).rejects.toThrow('No access');
});

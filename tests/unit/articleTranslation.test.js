/** @jest-environment jsdom */
import { createArticleTranslationSession, runArticleTranslation } from '../../lib/articleTranslation';
import { translationPayload, MAX_TRANSLATION_BYTES } from '../../lib/translationPayload';
const languages = [{ key: 'en', target: 'en' }];
const parse = html => new DOMParser().parseFromString(html, 'text/html').body;
async function run(source, extra = {}) {
  const session = createArticleTranslationSession(source);
  await runArticleTranslation(session, { languages, translate: async text => text, ...extra });
  return session.completed.get('en');
}
it.each([5, 6, 7, 20, 100])('round-trips %i KB of text through bounded real JSON payloads', async kb => {
  const text = 'ă😀"\\'.repeat(Math.ceil(kb * 1024 / 8));
  const source = `<p>${text}</p>`;
  const translate = jest.fn(async (text, target) => {
    expect(Buffer.byteLength(JSON.stringify(translationPayload(text, target, 'ro', 'nmt')))).toBeLessThanOrEqual(MAX_TRANSLATION_BYTES);
    return text;
  });
  expect(parse(await run(source, { translate })).textContent).toBe(text);
  expect(translate).toHaveBeenCalled();
});
it.each([6143, 6144, 6145])('handles a payload of exactly %i bytes', async bytes => {
  const overhead = Buffer.byteLength(JSON.stringify(translationPayload('', 'en', 'ro', 'nmt')));
  const text = 'a'.repeat(bytes - overhead);
  const translate = jest.fn(async text => {
    expect(Buffer.byteLength(JSON.stringify(translationPayload(text, 'en', 'ro', 'nmt')))).toBeLessThanOrEqual(6144);
    return text;
  });
  expect(await run(`<p>${text}</p>`, { translate })).toBe(`<p>${text}</p>`);
  expect(translate).toHaveBeenCalledTimes(bytes > 6144 ? 2 : 1);
});
it('preserves structure, attributes, media, entities and inline spaces', async () => {
  const source = '<h2 class="ql-align-center">Titlu</h2><p style="color: red"> Bună <strong><em>ziua</em></strong>&nbsp; lume &amp; soare.</p><ol><li>Unu</li><li>Doi</li></ol><p><a href="https://example.com">Link</a><img src="https://example.com/a.png"><br></p><iframe src="https://example.com/video"></iframe>';
  expect(await run(source)).toBe(parse(source).innerHTML);
});
it('escapes translated markup while keeping the original markup', async () => {
  const html = await run('<p><strong>Salut</strong></p>', { translate: async () => '<img src=x onerror=alert(1)> & text' });
  expect(parse(html).querySelector('img')).toBeNull();
  expect(parse(html).querySelector('strong').textContent).toBe('<img src=x onerror=alert(1)> & text');
});
it.each(['', '<p><br></p>', '<p> \n </p>', '<pre>code</pre><p translate="no">literal</p>'])('skips empty or excluded content: %s', async source => {
  const translate = jest.fn();
  expect(await run(source, { translate })).toBe(parse(source).innerHTML);
  expect(translate).not.toHaveBeenCalled();
});
it.each(['👨‍👩‍👧‍👦', '🇷🇴', 'a\u0306'])('preserves complex graphemes %s', async symbol => {
  const text = symbol.repeat(2000);
  expect(parse(await run(`<p>${text}</p>`)).textContent).toBe(text);
});
it('commits complete locales only, resumes failed fragments and preserves earlier output', async () => {
  const session = createArticleTranslationSession('<p>Prima</p><p>A doua</p>');
  const onLocale = jest.fn();
  const locales = [...languages, { key: 'fr', target: 'fr' }];
  await expect(runArticleTranslation(session, { languages: locales, onLocale, translate: async (text, target) => {
    if (target === 'fr' && text === 'A doua') throw Error('network');
    return target + text;
  } })).rejects.toThrow('network');
  expect(onLocale).toHaveBeenCalledTimes(1);
  expect(session.completed.has('fr')).toBe(false);
  const resume = jest.fn(async text => 'fr' + text);
  await runArticleTranslation(session, { languages: locales, onLocale, translate: resume });
  expect(resume).toHaveBeenCalledTimes(1);
  expect(session.completed.get('fr')).toBe('<p>frPrima</p><p>frA doua</p>');
});
it.each([null, '', '   ', {}])('rejects invalid provider content %p without committing', async value => {
  const onLocale = jest.fn();
  await expect(run('<p>Text</p>', { onLocale, translate: async () => value })).rejects.toThrow('goală');
  expect(onLocale).not.toHaveBeenCalled();
});
it('ignores results arriving after cancellation', async () => {
  const controller = new AbortController();
  const onLocale = jest.fn();
  await expect(run('<p>Text</p>', { onLocale, signal: controller.signal, translate: async () => { controller.abort(); return 'late'; } })).rejects.toMatchObject({ name: 'AbortError' });
  expect(onLocale).not.toHaveBeenCalled();
});
it('round-trips the saved content contract through JSON and renders translated HTML', async () => {
  const content = await run('<h2>Titlu</h2><p>Text <strong>bold</strong></p>', { translate: async text => ({ Titlu: 'Title', Text: 'Body', bold: 'bold' }[text]) });
  const saved = JSON.parse(JSON.stringify({ info: { en: { content } } }));
  expect(typeof saved.info.en.content).toBe('string');
  const root = document.createElement('div');
  root.innerHTML = saved.info.en.content;
  expect(root.querySelector('h2').textContent).toBe('Title');
  expect(root.querySelector('p').textContent).toBe('Body bold');
});

/** @jest-environment jsdom */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server.node';
import Article from '../../components/Blog/Article';
import { createArticleTranslationSession, runArticleTranslation } from '../../lib/articleTranslation';
jest.mock('next/navigation', () => ({ usePathname: () => '/blog/test' }));
jest.mock('next-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en' } }) }));
it('renders a translated and serialized long article through the unchanged public component', async () => {
  const source = '<h2>Previziuni</h2>' + '<p class="ql-align-center">Text <strong>important</strong> final.</p>'.repeat(200);
  const session = createArticleTranslationSession(source);
  await runArticleTranslation(session, { languages: [{ key: 'en', target: 'en' }], translate: async text => ({ Previziuni: 'Forecast', Text: 'Content', important: 'important', 'final.': 'end.' }[text]) });
  const record = JSON.parse(JSON.stringify({ info: { en: { nume: 'Title', content: session.completed.get('en') } }, image: { finalUri: '/test.jpg' } }));
  const html = renderToStaticMarkup(<Article filteredArticles={record} />);
  const dom = new DOMParser().parseFromString(html, 'text/html');
  expect(dom.querySelectorAll('p.ql-align-center')).toHaveLength(200);
  expect(dom.querySelectorAll('strong')).toHaveLength(200);
  expect(dom.querySelector('p').textContent).toBe('Content important end.');
  expect(dom.body.textContent).toContain('Forecast');
});

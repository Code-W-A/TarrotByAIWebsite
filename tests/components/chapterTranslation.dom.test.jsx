/** @jest-environment jsdom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ChapterEditorDialog from '../../src/features/video-library-admin/components/ChapterEditorDialog';
import { requestVideoTranslation } from '../../src/features/video-library-admin/services/videoTranslation';
jest.mock('../../src/features/video-library-admin/services/videoTranslation', () => ({ requestVideoTranslation: jest.fn() }));
let root, container;
beforeEach(async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  requestVideoTranslation.mockReset();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<ChapterEditorDialog open initialChapter={{ id: 'c1', title: 'Introducere', titles: { ro: 'Introducere', fr: 'Titre manuel' }, startInput: '0:00', endInput: '' }} localeIds={['ro', 'en', 'fr']} onSave={() => {}} onClose={() => {}} />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const generate = async () => { await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === 'Generează').click()); };
it('shows a provider failure without copying Romanian or replacing existing localized titles', async () => {
  requestVideoTranslation.mockRejectedValue(new Error('Furnizorul nu a răspuns la timp.'));
  await generate();
  expect(document.body.textContent).toContain('Furnizorul nu a răspuns la timp.');
  expect(document.querySelector('input[placeholder="en"]').value).toBe('');
  expect(document.querySelector('input[placeholder="fr"]').value).toBe('Titre manuel');
  expect(document.body.textContent).not.toContain('Gata.');
});
it('keeps completed translations if the next language fails', async () => {
  requestVideoTranslation.mockImplementation(async (_text, lang) => { if (lang === 'en') return 'Introduction'; throw new Error('Timeout'); });
  await generate();
  expect(document.querySelector('input[placeholder="en"]').value).toBe('Introduction');
  expect(document.querySelector('input[placeholder="fr"]').value).toBe('Titre manuel');
  expect(document.body.textContent).toContain('Traducerile reușite sunt păstrate.');
});

/** @jest-environment jsdom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import VideoForm from '../../src/features/video-library-admin/components/VideoForm';
import { requestVideoTranslation } from '../../src/features/video-library-admin/services/videoTranslation';

jest.mock('../../src/features/video-library-admin/services/videos.service', () => ({ listVideoCategories: jest.fn(async () => []) }));
jest.mock('../../src/features/video-library-admin/services/videoTranslation', () => {
  const actual = jest.requireActual('../../src/features/video-library-admin/services/videoTranslation');
  const requestVideoTranslation = jest.fn(async (text, lang) => `${lang}: ${text}`);
  return { ...actual, requestVideoTranslation, runVideoTranslationSession: (session, args) => actual.runVideoTranslationSession(session, { ...args, translate: requestVideoTranslation }) };
});
jest.mock('../../src/features/video-library-admin/utils/siteLocales', () => ({ SITE_LOCALES: ['ro', 'en', 'fr'] }));
jest.mock('../../src/features/video-library-admin/components/ChapterEditorDialog', () => () => null);

let container, root, onSubmit;
const video = {
  id: 'v1', title: 'Titlu RO', description: 'Descriere RO', platform: 'youtube',
  videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', isPublished: false,
};
const button = (label) => [...document.querySelectorAll('button')].find(b => b.textContent === label);
const fieldButton = (field, locale) => [...container.querySelectorAll('button[aria-label]')].find(b => b.getAttribute('aria-label').includes(field) && b.getAttribute('aria-label').endsWith(`(${locale})`));
const click = async (element) => { expect(element).toBeTruthy(); await act(async () => element.click()); };
const changeEditor = async (value) => {
  const input = document.getElementById('locale-editor-value');
  const prototype = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const edit = async (field, locale, value, action = 'Aplică') => {
  await click(fieldButton(field, locale));
  await changeEditor(value);
  await click(button(action));
};
const render = async (initialValue = video, loading = false) => {
  await act(async () => root.render(<VideoForm initialValue={initialValue} loading={loading} onSubmit={onSubmit} onCancel={() => {}} />));
};
const submit = async () => {
  await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  return onSubmit.mock.calls.at(-1)[0];
};
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  onSubmit = jest.fn(async () => {});
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it('defaults old videos to Firebase and new videos to Sanity without changing their text', async () => {
  await render();
  const source = container.querySelector('select[aria-label="Sursa tuturor descrierilor"]');
  expect(source.value).toBe('firebase');
  await act(async () => { source.value = 'sanity'; source.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(container.querySelector('textarea[placeholder="Scurtă descriere..."]').value).toBe(video.description);
  await click(button('Localizare'));
  await edit('descrierea', 'en', 'Unchanged full English');
  expect(container.querySelectorAll('select[aria-label^="Sursa descrierii ("]')).toHaveLength(0);
  const first = await submit(); const retry = await submit();
  expect(first.mutationId).toBe(retry.mutationId);
  expect(first.descriptionStorage).toMatchObject({ root: 'sanity', locales: { en: 'sanity', ro: 'sanity' } });
  expect(first.locales.en.description).toBe('Unchanged full English');
  await edit('descrierea', 'en', 'Changed English');
  expect((await submit()).mutationId).not.toBe(first.mutationId);
  await act(async () => root.render(<VideoForm onSubmit={onSubmit} onCancel={() => {}} />));
  expect(container.querySelector('select[aria-label="Sursa tuturor descrierilor"]').value).toBe('sanity');
});

it('consolidates hydrated mixed descriptions with one selector and preserves text in both directions', async () => {
  await render({ ...video, locales: { en: { title: 'English', description: 'English from Sanity', videoUrl: video.videoUrl }, ro: { title: video.title, description: 'Română din Firebase', videoUrl: video.videoUrl } },
    descriptionStorage: { version: 1, root: 'firebase', locales: { en: 'sanity', ro: 'firebase' }, sanityId: 'immutable-version' } });
  const source = container.querySelector('select[aria-label="Sursa tuturor descrierilor"]');
  expect(source.value).toBe('sanity');
  expect(container.querySelectorAll('select[aria-label^="Sursa"]')).toHaveLength(1);
  expect(onSubmit).not.toHaveBeenCalled();
  await click(button('Localizare'));
  const sanity = await submit();
  expect(sanity.descriptionStorage).toMatchObject({ root: 'sanity', locales: { en: 'sanity', ro: 'sanity' } });
  await click(button('General'));
  const currentSource = container.querySelector('select[aria-label="Sursa tuturor descrierilor"]');
  await act(async () => { currentSource.value = 'firebase'; currentSource.dispatchEvent(new Event('change', { bubbles: true })); });
  await click(button('Localizare'));
  const firebase = await submit();
  expect(firebase.descriptionStorage).toMatchObject({ root: 'firebase', locales: { en: 'firebase', ro: 'firebase' } });
  expect(firebase.description).toBe(video.description);
  expect(firebase.locales).toEqual(sanity.locales);
  expect(firebase.mutationId).not.toBe(sanity.mutationId);
  expect(firebase.locales.en.description).toBe('English from Sanity');
  expect(firebase.locales.ro.description).toBe('Română din Firebase');
  await render({ ...video, ...firebase });
  expect(container.querySelector('select[aria-label="Sursa tuturor descrierilor"]').value).toBe('firebase');
});

it('adds translations without generation, cancels drafts, and saves/reopens the same values', async () => {
  await render(); await click(button('Localizare'));
  expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
  await edit('titlul', 'en', 'Manual title');
  await edit('descrierea', 'en', 'Line one\n' + 'Long description '.repeat(100));
  await edit('titlul', 'en', 'Discard me', 'Anulează');
  expect(fieldButton('titlul', 'en').closest('td').textContent).toContain('Manual title');
  const saved = await submit();
  expect(saved.locales.en.title).toBe('Manual title');
  expect(saved.locales.en.description).toContain('Line one\n');
  expect(saved.locales.ro.videoUrl).toBe(video.videoUrl);
  expect(requestVideoTranslation).not.toHaveBeenCalled();
  await render({ ...video, ...saved }); await click(button('Localizare'));
  await click(fieldButton('descrierea', 'en'));
  expect(document.getElementById('locale-editor-value').value).toBe(saved.locales.en.description);
});

it('preserves existing titles, other languages and links when clearing a description', async () => {
  const initial = { ...video, locales: {
    ro: { title: 'Titlu RO', videoUrl: video.videoUrl },
    en: { title: 'Existing title', description: 'Existing description', videoUrl: video.videoUrl },
    fr: { title: 'Titre', description: 'Description' },
  } };
  await render(initial); await click(button('Localizare'));
  await edit('descrierea', 'en', '');
  expect(fieldButton('descrierea', 'en').getAttribute('aria-label')).toContain('Adaugă');
  expect(fieldButton('descrierea', 'en').closest('tr').textContent).toContain('Lipsește descrierea (opțională)');
  const saved = await submit();
  expect(saved.locales.en).toEqual({ title: 'Existing title', videoUrl: video.videoUrl });
  expect(saved.locales.fr).toEqual(initial.locales.fr);
});

it('protects manual values including intentional blanks during regeneration and locks edits', async () => {
  await render(); await click(button('Localizare'));
  await edit('titlul', 'en', 'Manual title');
  await edit('descrierea', 'en', '');
  let release;
  requestVideoTranslation.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await click(button('Generează localizări'));
  expect(fieldButton('titlul', 'en').disabled).toBe(true);
  expect(container.querySelector('[role="status"]').textContent).toMatch(/Engleză: fragmentul 1\/2/);
  expect(button('Se localizează...').disabled).toBe(true);
  expect(onSubmit).not.toHaveBeenCalled();
  await click(button('Se localizează...'));
  expect(requestVideoTranslation).toHaveBeenCalledTimes(1);
  await act(async () => release('Automatic title'));
  const saved = await submit();
  expect(saved.locales.en.title).toBe('Manual title');
  expect(saved.locales.en.description).toBeUndefined();
  expect(saved.locales.fr.description).toBe('fr: Descriere RO');
  await render(video, true);
  expect(fieldButton('titlul', 'en').disabled).toBe(true);
});

it('creates a new video with manual localization and no automatic translation', async () => {
  await render(null);
  const change = async (input, value) => {
    await act(async () => {
      const prototype = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  await change(container.querySelector('textarea'), 'New video');
  await click(container.querySelector('input[type=checkbox]'));
  await click(button('Linkuri'));
  await change(container.querySelector('input[placeholder*="obligatoriu"]'), video.videoUrl);
  await click(button('Localizare'));
  expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
  await edit('titlul', 'en', 'New English title');
  await edit('descrierea', 'en', 'New English description');
  const saved = await submit();
  expect(saved.locales.en).toEqual({ title: 'New English title', description: 'New English description' });
  expect(requestVideoTranslation).not.toHaveBeenCalled();
});

it('keeps existing fields on failure, exposes progress, and resumes without retranslating successful fragments', async () => {
  await render({ ...video, locales: { ro: { title: video.title, videoUrl: video.videoUrl }, en: { title: 'Old English', description: 'Old description', videoUrl: video.videoUrl } } });
  await click(button('Localizare'));
  requestVideoTranslation.mockImplementation(async (text, lang) => {
    if (lang === 'en' && text === 'Descriere RO') throw new Error('Furnizor indisponibil');
    return `${lang}: ${text}`;
  });
  await click(button('Generează localizări'));
  expect(container.textContent).toContain('Localizarea a eșuat');
  expect(container.textContent).not.toContain('Localizarea s-a terminat');
  expect(fieldButton('titlul', 'en').closest('td').textContent).toContain('Old English');
  expect(fieldButton('descrierea', 'en').closest('td').textContent).toContain('Old description');
  const before = requestVideoTranslation.mock.calls.filter(([text, lang]) => lang === 'en' && text === 'Titlu RO').length;
  requestVideoTranslation.mockImplementation(async (text, lang) => `${lang}: ${text}`);
  await click(button('Reîncearcă localizarea'));
  expect(container.textContent).toContain('Localizarea s-a terminat');
  expect(requestVideoTranslation.mock.calls.filter(([text, lang]) => lang === 'en' && text === 'Titlu RO')).toHaveLength(before);
  const saved = await submit();
  expect(saved.locales.en).toEqual({ title: 'en: Titlu RO', description: 'en: Descriere RO', videoUrl: video.videoUrl });
});

it('counts Unicode characters and blocks an oversized localized edit without truncating it', async () => {
  await render(); await click(button('Localizare'));
  await click(fieldButton('descrierea', 'en'));
  await changeEditor('🙂'.repeat(6001));
  expect(document.getElementById('locale-editor-value').value).toBe('🙂'.repeat(6001));
  expect(document.getElementById('locale-description-count').textContent).toContain('6.001 / 6.000');
  expect(button('Aplică').disabled).toBe(true);
  await changeEditor('🙂'.repeat(6000));
  expect(button('Aplică').disabled).toBe(false);
  await click(button('Aplică'));
  expect((await submit()).locales.en.description).toBe('🙂'.repeat(6000));
});

it('blocks saving and translating a changed root description above 6000 characters', async () => {
  await render();
  const textarea = container.querySelector('textarea[placeholder="Scurtă descriere..."]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, 'a'.repeat(6001));
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(textarea.value).toHaveLength(6001);
  expect(container.querySelector('#video-description-count').textContent).toContain('6.001 / 6.000');
  await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(onSubmit).not.toHaveBeenCalled();
  expect(container.textContent).toContain('Descrierea modificată depășește limita');
  await render({ ...video, description: 'a'.repeat(6001) });
  await click(button('Localizare'));
  await click(button('Generează localizări'));
  expect(requestVideoTranslation).not.toHaveBeenCalled();
  expect(container.textContent).toContain('înainte de generarea localizărilor');
});

it('allows unchanged legacy descriptions above the limit when editing other fields', async () => {
  const description = 'x'.repeat(6001);
  await render({ ...video, description, locales: { ro: { title: video.title, description, videoUrl: video.videoUrl } } });
  expect(container.textContent).toContain('Descriere existentă peste limită');
  await click(button('Localizare'));
  const saved = await submit();
  expect(saved.description).toBe(description);
  expect(saved.locales.ro.description).toBe(description);
});

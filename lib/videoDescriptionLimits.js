export const VIDEO_DESCRIPTION_MAX_CHARACTERS = 6000;

// Count Unicode code points, so a simple emoji counts as one character.
export const videoDescriptionCharacterCount = text => Array.from(typeof text === 'string' ? text : '').length;

export function videoDescriptionExceedsLimit(text, previous) {
  return videoDescriptionCharacterCount(text) > VIDEO_DESCRIPTION_MAX_CHARACTERS &&
    !(typeof previous === 'string' && text.trim() === previous.trim());
}

export function validateVideoDescriptionLimits(video, previous = {}) {
  const errors = {};
  const message = 'Descrierea poate avea maximum 6.000 de caractere, inclusiv spațiile. Textul nu a fost scurtat.';
  if (videoDescriptionExceedsLimit(video.description, previous.description)) errors.description = message;
  const localeDescriptions = {};
  for (const [locale, entry] of Object.entries(video.locales || {})) {
    if (videoDescriptionExceedsLimit(entry?.description, previous.locales?.[locale]?.description)) {
      localeDescriptions[locale] = `${locale.toUpperCase()}: ${message}`;
    }
  }
  if (Object.keys(localeDescriptions).length) errors.localeDescriptions = localeDescriptions;
  return errors;
}

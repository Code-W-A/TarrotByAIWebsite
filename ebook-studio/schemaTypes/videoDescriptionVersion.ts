import { defineType, defineField } from 'sanity';

// Managed only by the video dashboard. It is deliberately absent from Studio navigation.
export const videoDescriptionVersion = defineType({
  name: 'videoDescriptionVersion',
  title: 'Versiune descrieri video',
  type: 'document',
  readOnly: true,
  fields: [
    defineField({ name: 'videoId', type: 'string' }),
    defineField({ name: 'root', type: 'text' }),
    defineField({ name: 'locales', type: 'object', fields: [
      ...['ar', 'bg', 'bs', 'cs', 'de', 'el', 'en', 'es', 'fr', 'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'ko', 'mn', 'pl', 'pt', 'ro', 'ru', 'sk', 'sq', 'sr', 'tr', 'zh'].map(name => defineField({ name, type: 'text' })),
    ] }),
  ],
  preview: { select: { title: 'videoId' } },
});

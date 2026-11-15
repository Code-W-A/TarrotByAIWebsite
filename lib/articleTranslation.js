import { MAX_TRANSLATION_BYTES, payloadBytes, splitTranslationText } from './translationPayload';
import { requestVideoTranslation } from '../src/features/video-library-admin/services/videoTranslation';

export function createArticleTranslationSession(source) {
  return { source: source || '', fragments: new Map(), completed: new Map() };
}

function checkAbort(signal) {
  if (signal?.aborted) throw new DOMException('Traducere oprită', 'AbortError');
}

/** Only text nodes are replaced. Provider output can never introduce markup. */
export async function runArticleTranslation(session, {
  languages, signal, onProgress, onLocale, translate = requestVideoTranslation,
}) {
  for (const { key, target } of languages) {
    checkAbort(signal);
    if (session.completed.has(key)) continue;
    const doc = new DOMParser().parseFromString(session.source, 'text/html');
    const walker = doc.createTreeWalker(doc.body, 4);
    const nodes = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.parentElement.closest('script,style,iframe,code,pre,[translate="no"]')) nodes.push(node);
    }
    const jobs = nodes.map(node => ({ node, parts: splitTranslationText(node.data, target, 'ro', 'nmt') }));
    const total = jobs.reduce((count, job) => count + job.parts.filter(p => p.text).length, 0);
    let current = 0;
    for (const [nodeIndex, { node, parts }] of jobs.entries()) {
      const output = [];
      for (const [partIndex, part] of parts.entries()) {
        checkAbort(signal);
        if (part.text) {
          if (payloadBytes(part.text, target, 'ro', 'nmt') > MAX_TRANSLATION_BYTES) {
            throw new Error('Fragmentul depășește limita cererii de traducere.');
          }
          const cacheKey = JSON.stringify([key, target, nodeIndex, partIndex]);
          if (!session.fragments.has(cacheKey)) {
            const result = await translate(part.text, target, { signal, quality: 'nmt' });
            checkAbort(signal);
            if (typeof result !== 'string' || !result.trim()) throw new Error('Furnizorul a întors o traducere goală.');
            session.fragments.set(cacheKey, result.trim());
          }
          output.push(session.fragments.get(cacheKey));
          onProgress?.({ key, current: ++current, total });
        }
        output.push(part.separator);
      }
      node.data = output.join('');
    }
    checkAbort(signal);
    const html = doc.body.innerHTML;
    session.completed.set(key, html);
    onLocale?.(key, html);
  }
  return session.completed;
}

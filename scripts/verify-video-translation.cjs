/* Live, read-only translation smoke test. Writes a local report, never a video.
 * node scripts/verify-video-translation.cjs SOURCE.json OUTPUT.json nmt en,fr,de,es,ru
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const dotenv = require('dotenv');
const root = path.resolve(__dirname, '..');
for (const file of ['.env.local', '.env']) {
  const full = path.join(root, file);
  if (fs.existsSync(full)) for (const [key, value] of Object.entries(dotenv.parse(fs.readFileSync(full)))) {
    if (!process.env[key]) process.env[key] = value;
  }
}
const moduleCache = new Map();
function load(file) {
  file = path.resolve(root, file);
  if (moduleCache.has(file)) return moduleCache.get(file);
  const exports = {};
  moduleCache.set(file, exports);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(code, { exports, require: name => name.startsWith('.') ? load(path.resolve(path.dirname(file), name.endsWith('.js') ? name : name + '.js')) : require(name), process, fetch, AbortController, DOMException, setTimeout, clearTimeout, console });
  return exports;
}
async function main() {
  const [sourceFile, outputFile, quality = 'nmt', langs = 'en,fr,de,es,ru'] = process.argv.slice(2);
  if (!sourceFile || !outputFile) throw new Error('Provide SOURCE.json OUTPUT.json [nmt|llm] [en,fr,...]');
  const input = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
  const handler = load('pages/api/translate.js').default;
  const client = load('src/features/video-library-admin/services/videoTranslation.js');
  const payload = load('lib/translationPayload.js');
  const languages = langs.split(',');
  const report = { createdAt: new Date().toISOString(), quality, sourceId: input.id, source: input, requests: [], locales: {} };
  const session = client.createVideoTranslationSession(input.title, input.description, languages, quality);
  const fetchImpl = async (_url, options) => {
    const headers = new Headers(); let body, status;
    const res = { setHeader: (key, value) => headers.set(key, value), status: value => { status = value; return res; }, json: value => { body = value; return res; } };
    const request = JSON.parse(options.body);
    const started = Date.now();
    await handler({ method: 'POST', body: request }, res);
    report.requests.push({ target: request.target, bytes: payload.payloadBytes(request.text, request.target, request.source, request.quality), source: request.text, translation: body?.translation, status, durationMs: Date.now() - started, ...(status !== 200 ? { error: body } : {}) });
    fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));
    return { ok: status === 200, status, headers, json: async () => body };
  };
  try {
    await client.runVideoTranslationSession(session, {
      title: input.title, description: input.description, languages,
      translate: (text, target, opts) => client.requestVideoTranslation(text, target, { ...opts, fetchImpl }),
      onProgress: p => console.log(`${quality} ${p.language} ${p.current}/${p.total}`),
      onLocale: (language, value) => { report.locales[language] = value; fs.writeFileSync(outputFile, JSON.stringify(report, null, 2)); },
    });
    report.completed = true;
  } catch (error) { report.completed = false; report.error = error.message; process.exitCode = 1; }
  fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ quality, completed: report.completed, requests: report.requests.length, languages: Object.keys(report.locales), maxBytes: Math.max(...report.requests.map(x => x.bytes)), error: report.error }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

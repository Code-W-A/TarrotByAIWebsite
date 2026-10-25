// Keep the server resolver identical in Next.js and the separately deployed Functions package.
const fs = require('node:fs');
const path = require('node:path');
const source = path.join(__dirname, '../lib/videoDescriptionStorage.cjs');
const target = path.join(__dirname, '../../expo-mobile-app/functions/lib/videoDescriptionStorage.cjs');
const content = fs.readFileSync(source, 'utf8');
if (process.argv.includes('--write')) fs.writeFileSync(target, content);
if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content) {
  console.error('Video description resolvers differ. Run with --write to sync the local Functions copy.');
  process.exitCode = 1;
} else console.log('Video description resolvers match.');

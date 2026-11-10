// Locale parity check: every catalog must have exactly the same key set as `en`.
//
// `src/lib/locales/catalog<locale>.js` are the copies the service worker
// imports (it cannot `fetch` its own `_locales` files nor use JSON import
// assertions), so they are verified too: a locale edited in one place only
// silently reverts that language's notifications to the space-eating
// `getMessage` expansion.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '_locales');
const EMBEDDED = path.resolve(__dirname, '..', 'src', 'lib', 'locales');
const read = (locale) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, locale, 'messages.json'), 'utf8'));

const reference = Object.keys(read('en')).sort();
const locales = fs.readdirSync(ROOT).filter((name) => fs.statSync(path.join(ROOT, name)).isDirectory());
let failed = false;

for (const locale of locales) {
  const keys = new Set(Object.keys(read(locale)));
  const missing = reference.filter((key) => !keys.has(key));
  const extra = [...keys].filter((key) => !reference.includes(key));
  if (missing.length || extra.length) {
    failed = true;
    console.log(`${locale}: missing [${missing.join(', ')}] extra [${extra.join(', ')}]`);
  }
}

// The embedded copy must carry the same templates, not just the same key set.
async function checkEmbedded() {
  for (const locale of locales) {
    const name = `catalog${locale.replace(/[^A-Za-z0-9]/g, '_')}.js`;
    const file = path.join(EMBEDDED, name);
    if (!fs.existsSync(file)) {
      failed = true;
      console.log(`${locale}: src/lib/locales/${name} is missing`);
      continue;
    }
    const source = read(locale);
    const { default: embedded } = await import(pathToFileURL(file).href);
    for (const key of Object.keys(source)) {
      if (embedded[key]?.message !== source[key].message) {
        failed = true;
        console.log(`${locale}: src/lib/locales/${name} copy of "${key}" is stale`);
      }
    }
  }
}

checkEmbedded()
  .catch((error) => {
    failed = true;
    console.log(`embedded catalog check failed: ${error.message}`);
  })
  .then(() => {
    console.log(failed ? 'locale parity FAILED' : `locale parity OK (${locales.length} locales, ${reference.length} keys)`);
    process.exit(failed ? 1 : 0);
  });

// Locale parity check: every catalog must have exactly the same key set as `en`.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '_locales');
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

console.log(failed ? 'locale parity FAILED' : `locale parity OK (${locales.length} locales, ${reference.length} keys)`);
process.exit(failed ? 1 : 0);

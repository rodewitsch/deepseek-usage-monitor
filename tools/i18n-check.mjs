// Guards the substitution rules in `src/lib/i18n.js`.
//
// The point of these assertions is the whitespace: Chrome drops the ASCII
// space written right after a `$placeholder$`, which is why the wrapper renders
// the template itself. A regression here shows up as "about7days left" in the
// popup, so it is worth pinning down.
import assert from 'node:assert/strict';

// Stub the extension API the way Chrome behaves: `getMessage(key)` returns the
// template with markers, while the substitutions overload eats the space that
// follows a marker (that is exactly the bug being worked around).
const catalog = {
  depletionNote: {
    message: 'about $days$ days left at $perDay$ a day',
    placeholders: { days: { content: '$1$' }, perDay: { content: '$2$' } },
  },
  compareMonthNote: {
    message: '$values$ over the first $days$ days ($change$)',
    placeholders: { values: { content: '$1$' }, days: { content: '$2$' }, change: { content: '$3$' } },
  },
  tokensCount: { message: '$count$ tokens', placeholders: { count: { content: '$1$' } } },
  plain: { message: 'Just text' },
};

globalThis.chrome = {
  i18n: {
    getUILanguage: () => 'en-US',
    getMessage: (key, substitutions) => {
      const entry = catalog[key];
      if (!entry) return '';
      if (!substitutions) return entry.message;
      // Approximates Chrome: a space right after a substituted marker vanishes.
      return entry.message.replace(/\$([A-Za-z_][A-Za-z0-9_]*)\$/g, () => '\u0001');
    },
  },
  storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } },
};

const { t, substitute, loadCatalog } = await import('../src/lib/i18n.js');

// --- spaces survive -------------------------------------------------------
assert.equal(
  t('depletionNote', ['7', '$5.71']),
  'about 7 days left at $5.71 a day',
  'the space after each value must survive',
);

assert.equal(
  t('compareMonthNote', ['$63.00 → $47.40', '10', '−25%']),
  '$63.00 → $47.40 over the first 10 days (−25%)',
);

assert.equal(t('tokensCount', ['12.3K']), '12.3K tokens');

// --- no substitutions -----------------------------------------------------
assert.equal(t('plain'), 'Just text', 'a message without values is returned as-is');

// --- marker positions -----------------------------------------------------
// `$1`-style references are 1-based.
assert.equal(substitute('a $1 b $2', ['x', 'y']), 'a x b y');

// `$$` is an escaped dollar sign and must survive.
assert.equal(substitute('cost: $$1', ['x']), 'cost: $1');

// --- declared placeholder order (ja/hi style translations) ----------------
// The sentence puts `$days$` first while the `placeholders` block declares
// `values` first. Callers pass values in DECLARATION order, so the mapping
// must follow the declaration, not the sentence.
loadCatalog({
  reordered: {
    message: '$days$日目まで $values$ ($change$)',
    placeholders: { values: { content: '$1$' }, days: { content: '$2$' }, change: { content: '$3$' } },
  },
});
assert.equal(
  t('reordered', ['VALUE', 'DAYS', 'CHG']),
  'DAYS日目まで VALUE (CHG)',
  'values map by declaration order even when the sentence reorders markers',
);

// --- catalog path beats getMessage ----------------------------------------
// With the catalog loaded the template is read from JSON, so `t()` is immune
// to `getMessage` expanding markers to empty strings.
loadCatalog({ greeting: { message: 'hi $name$there' } });
globalThis.chrome.i18n.getMessage = () => 'broken';
assert.equal(t('greeting', ['Bob']), 'hi Bobthere', 'catalog templates are used when available');

console.log('i18n checks passed');

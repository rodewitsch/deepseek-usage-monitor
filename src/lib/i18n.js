/**
 * Minimal chrome.i18n wrapper shared by the popup, options page and the
 * service worker. `t()` returns the raw English key when the catalog is
 * missing (e.g. when the sources are opened outside the extension), so the UI
 * never renders `undefined`.
 *
 * Substitution is NOT delegated to `getMessage(key, substitutions)`.
 * Measured behaviour of that call in Chrome: the ASCII space written in the
 * message right after a `$placeholder$` is dropped, so `"about $days$ days
 * left"` comes back as `"about7days left"` — every label that embeds a value
 * renders glued together. `getMessage(key)` without substitutions returns the
 * template with the markers intact, so the values are substituted here and
 * every character the translator wrote survives.
 */
export function t(key, substitutions) {
  const args = [].concat(substitutions ?? []);
  const template = templateFor(key);
  if (template === null) return key;
  if (!args.length) return template;

  // Chrome may return the message with the values already expanded (empty,
  // because no substitutions were passed) — on those builds there is no
  // template to work with, so fall back to asking for the real expansion and
  // accept its whitespace quirk. The catalog-based path below is preferred
  // because it keeps every space the translator wrote.
  const markerForm = /\$[A-Za-z_0-9]/.test(template);
  if (markerForm) return substitute(template, args, key);

  try {
    return chrome?.i18n?.getMessage(key, args) || template;
  } catch {
    return template;
  }
}

/**
 * Template with `$markers$` intact (`null` when the key is unknown).
 *
 * Reads the shipped catalog directly when possible: `getMessage(key)` without
 * substitutions is not guaranteed to keep the markers (some Chrome builds
 * expand them to empty strings), while the JSON always has the original text.
 */
function templateFor(key) {
  const fromCatalog = catalogEntry(key);
  if (fromCatalog) return fromCatalog;

  try {
    return chrome?.i18n?.getMessage(key) || null;
  } catch {
    return null;
  }
}

/** Message template straight from the locale JSON, when it has been loaded. */
let catalogTemplates = new Map();

/**
 * Hands `i18n.js` the active catalog so `t()` can read the original template
 * (with `$markers$` and the exact spacing) instead of relying on `getMessage`,
 * whose whitespace handling differs between Chrome builds.
 *
 * @param {object} catalog parsed `messages.json`
 */
export function loadCatalog(catalog) {
  catalogTemplates = new Map();
  placeholderOrder.clear();
  for (const [key, entry] of Object.entries(catalog || {})) {
    if (typeof entry?.message !== 'string') continue;
    catalogTemplates.set(key, entry);
    if (!entry.placeholders) continue;
    const map = new Map();
    Object.keys(entry.placeholders).forEach((name, index) => map.set(name.toLowerCase(), index));
    placeholderOrder.set(key, map);
  }
}

function catalogEntry(key) {
  const entry = catalogTemplates.get(key);
  if (!entry) return null;
  return entry.message;
}

/**
 * Replaces `$name$` / `$1` markers with the positional values.
 *
 * A marker's position is the order in which the CALLER passes values, matching
 * how every call site is written (`t('compareMonthNote', [values, days,
 * change])`). Chrome would instead use the order of the `placeholders` block,
 * which in some translations (ja, hi) differs from the marker order in the
 * sentence — another source of wrong values.
 *
 * @param {string} template
 * @param {string[]} args
 * @param {string} [key] used only for the debug fallback below
 */
export function substitute(template, args, key = '') {
  // Named markers map to positional ones in order of first appearance.
  const seen = new Map();
  const placeholderOrder = placeholderDeclarationOrder(key);

  return template
    .replace(/\$\$/g, '\u0000')
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)\$|\$(\d+)/g, (whole, name, index) => {
      let position;
      if (index !== undefined) {
        position = Number(index) - 1;
      } else {
        // Prefer the declared index (matches Chrome), fall back to appearance.
        const declared = placeholderOrder.get(name.toLowerCase());
        if (declared !== undefined) position = declared;
        else {
          if (!seen.has(name)) seen.set(name, seen.size);
          position = seen.get(name);
        }
      }
      const value = args[position];
      return value === undefined ? whole : String(value);
    })
    .replace(/\u0000/g, '$');
}

/**
 * `placeholder name → declared index`, read from the shipped catalog. Values
 * are passed positionally in declaration order, which is also Chrome's own
 * rule; in a few translations (ja, hi) the sentence order differs from the
 * declaration order, so the declaration must win.
 */
const placeholderOrder = new Map();

function placeholderDeclarationOrder(key) {
  return placeholderOrder.get(key) || new Map();
}

/** Locale-aware number formatting (`1,234` vs `1 234`). */
export function formatNumber(value, options) {
  const locale = (() => {
    try {
      return chrome?.i18n?.getUILanguage?.() || undefined;
    } catch {
      return undefined;
    }
  })();
  return Number(value).toLocaleString(locale, options);
}

/** Replaces `<html lang="en">` with the actual UI language. */
export function applyDocumentLanguage() {
  try {
    document.documentElement.lang = chrome.i18n.getUILanguage();
  } catch {
    // ignore outside the extension
  }
}

/**
 * Fills every element carrying `data-i18n` / `data-i18n-title` /
 * `data-i18n-placeholder` / `data-i18n-aria-label` from the catalog.
 */
export function localizeDocument(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of root.querySelectorAll('[data-i18n-title]')) {
    node.title = t(node.dataset.i18nTitle);
  }
  for (const node of root.querySelectorAll('[data-i18n-placeholder]')) {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  }
  for (const node of root.querySelectorAll('[data-i18n-aria-label]')) {
    node.setAttribute('aria-label', t(node.dataset.i18nAriaLabel));
  }
}

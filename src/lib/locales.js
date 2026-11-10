/**
 * Notification strings for the service worker.
 *
 * `t()` renders labels from a catalog registered in `i18n.js`. The popup used
 * to pull that catalog from `_locales/` with `fetch`, which a notifications
 * API service worker cannot do — its own packaged files answer "Failed to
 * fetch". Without a catalog `t()` fell back to
 * `chrome.i18n.getMessage(key, substitutions)`, and that call drops the ASCII
 * space written right after a `$placeholder$`: the toast read
 * "SpentUSD 1.00of USD 5.00" / "Daily budget exceededfor prod_key".
 *
 * The catalogs are therefore shipped as plain ES modules (`catalog<locale>.js`,
 * generated from `_locales/<locale>/messages.json`; `tools/locale-parity.cjs`
 * fails when they drift). Modules are the only form Chrome's service worker
 * import resolver accepts — it rejects JSON import assertions.
 */
import catalogDe from './locales/catalogde.js';
import catalogEn from './locales/catalogen.js';
import catalogEs from './locales/cataloges.js';
import catalogFr from './locales/catalogfr.js';
import catalogHi from './locales/cataloghi.js';
import catalogId from './locales/catalogid.js';
import catalogJa from './locales/catalogja.js';
import catalogPtBR from './locales/catalogpt_BR.js';
import catalogRu from './locales/catalogru.js';
import catalogZhCN from './locales/catalogzh_CN.js';
import { loadCatalog } from './i18n.js';

const CATALOGS = {
  de: catalogDe,
  en: catalogEn,
  es: catalogEs,
  fr: catalogFr,
  hi: catalogHi,
  id: catalogId,
  ja: catalogJa,
  pt_BR: catalogPtBR,
  ru: catalogRu,
  zh_CN: catalogZhCN,
};

/**
 * Registers the catalog for the current UI language, falling back to `en` the
 * way Chrome does for an unknown or regional locale. Idempotent.
 */
let loaded = false;
export function ensureCatalog() {
  if (loaded) return;
  loaded = true;
  let language = 'en';
  try {
    language = String(chrome?.i18n?.getUILanguage?.() || 'en').replace('-', '_');
  } catch {
    // outside the extension
  }
  const catalog = CATALOGS[language] || CATALOGS[language.split('_')[0]] || catalogEn;
  loadCatalog(catalog);
}

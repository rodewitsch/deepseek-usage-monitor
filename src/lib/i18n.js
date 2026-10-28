/**
 * Minimal chrome.i18n wrapper shared by the popup, options page and the
 * service worker. `t()` returns the raw English key when the catalog is
 * missing (e.g. when the sources are opened outside the extension), so the UI
 * never renders `undefined`.
 */
export function t(key, substitutions) {
  try {
    const message = chrome?.i18n?.getMessage(key, substitutions);
    if (message) return message;
  } catch {
    // Not running inside the extension (plain file:// or a unit run).
  }
  return key;
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

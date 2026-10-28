// Content script (isolated world): answers "read the numbers from the page".
// The console page has already passed the WAF challenge, so this needs no
// network access at all — it only parses the DOM that is already rendered.
//
// Classic script on purpose: manifest content scripts cannot use ESM, so the
// parser lives in `page-scraper.js` and is read from `globalThis.DSUMScraper`.

(function () {
  const USAGE_PATH = '/usage';

  function readPage() {
    const scraper = globalThis.DSUMScraper;
    if (!scraper) return { ok: false, reason: 'scraper-missing' };

    const data = scraper.parseUsagePage(document);
    return data ? { ok: true, data } : { ok: false, reason: 'not-rendered' };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'dsum:scrape-page' && message?.type !== 'dsum:ping') return false;

    if (message.type === 'dsum:ping') {
      sendResponse({ ok: true, path: location.pathname, hasScraper: Boolean(globalThis.DSUMScraper) });
      return false;
    }

    // The numbers live on /usage; elsewhere say so instead of guessing.
    if (!location.pathname.startsWith(USAGE_PATH)) {
      sendResponse({ ok: false, reason: 'not-usage-page', path: location.pathname });
      return false;
    }

    try {
      sendResponse(readPage());
    } catch (error) {
      sendResponse({ ok: false, reason: error?.message || 'parse-failed' });
    }
    return false;
  });
})();

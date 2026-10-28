/**
 * Reads the numbers straight out of the already-open DeepSeek console page.
 *
 * The page has passed the WAF challenge and its React app has the data, so no
 * API call and no extra verification step is needed: we just parse the DOM.
 *
 * The console layout (verified on platform.deepseek.com/usage):
 *
 *     Topped-up balance   $2.31  USD
 *     Total cost          $138.24 USD + ¥6.05 CNY
 *     Granted balance     $6.65  USD
 *     Cost (Last 30 days) $41.47 USD + ¥6.05 CNY
 *     API requests        30,568
 *     Tokens              4,274,077,256
 *
 * Everything is text-based and label-driven, so it survives class-name churn.
 *
 * NOTE: loaded as a classic content script (manifest.json), so it must not use
 * `import`/`export`. `usage-scraper.js` reads `globalThis.DSUMScraper`.
 */
(function () {
  const MONEY = /^\s*([$¥€])\s?([\d\s,]+(?:\.\d+)?)\s*$/;
  const CURRENCY = /^[A-Z]{3}$/;
  const COUNT = /^\s*\d{1,3}(?:[,\s]\d{3})+\s*$/;
  const SYMBOL_TO_CODE = { $: 'USD', '¥': 'CNY', '€': 'EUR' };

  /**
   * @param {Document} doc
   * @returns {null | {balance, toppedUp, granted, currency, windowCost,
   *   windowCurrency, requests, tokens, capturedAt, sourceUrl}}
   */
  function parseUsagePage(doc = document) {
    const lines = pageLines(doc);
    if (!lines.length) return null;

    const toppedUp = amountAfter(lines, /topped-?up balance/i);
    const granted = amountAfter(lines, /granted balance/i);
    const windowCost = amountAfter(lines, /^cost$/i, { skip: [/^total cost$/i] });
    const requests = countAfter(lines, /^api requests$/i);
    const tokens = countAfter(lines, /^tokens$/i);

    if (!toppedUp && !windowCost && !tokens) return null;

    const currency = toppedUp?.currency || granted?.currency || windowCost?.currency || 'USD';

    return {
      balance: (toppedUp?.value || 0) + (granted?.value || 0),
      toppedUp: toppedUp?.value ?? null,
      granted: granted?.value ?? null,
      currency,
      windowCost: windowCost?.value ?? null,
      windowCurrency: windowCost?.currency ?? currency,
      requests,
      tokens,
      capturedAt: Date.now(),
      sourceUrl: doc.location?.href || '',
    };
  }

  /** Normalises the visible text into trimmed, non-empty lines. */
  function pageLines(doc) {
    const raw = doc.body?.innerText || '';
    return raw
      .split('\n')
      .map((line) => line.trim().replace(/\s+/g, ' '))
      .filter(Boolean);
  }

  /**
   * Finds the first money value that follows `label` within a few lines.
   * `skip` excludes look-alike labels (e.g. "Total cost" for "Cost").
   */
  function amountAfter(lines, label, { skip = [], lookahead = 8 } = {}) {
    for (let i = 0; i < lines.length; i += 1) {
      if (!label.test(lines[i])) continue;
      if (skip.some((pattern) => pattern.test(lines[i]))) continue;

      // Decorative rows ("Balance alert enabled", "Settings") may sit between
      // the label and its value, so scan forward for the first money line.
      for (let j = i + 1; j <= Math.min(i + lookahead, lines.length - 1); j += 1) {
        const parsed = parseAmount(lines[j], lines[j + 1]);
        if (parsed) return parsed;
      }
    }
    return null;
  }

  /** Counts (`30,568`, `4,274,077,256`) — skips chart axis labels like `3,000`. */
  function countAfter(lines, label, { lookahead = 4 } = {}) {
    for (let i = 0; i < lines.length; i += 1) {
      if (!label.test(lines[i])) continue;
      for (let j = i + 1; j <= Math.min(i + lookahead, lines.length - 1); j += 1) {
        if (COUNT.test(lines[j])) return toNumber(lines[j]);
        if (!isShortNumber(lines[j])) break;
      }
    }
    return null;
  }

  function parseAmount(value, next) {
    const match = MONEY.exec(value || '');
    if (!match) return null;
    const symbol = match[1];
    const amount = toNumber(match[2]);
    if (!Number.isFinite(amount)) return null;

    const currencyLine = CURRENCY.test(next || '') ? next : null;
    return {
      value: amount,
      currency: currencyLine || SYMBOL_TO_CODE[symbol] || 'USD',
      symbol,
    };
  }

  function isShortNumber(line) {
    return /^\d{1,3}$/.test(line || '');
  }

  /** `4,274,077,256` / `$2.31` → number. */
  function toNumber(value) {
    const cleaned = String(value ?? '').replace(/[^\d.]/g, '');
    if (!cleaned) return 0;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  globalThis.DSUMScraper = { parseUsagePage, toNumber };
})();

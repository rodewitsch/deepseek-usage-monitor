# DeepSeek Usage Monitor

Chrome extension (Manifest V3) for [platform.deepseek.com](https://platform.deepseek.com/usage):
wallet balance, today's spend (total **or per API key**) and a configurable
toolbar badge — with a one-click jump to the platform usage page.

No API key and no password is stored: the extension reuses the session that is
already present in your browser for `platform.deepseek.com`.

## Features

| | |
|---|---|
| **Popup** | Wallet balance (paid / bonus split), spend today + tokens, a 30-day spend chart, per-key list and a daily-budget bar. |
| **Badge** | Shows one of: spend today, spend in the period, wallet balance, tokens today. Can be scoped to a single API key. |
| **Daily budgets** | Account-wide and/or per-API-key budgets, green / orange / red badge, desktop notification on the warn and over thresholds. |
| **Multi-key chart** | Plot the spend of several API keys at once as a stacked per-day chart with a legend. |
| **Settings** | Metric, key scope, number format, auto-refresh interval, aggregation window, low-balance warning, daily budget, decimals. |
| **Shortcut** | `Open usage page` button opens `https://platform.deepseek.com/usage`. |

## Install

**From the Chrome Web Store:** search for *DeepSeek Usage Monitor*.

**Unpacked (development):**

1. `npm install && npm run build` — produces `dist/` and `deepseek-usage-monitor-v<version>.zip`.
2. Open `chrome://extensions` → enable **Developer mode** → **Load unpacked**.
3. Select the `dist` folder (or this folder to run the unminified sources).
4. Open `https://platform.deepseek.com`, sign in, then click the extension icon.

The first refresh happens automatically; use ↻ in the popup to force one.

## Development

```bash
npm install
npm run build            # minify + zip into dist/
npm run release          # bump version (package.json + manifest.json), CHANGELOG
npm run release:minor    # force a minor bump
```

Release flow: commit with Conventional Commits, run `npm run release`, then
`git push --follow-tags`.

## How the session is read

Verified against the live console: the session token lives in
`localStorage.userToken` on `platform.deepseek.com` as `{"value":"<64 chars>"}`
and must be sent as `Authorization: Bearer <value>`. The cookies
(`smidV2`, `aws-waf-token`) are **not** the session — but they are still
required, because the console sits behind AWS WAF and a cookie-less request
gets `202 text/html` instead of JSON. So all requests are made with
`credentials: 'include'` (works thanks to `host_permissions`).

Resolution order:

1. `chrome.cookies` on `deepseek.com` (in case the token ever moves there).
2. A MAIN-world content script reads `localStorage` of the platform origin,
   trying `userToken` first, then other `token`/`auth` keys — while explicitly
   ignoring the look-alikes that are **not** the session
   (`aws_waf_token_challenge_attempts`, `awswaf_session_storage`,
   `awswaf_token_refresh_timestamp`, `__tea_cache_*`, `__appKit_userInfo`, …).

If the API still answers `40003 Authorization Failed`, the stored token is
dropped, the session is re-read from the browser and the request is retried
once before the error is shown.

Everything is stored in `chrome.storage.local` on this machine only; no third
party receives any data.

## WAF handling (no tabs, ever)

The console is protected by an **AWS WAF token challenge**: without a valid
`aws-waf-token` cookie the API answers `202 text/html` instead of JSON.

The extension **never opens tabs** to deal with it. Measured behaviour:

| Request | Result |
|---|---|
| real browser cookies (`credentials: 'include'`) | `200` + JSON |
| `Cookie:` header set manually from JS | `202` — the browser drops the header |
| no cookies | `202` |

So the token cannot be forged; it has to be a real cookie, and it is renewed
automatically whenever *you* visit `platform.deepseek.com` (it is also readable
from that page's `document.cookie`). The extension therefore only **reads** the
cookie state:

* valid → everything refreshes on the normal alarm, fully automatic;
* expired → the badge shows `−` and the tooltip says
  *"DeepSeek WAF token expired. Open platform.deepseek.com once"*.

In practice the token is fresh as long as the console is used occasionally; the
only thing the extension cannot do on its own is renew a long-expired challenge,
because that requires running DeepSeek's JS challenge on their page.

## Endpoints used

```
GET https://platform.deepseek.com/api/v0/users/get_user_summary
GET https://platform.deepseek.com/api/v0/usage/by_api_key/amount?start&end&tz
GET https://platform.deepseek.com/api/v0/usage/by_api_key/cost?start&end&tz
```

Quirks that are handled in `src/lib/api.js` / `src/lib/http.js`:

* `start`/`end` must be **day-aligned** (`00:00 UTC of that day`), `tz` is the
  caller's UTC offset in seconds. Arbitrary seconds → `biz_code 1 INVALID_PARAM`.
* Windows longer than 31 days are rejected.
* A multi-day window returns **daily** buckets; a single day returns **hourly**
  buckets (24). "Today" is therefore fetched separately for accuracy.
* Buckets are stamped at the *previous* UTC-18:00 with `tz=10800`, so the day
  key must be computed with the offset (`dayKeyFromUnix`).
* There is **no** "today" bucket in the daily series — the platform's own
  "Last 30 days" figure excludes the current day until rollover. The chart
  therefore adds today from the hourly series.
* `cost` buckets are per `(api_key, model)` series and must all be summed.

## Configuration

Click **Settings** in the popup (or *Options* on `chrome://extensions`).

* **Show on the icon** — spend today / spend in period / balance / tokens today.
* **Measure for** — all keys, or any combination of API keys (their spend is summed).
* **Auto refresh** — background alarm interval in minutes (`0` disables it).
* **Aggregation window** — how many days the per-key and chart spend covers.
* **Low balance warning** — the badge goes red below this balance.
* **Daily budget** — today's spend budget for the selected scope (`0` = off).
  When set, the badge and the popup bar are **green** below the warn ratio,
  **orange** at/above it and **red** once the budget is reached.
* **Per-key daily budgets** — one independent budget per API key.
* **Warn at (% of budget)** — the orange threshold, `90` by default.
* **Notify** — one desktop notification per day and per budget when it is nearly
  used up, and one when it is exceeded.

### Daily budgets

With a budget of `$1` and the default 90 % warn ratio:

| Spent today | Badge | Popup |
|---|---|---|
| `$0.20` | green | green bar, `20%` |
| `$0.93` | orange | orange bar, `93%`, warn marker |
| `$1.15` | red | red bar, `Over by $0.15` |

Two scopes are supported and they are independent:

* **Account budget** (`dailyBudget`) — measured on whatever is selected in
  **Measure for**: the whole account by default, or the sum of the selected keys.
* **Per-key budgets** (`keyBudgets`) — each key is checked on its own spend.

The badge is coloured by whichever active budget is closest to its limit, and
notifications are emitted per budget, so one overloaded key does not hide the
account state.

### Multi-key chart

The popup chart plots **all** keys as a single series by default. Click any key
in the **API keys** list to add it to the chart — the bars become stacked
segments with a colour per key and a legend underneath. Click **All keys** in
the section header to go back to the total. A budget bar is shown for the
account and for every selected key that has a budget.

## Project layout

* `src/lib/format.js` — formatting + envelope unwrapping helpers.
* `src/lib/api.js` — DeepSeek client and payload normalisation.
* `src/lib/badge.js` — decides the badge text/colour/tooltip.
* `src/lib/budget.js` — account and per-key budget evaluation, notification keys.
* `src/lib/waf.js` — WAF cookie state (read-only, never opens tabs).
* `src/background.js` — alarms, badge painting, refresh orchestration.

## Troubleshooting

* **Badge shows `!`** — the session was not found or expired. Sign in on
  `platform.deepseek.com`, then press **Re-detect session** in settings.
* **`40003 Authorization Failed (invalid token)`** — a wrong token was cached
  (e.g. a WAF/analytics key), or the content script was never injected because
  the tab predates the extension install. Reload the extension, then press
  **Re-detect session** in settings. The token is now re-read from the page
  (with on-demand `chrome.scripting` injection into every platform tab), and a
  token rejected by the API is never kept.
* **`DeepSeek WAF token expired`** — the browser's `aws-waf-token` is gone or
  stale. Open `platform.deepseek.com` once; it is renewed automatically and the
  extension picks it up on the next refresh. The extension deliberately does not
  open tabs on its own.
* **Badge shows `—`** — no data yet; open the popup and press ↻.
* **`HTTP 401/403`** — the console token expired; the extension clears it and
  re-reads it on the next platform page load.
* **`code 40003` / `biz_code` errors** — the console API changed shape; check
  the payloads in DevTools (`platform.deepseek.com` → Network).

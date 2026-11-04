# Roadmap

Planned work for **DeepSeek Usage Monitor**, roughly ordered by value per effort.
Items are grouped into milestones; within a milestone the order is a suggestion,
not a commitment.

## Guiding constraints

These shape everything below and are not up for negotiation:

- **No API key, no password** — the extension reuses the browser session
  (`localStorage.userToken`) and never stores secrets.
- **Read-only WAF handling** — the `aws-waf-token` cookie is never forged; a
  stale challenge only needs the user to open `platform.deepseek.com` once.
- **Console API limits** — usage windows are max **31 days** and day-aligned;
  longer history must be accumulated locally.
- **Plain JS, MV3, no build step** — load unpacked / build with `npm run build`.

## Legend

- **P0** — high value, low effort; candidates for the next release.
- **P1** — valuable, but needs more design or plumbing.
- **P2** — nice to have / platform work.

Effort is relative to this codebase: **S** (hours), **M** (a day), **L** (multi-day).

## Done

| Shipped | Release | Item | Notes |
|---|---|---|---|
| 1.0.0 | v1.0.0 | Popup, 30-day chart, badge metrics, daily budgets, notifications, 10 locales | baseline |
| 1.1.0 | v1.1.0 | DeepSeek service status monitor | `src/lib/status.js` |
| 2026-11-04 | unreleased | **Milestone 1** — per-model breakdown, prompt-cache savings, end-of-day forecast | `src/lib/models.js`, `src/lib/forecast.js` (`6673630`) |
| 2026-11-04 | unreleased | **Popup layout** — show/hide and reorder the popup blocks | settings only; `popupSections` / `popupHidden` (`6673630`) |
| 2026-11-04 | unreleased | **Milestone 2** — local history, month/today comparison, balance depletion, CSV/JSON export | `src/lib/history.js`, `src/lib/exporter.js` |
| 2026-11-04 | v1.3.0 | **Header actions** — usage page, refresh and settings moved into the header as icon buttons (the footer is gone) | `popup.html`, `.header__actions` |

Not done on purpose: **drag-and-drop inside the popup** was implemented and then
removed — reordering in Settings is enough and the drag was unreliable in the
popup panel.

---

## Milestone 1 — Analytics: models & cache savings (v1.2) ✅

The `model` and `PROMPT_CACHE_HIT_TOKEN` data are already in the payloads;
this is mostly normalisation + UI.

- [x] **Per-model breakdown** — `deepseek-chat` vs `deepseek-reasoner` cost and
      tokens, today and in the window. *(P0, S)* — `src/lib/models.js` +
      popup section "By model".
- [x] **Prompt-cache savings** — "saved $X thanks to cache" from
      `PROMPT_CACHE_HIT_TOKEN`. *(P0, S)* — shown under the model list.
- [x] **End-of-day forecast** — today's pace × remaining hours → projected
      spend. *(P0, S)* — `src/lib/forecast.js` + "Projected today" block.

## Milestone 2 — History & projections (v1.3) ✅

- [x] **Local history accumulation** — persist the daily total (and per-key
      daily totals) to `chrome.storage.local`, so charts can cover more than
      the 31-day API window. *(P1, M)* — `src/lib/history.js`, merged on every
      successful refresh into `usageHistory`.
- [x] **Month-over-month / today-vs-yesterday comparison** — built on top of
      the accumulated history. *(P1, S after history)* — "Comparison" popup
      block, compared like-for-like (same day-of-month slice).
- [x] **"Balance runs out on …"** — balance ÷ average daily spend → estimated
      depletion date. *(P0, S)* — average window configurable (0 = all history).
- [x] **CSV/JSON export** — one button in the popup exporting day/key/model
      spend. *(P1, S)* — `src/lib/exporter.js`.

Known limit: the per-model split is only known for the current API window, so
older days in the CSV carry day totals but empty model columns.

## Milestone 3 — Smarter alerts (v1.4)

- [ ] **Budget forecast notification** — warn when the current pace will
      exceed the budget before midnight, not only after the fact. *(P0, S)*
- [ ] **Spike detection** — notify when a day's spend is well above the rolling
      average (guards against runaway loops / leaked keys). *(P1, M)*
- [ ] **New / inactive key alerts** — notify on a newly appeared API key, or a
      key unused for N days. *(P2, S)*

## Milestone 4 — UX & platform (v1.5)

- [ ] **Click-to-copy** — copy balance / spend / key values from the popup.
      *(P0, S)*
- [x] **Popup layout** — pick which blocks are shown and reorder them (arrows
      in Settings). *(P0, M)* — `settings.popupSections` + `settings.popupHidden`.
- [x] **Header toolbar** — usage page, refresh and settings as icon buttons in
      the header instead of footer buttons with labels. *(P0, S)* — `.header__actions`.
- [ ] **Context menu** — "Open usage for this key" via `chrome.contextMenus`
      (needs its own permission, already accounted for). *(P1, S)*
- [ ] **On-console widget** — a compact balance/budget strip injected into
      `platform.deepseek.com` using the existing content scripts. *(P1, M)*
- [ ] **Keyboard shortcut** — `chrome.commands` for refresh / open usage.
      *(P2, S)*
- [ ] **Firefox port** — MV3 is supported; needs `browser` namespace handling
      and an AMO build. *(P2, L)*

---

## Icebox / blocked

- **History > 31 days without local storage** — blocked by the console API.
- **Auto-renewal of the WAF challenge** — would require running DeepSeek's JS
  on their page; deliberately out of scope.
- **Invoice / payment data** — not exposed by the known endpoints.
- **Multi-currency display** — the API returns currency blocks; the popup
  currently picks USD/CNY. Revisit only if there is real demand.

---

## How to pick up an item

1. Work against `main`, Conventional Commits.
2. Keep the "no secrets, no tab-opening" invariants.
3. Verify with `node tools/self-check.mjs` (or the smallest relevant check),
   then bump via `npm run release`.

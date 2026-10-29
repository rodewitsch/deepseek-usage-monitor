# Changelog

All notable changes to this project are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/), versioned with [SemVer](https://semver.org/).

### 1.0.1 (2026-10-29)


### Fixed

* **badge:** ignore the key selection for the wallet balance metric ([0db5d43](https://github.com/rodewitsch/deepseek-usage-monitor/commit/0db5d43ac48aa1fb0f3ebb4533caba0a236144da))
* **options:** align per-key budget inputs in a fixed grid ([e08eb4e](https://github.com/rodewitsch/deepseek-usage-monitor/commit/e08eb4edd6c41cffb212f502ab2ab43125bd6385))
* **popup:** use the 128px icon in the header ([4b6efbb](https://github.com/rodewitsch/deepseek-usage-monitor/commit/4b6efbb575ae18f22d680c5ccda6bd5b5da4ace9))
* **waf:** treat the console tab as the primary source and hide WAF blocks ([2a79316](https://github.com/rodewitsch/deepseek-usage-monitor/commit/2a79316baedc719cec3cd730bcbbc4e59a3f5d1c))


### Added

* DeepSeek Usage Monitor browser extension ([f629037](https://github.com/rodewitsch/deepseek-usage-monitor/commit/f629037beca5cad69025925a2b7fbd15b5f534a1))
* **i18n:** localize the extension into 10 languages ([6984e2f](https://github.com/rodewitsch/deepseek-usage-monitor/commit/6984e2f38a46a02303555554279d436bd6e011b6))
* new icon, new title ([c2355ac](https://github.com/rodewitsch/deepseek-usage-monitor/commit/c2355ac1f083f6e6c214e62fa05953c12a48571a))
* **popup:** multi-key chart and per-key daily budgets ([8769648](https://github.com/rodewitsch/deepseek-usage-monitor/commit/8769648c06487040d65567daaa75e1a1747251a9))

## 1.1.0 (2026-10-28)

### Added

- Multi-key spend chart: select any combination of API keys in the popup and the daily chart becomes stacked segments with a colour per key and a legend.
- Per-key daily budgets, independent of the account budget. The popup shows one bar per active budget and notifications fire for each budget separately.

### Changed

- `Measure for` in the badge settings is now a multi-select; the selected keys' spend is summed. Settings left over from 1.0.0 (`badgeApiKey`, `focusApiKey`) are migrated automatically.
- The account budget is evaluated against the current selection (whole account when nothing is selected).

### Removed

- The **Number format** setting (auto / money / tokens). The badge always shows money now.

## 1.0.0 (2026-10-28)

### Added

- Popup with wallet balance (paid / bonus), today's spend and tokens.
- 30-day spend chart and a per-key spend list with filtering.
- Configurable toolbar badge: today's spend, period spend, balance or tokens; optionally scoped to a single API key.
- Daily budget with green / orange / red badge colours and desktop notifications at the warn ratio and when exceeded.
- Settings page with metric, key scope, refresh interval, aggregation window, low-balance warning and decimals.
- One-click jump to the DeepSeek usage page.
- Automatic refresh via `chrome.alarms`; badge repaints when the console page changes.

### Security

- The console session token is read from the browser (`localStorage.userToken` on `platform.deepseek.com`); no API key or password is stored or transmitted anywhere else.
- The extension never opens tabs on its own and sends data only to `platform.deepseek.com`.

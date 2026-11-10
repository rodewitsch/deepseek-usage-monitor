# Changelog

All notable changes to this project are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/), versioned with [SemVer](https://semver.org/).

## [1.5.0](https://github.com/rodewitsch/deepseek-usage-monitor/compare/v1.4.1...v1.5.0) (2026-11-10)


### Added

* **history:** read the day-by-day ledger from the API instead of storing it ([df8b9b8](https://github.com/rodewitsch/deepseek-usage-monitor/commit/df8b9b8f94c326d9a456229c715a2d008cb038c6))


### Fixed

* **i18n:** render message templates ourselves so substituted values keep their spaces ([700dce0](https://github.com/rodewitsch/deepseek-usage-monitor/commit/700dce0730cb15208523adc9ce88c693af0c1cd9))
* **notifications:** scrub re-encoded characters before the toast is shown ([a8894a8](https://github.com/rodewitsch/deepseek-usage-monitor/commit/a8894a8c3081e1e3d30ca65fe3289c3b4a98d810))

### [1.4.1](https://github.com/rodewitsch/deepseek-usage-monitor/compare/v1.4.0...v1.4.1) (2026-11-08)


### Fixed

* **popup:** keep API key rows on one line and honour money settings ([4fac9a3](https://github.com/rodewitsch/deepseek-usage-monitor/commit/4fac9a3189efa50e000f1d64a53c2b2d7e68b234))

## [1.4.0](https://github.com/rodewitsch/deepseek-usage-monitor/compare/v1.3.0...v1.4.0) (2026-11-06)


### Added

* **alerts:** budget pace, spend spikes and key lifecycle alerts ([38a6f77](https://github.com/rodewitsch/deepseek-usage-monitor/commit/38a6f77e95b263322cf758d2fcd413354bb34caa))

## [1.3.0](https://github.com/rodewitsch/deepseek-usage-monitor/compare/v1.2.0...v1.3.0) (2026-11-04)


### Added

* local history, comparisons, depletion estimate and export ([3f1b9a9](https://github.com/rodewitsch/deepseek-usage-monitor/commit/3f1b9a960c1a46a7ee751cfea882ac51d599df53))
* **popup:** move usage/settings actions into the header as icons ([cbe3960](https://github.com/rodewitsch/deepseek-usage-monitor/commit/cbe396076cc9c03419f50d38b699263e2b318959))

## [1.2.0](https://github.com/rodewitsch/deepseek-usage-monitor/compare/v1.1.0...v1.2.0) (2026-11-04)


### Added

* **popup:** model breakdown, cache savings, forecast and layout ([6673630](https://github.com/rodewitsch/deepseek-usage-monitor/commit/66736308399ebd336122f519fda800e108456a2e))

## [1.1.0](https://github.com/rodewitsch/deepseek-usage-monitor/compare/v1.0.4...v1.1.0) (2026-11-03)


### Added

* add DeepSeek service status monitor ([bf25fa1](https://github.com/rodewitsch/deepseek-usage-monitor/commit/bf25fa162f1b38476b04f8c5a11981e5bd5757e1))

### [1.0.4](https://github.com/rodewitsch/deepseek-usage-monitor/compare/v1.0.3...v1.0.4) (2026-11-02)


### Fixed

* logo size ([0e82176](https://github.com/rodewitsch/deepseek-usage-monitor/commit/0e82176b6a94caba3499777034fa169ced10aa1f))

### [1.0.3](https://github.com/rodewitsch/deepseek-usage-monitor/compare/v1.0.2...v1.0.3) (2026-10-30)

### [1.0.2](https://github.com/rodewitsch/deepseek-usage-monitor/compare/v1.0.1...v1.0.2) (2026-10-29)


### Added

* new icons ([0d724ed](https://github.com/rodewitsch/deepseek-usage-monitor/commit/0d724edf5d21331a4874f4524f1cd53d7c9174c1))

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

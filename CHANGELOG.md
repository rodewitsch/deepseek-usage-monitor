# Changelog

All notable changes to this project are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/), versioned with [SemVer](https://semver.org/).

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

# Changelog

All notable changes to this project are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/), versioned with [SemVer](https://semver.org/).

## 1.0.0 (2026-10-28)

### Added

- Popup with wallet balance (paid / bonus), today's spend and tokens.
- 30-day spend chart and a per-key spend list with filtering.
- Configurable toolbar badge: today's spend, period spend, balance or tokens; optionally scoped to a single API key.
- Daily budget with green / orange / red badge colours and desktop notifications at the warn ratio and when exceeded.
- Settings page with metric, key scope, number format, refresh interval, aggregation window, low-balance warning and decimals.
- One-click jump to the DeepSeek usage page.
- Automatic refresh via `chrome.alarms`; badge repaints when the console page changes.

### Security

- The console session token is read from the browser (`localStorage.userToken` on `platform.deepseek.com`); no API key or password is stored or transmitted anywhere else.
- The extension never opens tabs on its own and sends data only to `platform.deepseek.com`.

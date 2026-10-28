# Privacy Policy — DeepSeek Usage Monitor

**Last updated: 28 October 2026**

DeepSeek Usage Monitor ("the extension") is a Chrome extension that displays your
DeepSeek Platform usage figures in the browser toolbar and popup. This page
explains exactly what the extension does with your data.

## Summary

- The extension talks **only** to `https://platform.deepseek.com` — the site you
  are already signed into.
- All data (settings, cached figures, session token) is stored **locally** with
  `chrome.storage.local` on your own computer.
- **Nothing** is sent to the developer or to any third party.
- There is no analytics, no telemetry, no advertising, no tracking.

## What data the extension accesses

| Data | Why | Where it goes |
|---|---|---|
| DeepSeek session token (from your existing login) | To call the same API endpoints the DeepSeek web console calls | Stored in `chrome.storage.local`; sent only to `platform.deepseek.com` |
| Wallet balance, spend, tokens, per-API-key usage | To show them in the popup and on the toolbar badge | Stored in `chrome.storage.local`; never transmitted elsewhere |
| Your extension settings (metric, selected keys, refresh interval, budgets) | To remember your preferences | Stored in `chrome.storage.local` |
| `deepseek.com` cookies (`aws-waf-token`, `smidV2`), **read-only** | To detect the session/AWS WAF state | Not stored, not transmitted; only read in place |

The extension does **not** read your browsing history, page content on other
sites, keystrokes, clipboard, files, or your DeepSeek password. It never opens
tabs on its own.

## Network requests

The extension performs three read-only `GET` requests, and only to
`https://platform.deepseek.com`:

```
GET /api/v0/users/get_user_summary
GET /api/v0/usage/by_api_key/amount
GET /api/v0/usage/by_api_key/cost
```

These are the same requests the DeepSeek web console itself makes. Requests are
sent with `credentials: 'include'` and your existing session token. No other
domain is contacted, and no data is uploaded or POSTed anywhere.

## Data sharing

The extension does **not** sell, share, transfer, or disclose any data to third
parties. It does not use data to determine creditworthiness or for lending
purposes. It does not use data for purposes unrelated to its single purpose —
showing your DeepSeek usage statistics.

## Data retention and deletion

Everything is stored locally on your device. To delete all data, remove the
extension from Chrome (`chrome://extensions` → Remove) or clear the extension's
storage. No server-side copies exist, because no data is ever sent to a server
other than DeepSeek's own API, which you already use through their console.

## Changes to this policy

Material changes will be published in this file and noted in `CHANGELOG.md`.

## Contact

Issues and questions: <https://github.com/rodewitsch/deepseek-usage-monitor/issues>

---

*DeepSeek Usage Monitor is not affiliated with, endorsed by, or sponsored by
DeepSeek. "DeepSeek" is a trademark of its respective owner.*

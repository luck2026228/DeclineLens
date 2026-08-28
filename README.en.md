# DeclineLens

[中文说明](README.md)

When a card payment fails, the page says "Your card was declined." and nothing else. The Stripe response actually contains `decline_code`, `advice_code`, `network_decline_code` and a human-readable `message` — the frontend just throws them away. This tool intercepts the response, decodes the code, and tells you what to do next.

Runs entirely locally. Zero network requests. Two builds, identical features:

- **Userscript** — single file, one-click install through Tampermonkey or Violentmonkey, auto-updates. Recommended.
- **Browser extension** — Chrome/Edge (MV3, `world: "MAIN"`, needs Chrome 111+) and Firefox (`scripting` API plus host permission).

Note the UI itself is Chinese only — the dictionary that turns `transaction_not_allowed` into "this card doesn't support this kind of purchase, switch cards" is written in Chinese. An English UI is on the [roadmap](ROADMAP.md) but not done.

## Install

Install [Tampermonkey](https://www.tampermonkey.net/), then open:

**[DeclineLens.user.js](https://github.com/luck2026228/DeclineLens/raw/main/DeclineLens.user.js)**

For the extension, grab a zip from [Releases](https://github.com/luck2026228/DeclineLens/releases/latest), unzip it, then load it unpacked from `chrome://extensions`. On Firefox you must also grant "Access your data for all websites" in `about:addons` — without it `scripting.registerContentScripts` never starts and injection silently falls back to a `<script>` tag, which CSP sites block.

## Privacy, verifiable line by line

- **Zero network requests.** Not one, including update checks.
- **Only responses matching one regex** (`PAY_URL` in `pagehook.js`) are ever read. Everything else isn't even cloned.
- **Never touches input fields.** It reads HTTP responses, not the DOM.
- **11 fields stored, no raw body.** No email, no name, no billing address, no card digits.
- **`storage.local` / `GM_setValue`** — local only, never synced, capped at 200 records.
- **Chrome permissions: `["storage"]`.** That's the entire list.

## Two bugs worth knowing about if you fork this

1. **MAIN and ISOLATED worlds have different `window` objects.** The handshake flag has to live on the DOM (`data-declinelens`), not on `window`. v2.1 used a `window` variable and it silently never propagated.
2. **In Tampermonkey, any `@grant` other than `none` sandboxes your script.** `window.fetch = wrapped` then wraps the *sandbox's* fetch — the script appears to work perfectly and captures nothing, forever. You need `unsafeWindow`. `test.js` §3 builds a two-layer sandbox/page window structure specifically to catch this.

More in [ARCHITECTURE.md](ARCHITECTURE.md) (Chinese).

## Contributing

Hit an unrecognized decline code? Click 「复制报告」 (copy report) and [open an issue](https://github.com/luck2026228/DeclineLens/issues/new?template=missing-code.yml) — the report is plain text with no private fields. Or add the entry to `dict.js` yourself:

```bash
node test.js        # 60 assertions, zero dependencies, no browser needed
python build.py     # builds both extension zips and the userscript
```

Never hand-edit `DeclineLens.user.js`; it's generated. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT.

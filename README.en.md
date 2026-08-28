# DeclineLens

[中文](README.md) ｜ English

[![CI](https://github.com/luck2026228/DeclineLens/actions/workflows/ci.yml/badge.svg)](https://github.com/luck2026228/DeclineLens/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/luck2026228/DeclineLens?label=%E6%9C%80%E6%96%B0%E7%89%88&color=2ea44f)](https://github.com/luck2026228/DeclineLens/releases/latest)
[![License](https://img.shields.io/github/license/luck2026228/DeclineLens?label=%E8%AE%B8%E5%8F%AF%E8%AF%81&color=blue)](LICENSE)

When a card payment fails abroad, all the page tells you is "Your card was declined." But Stripe's response actually states exactly why — the frontend just never shows it. This tool fishes it out, decodes it, and tells you what to do next.

Runs entirely locally, sends zero network requests. Two builds — a browser extension and a userscript — with identical features. Pick one.

Note: the panel text is Chinese for now. An English UI is on the [roadmap](ROADMAP.md) but not done yet.

### Userscript (recommended)

Install [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/) first, then click this link:

**[DeclineLens.user.js](https://github.com/luck2026228/DeclineLens/raw/main/DeclineLens.user.js)**

The manager pops up an install page — click Install and you're done. It auto-updates from then on. If nothing pops up, open the link, select all, copy, then Tampermonkey → Create a new script → paste → `Ctrl+S`.

The Tampermonkey icon's dropdown also carries three commands: open the panel (for when the floating orb is covered by the page), copy the latest report, clear all records.

### Chrome / Edge extension

1. Download `DeclineLens-v3.1.2-chrome.zip` from [Releases](https://github.com/luck2026228/DeclineLens/releases/latest)
2. Unzip it into a directory you won't casually delete — Chrome reads from that path on every startup
3. Type `chrome://extensions` in the address bar and turn on Developer mode (top right)
4. Click "Load unpacked" and select that directory

Loading straight from a clone works too — `manifest.json` sits at the repo root. The extra files like `build.py` and `test.js` are ignored by Chrome.

### Firefox extension

Download the firefox zip, unzip it, type `about:debugging#/runtime/this-firefox` in the address bar, click "Load Temporary Add-on…" and pick the `manifest.json` in that directory.

Then one step you must not skip: **`about:addons` → DeclineLens → Permissions → allow "Access your data for all websites"**. Firefox's `scripting.registerContentScripts` requires the extension to hold host permissions for the target pages; without the grant the official injection channel never starts, and it silently degrades to `<script>`-tag injection — a path that CSP-protected sites block. `checkout.stripe.com` is one of them.

Also, "Load Temporary Add-on" expires when the browser restarts, so you'd redo it every boot. On Firefox the userscript is the low-hassle choice; the features are exactly the same.

### After installing

Nothing to configure, nothing to restart. Pay as usual — on success you see nothing at all (with zero records the floating orb is completely hidden). The moment a payment is declined, an orb appears in the lower-right corner (extension: toolbar icon). Click it to see why.

## Why this exists

My own overseas payment got stuck for two days. The page showed just "Your card was declined" — no code, no explanation. So I started guessing: low balance? Card doesn't allow international? Risk-flagged? 3DS failed? Every guess meant re-running the order, re-entering the card, and waiting out another timeout — and when you guess wrong, nothing tells you that you did.

Then I opened F12, found the 402 request in the Network tab, and the response body held this:

```json
{
  "error": {
    "code": "card_declined",
    "decline_code": "transaction_not_allowed",
    "advice_code": "do_not_try_again",
    "message": "Your card does not support this type of purchase.",
    "type": "card_error"
  },
  "outcome": { "network_decline_code": "57", "risk_level": "normal" }
}
```

`transaction_not_allowed` means this card doesn't support this type of purchase (subscriptions, cross-border, certain merchant categories) — nothing to do with your balance. And the `advice_code: "do_not_try_again"` next to it is even blunter: Stripe is literally saying stop trying — it'll be the same a hundred attempts from now, switch cards.

The answer I spent two days guessing was sitting in the response from the very first failure.

Under the same one-line "declined", completely different situations can hide:

| Code in the response | What's actually going on |
| --- | --- |
| `insufficient_funds` | Balance too low — switch cards or top up |
| `transaction_not_allowed` | Card doesn't allow this purchase type — retrying is useless |
| `do_not_honor` | The issuer declines without giving a reason — you have to call the bank |
| `lost_card` / `stolen_card` | Card marked lost or stolen — stop retrying; each attempt tightens the risk screws |
| `try_again_later` | Temporary glitch — wait a few minutes and retry exactly as before |
| `authentication_required` | 3DS verification needed — the popup was blocked or never showed |
| `card_velocity_exceeded` | Too many attempts in a short window — frequency-flagged; wait a while |

Seven situations with completely different correct responses, and two of them get worse the more you retry. On the page, they all look identical.

## What it looks like

A record reads like this:

```
transaction_not_allowed                       14:32:07  shop.example.com
   为什么   这张卡不支持这类消费（订阅 / 跨境 / 特定商户类别）
   怎么办   换一张卡。Stripe 官方建议：不要重试（do_not_try_again）
   金额     49.00 USD   ·   HTTP 402   ·   银行原始码 57   ·   风险 normal
```

(`为什么` = why, `怎么办` = what to do, `金额` = amount, `银行原始码` = raw bank code, `风险` = risk — the panel text is Chinese for now; see the note up top.)

The userscript version is a floating orb in the lower-right corner that only appears once there are records, with a badge counter. Click it for the panel:

![Userscript orb and panel](docs/screenshot-userscript.png)

The extension opens from the toolbar icon. It has one extra over the userscript: a yellow warning bar — if a site's hook got blocked by CSP, it lists the domain and tells you.

![Extension popup](docs/screenshot-popup.png)

> Both screenshots are rendered by `python make_screenshots.py` driving the real UI code (a headless browser fed fake data), not hand-drawn mockups. When the UI changes, rerun the script and they catch up. The domains, amounts and times in them are all made up.

## What it doesn't do

- It cannot turn a declined card into a working one. It explains; it doesn't cast spells.
- It doesn't change the payment outcome. The request goes out untouched, the response is `clone`d for its own reading, and the original is handed straight back to the page. Even if the parser throws, the whole thing sits inside a `try/catch` — payment unaffected.
- It never touches card numbers, CVV, or any input field. It reads HTTP responses, not the page DOM.
- It doesn't go online. Not a single request, not even an update check.

## Privacy

A few promises, each one verifiable against the code:

- **Only responses matching the single `PAY_URL` regex are ever read** — everything else doesn't even get `.clone()`d. That regex is one line in [pagehook.js](pagehook.js); it is this project's privacy boundary.
- Each record stores exactly 11 fields (time, domain, HTTP status, decline code, amount, and the like). The raw response body is never stored. v2.1 stored ~600 bytes that could carry your email, name, or billing address — v3 cut that entirely.
- The data stays in your own browser. It uses `storage.local`, not `storage.sync`; the userscript uses `GM_setValue`. Nothing syncs, nothing uploads. Capped at 200 records, and the clear button truly deletes.
- Chrome permissions: just `storage`. No `tabs`, no `webRequest`, no `host_permissions`.
- Grep the whole repo: no outbound fetch, no XHR, no sendBeacon, no tracking pixels.

The line-by-line long version is in [PRIVACY.md](PRIVACY.md).

## Which version should I pick?

Install the userscript. One-step install, auto-updates, survives browser restarts, and it stands up to CSP better (userscript managers inject at the browser layer, above the page's CSP). The extension is for people who'd rather not install a userscript framework, and for the future store listings.

Feature-wise the two are identical — same dictionary, same capture rule — and one self-check exists specifically to diff those two places verbatim, so they can't silently drift apart.

Installing both won't record anything twice. A flag on the DOM (`data-declinelens`) arbitrates: whoever runs first installs the hook, and the latecomer backs off on its own. You will see two UIs though, and storage is separate — the same declined payment only shows up on whichever side got the hook installed first. Keep one if you want it clean.

## Hit a decline code that's not in the dictionary?

Stripe keeps adding codes, and the dictionary's 55 entries are surely missing some. When you hit an uncovered one, the UI shows the raw code and offers a report entry point.

The easiest path: click "Copy report" and [open an issue](https://github.com/luck2026228/DeclineLens/issues/new?template=missing-code.yml) with it pasted in. The report is plain text with just those 11 diagnostic fields — nothing private — safe to paste directly.

Prefer doing it yourself? An entry in `dict.js` looks like this:

```js
insufficient_funds: {
  why: "卡里余额不够，或者超出了信用额度",
  fix: "换一张卡，或者给这张卡充钱之后重试",
},
```

(The `why`/`fix` strings are shown in the panel, so they're written in Chinese for now.)

After adding one, run `node test.js`, then `python build.py`. Never hand-edit `DeclineLens.user.js` — it's a generated file; the next build overwrites it. The style rules for `why` and `fix` are in [CONTRIBUTING.md](CONTRIBUTING.md) — this is the project's most welcome kind of contribution.

## Hacking on the code

```bash
node test.js        # 60 self-checks, zero dependencies, no browser needed
python build.py     # produces both extension zips and the userscript
```

Python 3 standard library only — pip installs nothing. If Node is present, `build.py` also runs `node --check` as a syntax pass.

How the code is organized, why it has to be two files, which knobs you can turn, which pits were stepped in — all of it is in [ARCHITECTURE.md](ARCHITECTURE.md). Give [CONTRIBUTING.md](CONTRIBUTING.md) a glance before opening a PR.

## Other docs

[Internals](ARCHITECTURE.md) ·
[Changelog](CHANGELOG.md) ·
[Privacy policy](PRIVACY.md) ·
[Security policy](SECURITY.md) ·
[Contributing](CONTRIBUTING.md) ·
[Roadmap](ROADMAP.md) ·
[Support](SUPPORT.md) ·
[Code of conduct](CODE_OF_CONDUCT.md)

## License

MIT. Take it, change it, sell it, embed it in your own product — just keep the copyright notice.

If you end up using the dictionary part (`dict.js`) in another project, I'd be genuinely glad to hear it. Those 55 entries and 12 message rules were collected one by one against Stripe's docs and real responses.

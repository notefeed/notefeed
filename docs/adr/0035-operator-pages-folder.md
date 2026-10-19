---
status: accepted
date: 2026-10-19
decision-makers: Marcel Bruckner
---

# The operator's pages from one folder, the plans from the provider's products

## Context and Problem Statement

Before notefeed.me sells licenses (issue #218), everything a visitor reads on an instance's own pages should come from its operator, not from notefeed. The imprint, the privacy page, the terms and the start-page notice already did: four Markdown files, each named by a setting of its own. The license page did not: its texts, tiles and feature lists were written in the app, its prices were two strings in the environment (`NOTEFEED_LICENSE_PRICE`, `_YEARLY`) kept equal to the Creem products by hand, and the yearly discount was parsed from those strings. The same prices were also in the stack's `terms.md`. Where should the license page's words and prices come from, and how do the operator's files reach notefeed?

## Considered Options

* Keep a setting per file, add `NOTEFEED_LICENSE_FILE`, and keep the price strings.
* One folder of the operator's files under fixed names; the license page's words from a file in it, each plan's name, description and price from the provider's product (chosen).
* Move the payment side (checkout, webhook, portal, plans and `/license`) out of the app into a service of its own.

## Decision Outcome

Chosen: one folder, `NOTEFEED_PAGES_DIR`, and the plans from the provider.

* **Five fixed names.** notefeed reads `imprint.md`, `privacy.md`, `terms.md`, `notice.md` and `license.md` from the folder and no other file: the folder is not a way to add pages. A missing file is no page and no link; each is read on every request, up to 256 KiB, as before.
* **`license.md`** is Markdown with YAML front matter: the free tile written out in full, and one badge, note, feature list and button label shared by every plan tile, since every license unlocks the same. The body is the intro above the tiles. `{cap}` in a feature is the configured free-tier cap, so the page cannot promise another number than the server keeps. The shape is checked strictly (an unknown key is an error); a message about a broken file names the field or the line, never the text. `included` defaults to true (false is the crossed-out style); `badge` and the notes are optional, and the yearly tile shows the computed "Save N %" in place of the badge. The public docs say nothing about selling (ADR 0029), so the shape is here:

  ```markdown
  ---
  free:
    title: Free
    price: "0"
    note: Every feed starts here.
    features:
      - { text: "The newest {cap} notes are kept" }
      - { text: No images, included: false }
      - { text: No feed password, included: false }
  plans:
    badge: Per feed
    note: For one feed at a time; the key can move.
    features:
      - { text: All notes are kept }
      - { text: Images }
      - { text: A feed password }
    button: Subscribe
  ---
  A license lifts the free tier's limits for one feed. Reading a feed is always free, and there are no accounts: the license is a key you keep.
  ```

* **Plans from the provider.** `PaymentProvider.plans()` returns what is sold, monthly then yearly. With Creem, each configured product (`NOTEFEED_CREEM_PRODUCT_ID`, `_YEARLY`) is read with `GET /v1/products`; its name, description (plain text, line breaks kept), price, currency and tax mode are the tile's. A product that is gone or not active is not offered and is logged, and the checkout refuses its period. The list is kept five minutes per process; while Creem cannot be read the last list is served, and with none the page shows the free tile and says licenses can't be bought right now. The yearly discount is computed from the two amounts.
* **The page and its links.** `/license` exists while a provider is set and `license.md` is usable, checked on each request. The footer's License link and the prompts to buy (the free-tier notice, the license section, "Protect this feed", the `402` banner) follow the same rule; the cap count, the key field and the explanation of a refusal stay, so a key holder can still use a key.
* **Startup.** With a provider set, a missing or broken `license.md` stops notefeed from starting. A folder that is none, or a page in it that cannot be shown, is a warning.
* **A support address.** `NOTEFEED_SUPPORT_EMAIL` puts a Support link (`mailto:`) in every footer, on any instance.
* **Breaking change, no fallback.** `NOTEFEED_IMPRINT_FILE`, `_PRIVACY_FILE`, `_TERMS_FILE`, `_NOTICE_FILE`, `NOTEFEED_LICENSE_PRICE` and `_YEARLY` are no longer read. If one is set, the startup log says so and what replaces it; an upgraded instance runs on without its pages until the files are moved.

The separate payment service was considered and deferred. The cut would be at `backend/licenseflow.ts`: the app keeps the keys, the license store and the free-tier checks, which have to sit on the paths that write notes, behind an authenticated "license events" endpoint; the service takes the checkout, the webhook, the portal, the plans and the sales page. For about 1,000 lines it would add a service to run, secure and back up, an internal API with retries, and a way for buying to break while the app is up. It becomes worth it with a second provider, licenses that cover several feeds, or a sales site apart from the app.

### Consequences

* Good, because notefeed.me's words are in its stack, not in the app, and a price or a product name changed in Creem shows within five minutes without a deploy.
* Good, because the price is written in one place besides the human-written terms, and the discount can no longer disagree with it.
* Good, because the folder is one mount, and a file that is not one of the five names cannot become a page.
* Bad, because self-hosters with imprint, privacy, terms or notice files must move them on upgrade; until they do, those pages are gone (with a warning).
* Bad, because the license page depends on Creem answering: after a restart during an outage nothing can be bought until it does.
* Bad, because `license.md` is one more file the operator must keep valid: a mistake stops the start (at startup) or takes the page and its links away (while running).

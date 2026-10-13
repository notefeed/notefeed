# Selling licenses

This page is for an operator who runs notefeed as a paid service, as notefeed.me does. Self-hosting needs none of it: with no payment provider set, every feature is open and nothing is limited. The design is [ADR 0029](../adr/0029-licenses-per-feed-on-the-saas.md).

## What is sold

A **license** lifts the free tier's limits for one feed: no cap on stored notes, a feed password, and images. Readers never pay, and there are no accounts: the buyer gets a key on the success page and enters it in the feed's settings. notefeed stores only the key's hash, so a lost key cannot be recovered; the provider's receipt is the record of the purchase.

| | Free | Licensed |
|---|---|---|
| Notes kept per feed | the newest `NOTEFEED_FREE_NOTE_CAP` (default `1000`); the oldest is dropped, a write is never refused | no cap |
| Images | no (`402`, `license_required`) | yes |
| Feed password | not at creation, not changed (`402`) | yes |

When a license lapses (cancelled and run out, unpaid, refunded) the feed returns to the free tier and nothing is deleted: stored images keep being served, an existing password keeps protecting the feed.

## Settings

| Setting | |
|---|---|
| `NOTEFEED_PAYMENT_PROVIDER` | `creem`, or `fake` for development. Unset: no licensing. |
| `NOTEFEED_CREEM_API_KEY` | The key; one starting `creem_test_` uses Creem's sandbox. |
| `NOTEFEED_CREEM_PRODUCT_ID` | The subscription product (`prod_…`). |
| `NOTEFEED_CREEM_WEBHOOK_SECRET` | The signing secret of the webhook. |
| `PUBLIC_URL` | Required: the success page is built from it. |
| `NOTEFEED_LICENSE_DB` | The SQLite file of the licenses, default `DATA_DIR/licenses.db`. Back it up with the rest. |
| `NOTEFEED_FREE_NOTE_CAP` | The free tier's note cap, default `1000`. |

The webhook URL to give the provider is `https://<your host>/api/licenses/webhook`.

## Setting up Creem

Everything in test mode costs nothing and needs no bank account.

1. Create a store at creem.io and turn on **Test Mode** (bottom of the sidebar).
2. **Developers:** copy the test API key and add a webhook to `…/api/licenses/webhook`; copy its signing secret.
3. **Products:** a recurring monthly product (the first price is 1.50 EUR a month; the price lives in Creem, not in notefeed). Copy its id.
4. Set the settings above, restart, open `/license`, buy with the test card `4111 1111 1111 1111` (any future date, any CVV), and copy the key from the success page.
5. Enter the key in a feed's settings: images and a feed password work now.

Creem's live mode needs its business review first. The reviewers open the site and compare it with what the form says, so before submitting have these on the live site:

- the **price and what is bought**: put it in a [start-page notice](legal-pages.md#a-notice-on-the-start-page) until `/license` is on;
- the **imprint, privacy page and terms** ([legal pages](legal-pages.md)), with the privacy page saying that the payment provider is the seller and holds the buyer's payment and contact data, and that notefeed stores only a hash of the key;
- how **reports and takedowns** are handled (the [report link](legal-pages.md#a-report-link-on-every-note) and [Removing a feed as the operator](deleting.md#removing-a-feed-as-the-operator)): anonymous image hosting is what a reviewer asks about first.

## Texts for the review form

Drafts to adapt, not legal advice.

**Product and platform details**

> notefeed is a web service for posting short notes to a named feed by script, API or web page and reading them back as RSS. There are no user accounts. Anyone can create a feed for free; a feed is identified by its name.
>
> The free tier keeps the newest 1000 notes per feed, with no images and no feed password. A paid license (EUR 1.50 per month, per feed) removes the note cap and unlocks images and a feed password for that one feed. Readers never pay.
>
> After payment the buyer is shown a license key on the success page and enters it in their feed's settings; nothing physical is shipped. The subscription renews monthly and can be cancelled through the provider's customer portal. When it lapses the feed returns to the free tier and no data is deleted.
>
> The software is open source and free to self-host; the license applies only to the hosted service. Every note has a report link, and reported feeds are removed and their images blocked by the operator.

**A start-page notice** (`NOTEFEED_NOTICE_FILE`) until `/license` is public:

```markdown
**Hosted notefeed.me.** Free: 1000 notes per feed, no images, no feed password.
A license (EUR 1.50 a month, per feed) removes the note cap and adds images and a
feed password for that feed. Readers never pay, and there are no accounts: after
payment you get a license key to enter in your feed's settings. Cancel any time
through the payment provider; a lapsed feed returns to the free tier and nothing
is deleted. Self-hosting is free with every feature.
```

**Terms and refund policy** (`NOTEFEED_TERMS_FILE`, at `/terms`), a start for a lawyer to check:

```markdown
# Terms

## The service
notefeed.me lets anyone post short notes to a feed and read them back. Using it
for free needs no account. A paid license for a feed removes the free tier's note
cap and allows images and a feed password for that feed.

## Paying
A license is a monthly subscription per feed, EUR 1.50 including VAT where it
applies. Payment, invoicing and VAT are handled by <provider and its legal name>,
the seller of record. You get a license key after payment; keep it, because we
store no information about you and cannot recover a lost key. Cancel any time in
the provider's customer portal; the license stays until the end of the paid
period, and then the feed returns to the free tier. Nothing is deleted.

## Refunds
Within 14 days of the first payment you can ask for a refund, without giving a
reason, by writing to support@notefeed.me or through the provider. A refunded
license ends at once.

## What you may not post
Illegal content. Notes and images can be reported from every note; the operator
removes a reported feed and blocks its images, and may do so without notice.

## No promise of availability
The service is run with care by one person, without a promise of availability.
Back up what you cannot lose.

## Contact
support@notefeed.me
```

Check the 14 days against your own situation: a right of withdrawal for digital services can be waived or end early in some cases, and a lawyer should say which applies to you.

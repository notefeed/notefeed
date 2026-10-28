# What notefeed stands for

notefeed is a place to post short notes to a named feed and read them back. This page says what it will stay, whoever runs it and whatever it grows into. Everything else follows from it: the features, the design decisions in [`docs/adr`](https://github.com/notefeed/notefeed/tree/main/docs/adr), and what notefeed.me sells.

It is written for you, if you are deciding whether to trust notefeed with your notes. It is also the yardstick for every change: a contribution, from a person or an AI, is judged against these points, and a review names the one it touches ("this breaks V3"). Each point says what it rules out, so that it can be used that way.

## Lines never crossed

These three come first. When a feature would be easier, or would sell better, by bending one of them, the feature changes or is not built.

### V1. No user accounts {#v1}

Access comes from knowing something: a feed's name lets you read and post, its password protects it, its read link lets others read. Nobody signs up, logs in or *is* someone at notefeed. There is nothing to sign up for and nothing to lose but the name.

**Rules out:** sign-up and login, profiles, "my feeds on every device" through a login, a password reset by e-mail, ownership of a feed by a person rather than by whoever knows its secrets.

ADRs: [0001](https://github.com/notefeed/notefeed/blob/main/docs/adr/0001-open-feeds-identified-by-name.md), [0008](https://github.com/notefeed/notefeed/blob/main/docs/adr/0008-per-feed-passwords.md).

### V2. No personal data we have to handle {#v2}

notefeed stores nothing about the people who post or read: no names, no e-mail addresses, no client addresses in its logs. A client's address is used only in memory, to limit how fast it may post or guess passwords, and is never written down. Where personal data can't be avoided, it stays with someone else: on notefeed.me the payment and the buyer's details are with Creem, the merchant of record, and notefeed keeps only the hash of the license key.

A self-hoster may turn on sign-in with a verified sender ([V8](#v8)). Then the sender's name is stored on the notes they post, and that instance's operator is responsible for it; nothing else needs it.

**Rules out:** asking for an e-mail address "just for recovery" or a newsletter, storing a buyer's name or address in notefeed, logging client addresses, analytics or third-party scripts that collect personal data.

ADRs: [0014](https://github.com/notefeed/notefeed/blob/main/docs/adr/0014-private-by-default-identity-optional.md), [0025](https://github.com/notefeed/notefeed/blob/main/docs/adr/0025-request-log-from-the-http-server.md), [0029](https://github.com/notefeed/notefeed/blob/main/docs/adr/0029-licenses-per-feed-on-the-saas.md), [0036](https://github.com/notefeed/notefeed/blob/main/docs/adr/0036-license-keys-from-the-provider.md).

### V3. Publishing, not interacting {#v3}

A feed goes one way: from its sender to many readers. Readers stay invisible. Whoever posts doesn't learn who reads, how many read, or when; reading a feed writes nothing and tracks nothing.

**Rules out:** reader counts, view statistics, "seen by", read receipts, followers lists, tracking pixels in RSS, a public directory or search of feeds, likes or comments that reveal who a reader is.

ADRs: [0039](https://github.com/notefeed/notefeed/blob/main/docs/adr/0039-usage-metrics-for-the-operator.md) (what the operator may count, and that reading is not counted).

## Principles that follow

### V4. Every text has exactly one sender and lives in their feed {#v4}

Whatever notefeed hosts belongs to a feed, and whoever can post to that feed is responsible for it. There is no text that belongs to nobody's feed. If feeds ever answer each other, an answer is a note in the answering feed that points to the other one, not a comment stored on someone else's feed.

**Rules out:** anonymous comments stored under someone else's note, guestbooks, shared walls, text with no feed behind it.

ADRs: [0026](https://github.com/notefeed/notefeed/blob/main/docs/adr/0026-report-link-on-every-note.md), [0027](https://github.com/notefeed/notefeed/blob/main/docs/adr/0027-takedown-tombstone-and-blocklist.md) (a note is reported and taken down in the feed it belongs to).

### V5. Nobody has to moderate, but everyone can remove {#v5}

A feed works without anyone watching over it: nothing waits for approval. Whatever appears on a feed's page, its sender can take off that page. Content that breaks the law is reported through the report link of the feed it belongs to.

**Rules out:** features that only work if a feed's sender approves things in time, a queue of pending items, and anything shown on a feed that its sender cannot remove from it.

ADRs: [0026](https://github.com/notefeed/notefeed/blob/main/docs/adr/0026-report-link-on-every-note.md), [0027](https://github.com/notefeed/notefeed/blob/main/docs/adr/0027-takedown-tombstone-and-blocklist.md).

### V6. The feed name is the secret {#v6}

Knowing a feed's name lets you post to it, so it is never shown where it doesn't have to be. Reading goes through the read id, which can be changed; wherever feeds or notes refer to each other, they use the read id.

**Rules out:** feed names in links meant for others, in RSS, in another feed's page, in logs or metrics; a reference between feeds by name.

ADRs: [0001](https://github.com/notefeed/notefeed/blob/main/docs/adr/0001-open-feeds-identified-by-name.md), [0016](https://github.com/notefeed/notefeed/blob/main/docs/adr/0016-name-fixed-read-id-changeable.md).

### V7. API first, AI-native {#v7}

Everything the web UI can do, a script and an AI assistant can do too: through the REST API, both client packages and the MCP server, and MCP matters most. A feature only the UI has is not finished.

**Rules out:** UI-only features, a form route that the API lacks, an MCP tool that lags behind the API.

ADRs: [0003](https://github.com/notefeed/notefeed/blob/main/docs/adr/0003-backend-boundary.md), [0005](https://github.com/notefeed/notefeed/blob/main/docs/adr/0005-one-write-path.md), [0006](https://github.com/notefeed/notefeed/blob/main/docs/adr/0006-generated-openapi-spec.md), [0007](https://github.com/notefeed/notefeed/blob/main/docs/adr/0007-mcp-endpoint-and-oauth.md).

### V8. Private by default {#v8}

With nothing turned on, notefeed knows no one. A self-hoster can turn on sign-in, which adds a verified sender to the notes posted that way; it only adds, and no feature may need it.

**Rules out:** a feature that works only with sign-in on, sign-in on notefeed.me as the way to use it, people records or profiles behind sign-in.

ADRs: [0014](https://github.com/notefeed/notefeed/blob/main/docs/adr/0014-private-by-default-identity-optional.md).

### V9. Encrypted at rest {#v9}

On notefeed.me, notes, pictures and feed details are encrypted inside notefeed with a key per feed before they reach the database, and the main key is kept apart from the data. A stolen disk or backup gives away nothing readable, and the hosts only ever see ciphertext. A self-hoster on SQLite or PostgreSQL can turn the same on; on the file system, whose files are meant to be read by hand, disk encryption does that job.

**Rules out:** storing feed content, names or license references unencrypted beside the encrypted copy, a backup that bypasses the encryption, reading content where counts are enough.

ADRs: [0033](https://github.com/notefeed/notefeed/blob/main/docs/adr/0033-envelope-encryption-at-rest.md), [0034](https://github.com/notefeed/notefeed/blob/main/docs/adr/0034-main-key-in-openbao.md).

### V10. A license is the proof for exactly one feed {#v10}

A license lifts the limits for one feed. Its key proves exactly that and nothing more, so it can be entered by a script or an assistant without putting other feeds at risk. Licenses don't tie feeds together.

**Rules out:** one key for several feeds, a key that opens anything for another feed, a license tied to a person.

ADRs: [0029](https://github.com/notefeed/notefeed/blob/main/docs/adr/0029-licenses-per-feed-on-the-saas.md), [0037](https://github.com/notefeed/notefeed/blob/main/docs/adr/0037-feed-password-recovery-by-license-key.md), [0043](https://github.com/notefeed/notefeed/blob/main/docs/adr/0043-a-license-without-a-feed-password.md).

### V11. Self-hosting has everything {#v11}

On your own server, every feature is on and there is no free tier. notefeed.me sells running it for you, not features. The code is AGPL-3.0: anyone may run it, and a changed version run as a service stays open.

**Rules out:** features only notefeed.me has, a license check on a self-hosted instance, a closed hosted fork.

ADRs: [0029](https://github.com/notefeed/notefeed/blob/main/docs/adr/0029-licenses-per-feed-on-the-saas.md).

### V12. Your notes stay yours {#v12}

You can take your notes along at any time, as they were posted. By default each note is a plain file, exactly as posted, with its details in a small file beside it; on SQLite or PostgreSQL they are rows that come out the same way.

**Rules out:** a storage format only notefeed can read, changing what was posted, an export that loses notes or pictures, keeping notes after their feed is deleted.

ADRs: [0018](https://github.com/notefeed/notefeed/blob/main/docs/adr/0018-notes-are-files-with-sidecar-metadata.md), [0019](https://github.com/notefeed/notefeed/blob/main/docs/adr/0019-a-note-is-a-file-one-api.md), [0023](https://github.com/notefeed/notefeed/blob/main/docs/adr/0023-storage-interface-and-database-backends.md), [0040](https://github.com/notefeed/notefeed/blob/main/docs/adr/0040-a-note-shows-its-text-as-written.md).

### V13. Paid by licenses, never by ads or data {#v13}

notefeed.me pays for itself through licenses that whoever posts to a feed buys. Readers never pay. The free tier is limited by how much a feed holds, not by watching anyone.

**Rules out:** ads, selling or sharing data, a free plan paid for by tracking, charging readers.

ADRs: [0029](https://github.com/notefeed/notefeed/blob/main/docs/adr/0029-licenses-per-feed-on-the-saas.md), [0035](https://github.com/notefeed/notefeed/blob/main/docs/adr/0035-license-page-from-the-operator-and-the-provider.md).

## Changing this page

The points keep their numbers, so that reviews and issues citing them stay right. A change to this page needs the maintainer's approval and says why in its pull request; a change that weakens one of V1 to V3 is a change to what notefeed is.

---
status: accepted
date: 2026-10-27
decision-makers: Marcel Bruckner
---

# A service worker takes pictures shared to the app

## Context and Problem Statement

The installed app is in Android's share sheet for text and links (#185): the share target is a GET to the start page, which asks for the feed. Pictures can't travel in a GET; a share target takes files only as a `multipart/form-data` POST, and that POST happens before anyone has picked a feed (#148). Something has to hold the pictures until the feed is picked and the note is posted. iOS has no share target for web apps at all; there an iPhone Shortcut posts to the API, which needs no change.

## Considered Options

* **A service worker keeps the pictures in the browser** (chosen).
* The server holds the pictures for a few minutes under a random id until the compose box fetches them.
* The server answers the POST with the picker page and the pictures embedded in it.

## Decision Outcome

Chosen: a service worker, `public/sw.js`, registered on every page by `components/ServiceWorker.tsx`. The share target POSTs to `/api/share`; the worker answers only that request: it keeps the pictures (PNG, JPEG, GIF, WebP) in the Cache API (`notefeed-share`), replacing an earlier share, and redirects to the start page with the text as `share_title`/`share_text`/`share_url` and `shared=1`. The picked feed's compose box takes them (`app/_lib/sharedFiles.ts`) like photos from the camera button. The share query survives a feed password and the sign-in (`shared/share.ts`).

* **Nothing reaches the server before Post**, so the feed password, the license, the attachment limit, shrinking and "images off" stay where they are: in the compose box and the posting route.
* **The worker's job stays this one.** No page caching, no offline mode, no `respondWith` for anything but `POST /api/share`. A wish for offline support is a new decision, not an extension of this file.
* **`/api/share` has no server route.** Without the worker (an install never opened since, cleared site data) the share answers 404. It sits under `/api/` because `proxy.ts` rewrites every one-segment POST to a post in that feed: `/share` would publish the pictures in a feed called "share".
* `/sw.js` is served with `Cache-Control: no-cache` and is exempt from the instance lock, so a fix reaches every browser on its next page load.

### Consequences

* Good, because pictures are shared on Android the way text is, with no new data on the server and no API change.
* Good, because the other options' costs are avoided: unposted pictures on the server to expire, size, protect and take down, or every picture travelling twice.
* Bad, because it is notefeed's first service worker: one more moving part in the browser, tested by `e2e/share.spec.ts` in Chromium.
* Bad, and accepted: the share fails with 404 until the app has been opened once.

## How to remove it

Replace `public/sw.js` with a worker that deletes the `notefeed-share` cache and calls `self.registration.unregister()`; set the manifest's `share_target` back to the GET of #185; remove `components/ServiceWorker.tsx` from the root layout and the `shared` handling in the compose box. After a release or two, when browsers have picked up the unregistering worker, delete `public/sw.js`.

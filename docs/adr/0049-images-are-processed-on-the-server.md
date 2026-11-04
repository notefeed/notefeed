---
status: accepted
date: 2026-10-27
decision-makers: Marcel Bruckner
---

# Images are shrunk, re-encoded and stripped on the server

## Context and Problem Statement

ADR 0011 (h) stored every image byte for byte: no resizing, no re-encoding, no metadata removed, because that needs an image library that parses untrusted files. Only the web pages shrank a picture before uploading it (`app/_lib/shrinkImage.ts`, over `NOTEFEED_SHRINK_IMAGE_BYTES`). So curl, the CLIs, both client packages, MCP and the iPhone Shortcut (#148) sent full-size photos, ran into the 5 MiB limit (`413`), and kept their EXIF data, GPS position included; under 1 MiB even the web pages kept it. The files are public to anyone with the read link. notefeed is API first and AI-native: what happens to an image has to happen for every client, MCP first. (Issue #312; amends ADR 0011 (e), (h) and (i).)

## Decision Drivers

* One algorithm for every client, so none has to shrink or strip on its own.
* The safe behaviour is the only one: no setting that keeps EXIF.
* A decoder bug in a crafted upload must not run in the server's process (libwebp's CVE-2023-4863 was exploited through a WebP file alone).
* Bounded cost: a burst of uploads must not saturate a small server.

## Considered Options

* **sharp with native libvips, in the server process.**
* **sharp's WebAssembly build (`@img/sharp-wasm32`), in the server process.**
* **Native sharp in a child process**, killed on a crash or a hang.
* Another language (Python with Pillow, C++): they wrap the same C decoders in process; only a pure-Rust decoder would remove the class of bug, and that is a rewrite.

Measured on the development machine, a 48 MP, 10 MB JPEG scaled to 2560 px at quality 85, one at a time: native ~175 ms with a process RSS that grew to ~340 MB over three runs; WebAssembly ~370 ms (530 ms the first time, while the module compiles) with a flat ~225 MB; identical output. Native adds ~18 MB to the image per architecture, WebAssembly ~9 MB for both.

## Decision Outcome

Chosen: **sharp's WebAssembly build, in process**, because at notefeed's volumes (a handful of images a minute) its extra fifth of a second per image costs nothing that matters, and in return a decoder bug stays inside WebAssembly's linear memory. A child process gives crash isolation too, but costs a process per image or a pool to manage. Native sharp stays a small change away if the WebAssembly build, which sharp still calls experimental, misbehaves.

Every image that is stored, whichever way it came in (a posted image, a replaced one, attachments over multipart or MCP, the feed's own title image), passes `processImage` (`backend/imageprocess.ts`) after the cheap checks and before anything is stored:

* **Decoded** with only the JPEG, PNG, GIF and WebP loaders allowed (`sharp.block`), at most **100 megapixels** (every frame of an animation counted), animated GIF and WebP with all their frames. A body that does not decode as the format its first bytes and `Content-Type` say is `415`; this also refuses a file that only carries an image header (the polyglot in ADR 0011 (e)). The defensive response headers stay.
* **Turned** the way its EXIF orientation says, so a phone photo stays upright once the EXIF is gone.
* **Scaled** to fit 2560 × 2560, never enlarged. Fixed, with no setting: a byte target like the browser's would need several encodes per image, and one pass at 2560 px already gives 0.5–1 MB for a 48 MP photo.
* **Encoded again in its own format:** JPEG and WebP at quality 85, PNG lossless (a palette PNG keeps a palette), GIF as GIF; animations keep their frames, delays and loop. The colour profile is converted to sRGB.
* **No metadata** is written: no EXIF, GPS, XMP, IPTC or comments.

The same input gives the same bytes, so the takedown blocklist keeps working: an image is refused when the hash of the bytes as sent or as stored is on it, so an entry made from an original before this change and one made from a stored file both hold.

**Load.** At most two images are processed at a time and eight wait; the next request is refused with `503` and code `busy`, with `Retry-After: 5`. An image that takes longer than 10 seconds is refused with `413`. The caps, the rate limit and every other check come first, so a refused request costs no processing; a post's pictures are processed one after another, so one post never fills the queue alone.

**Limits.** `NOTEFEED_MAX_IMAGE_BYTES` is the size of an image as sent; its default rises from 5 MiB to its clamp, 10 MiB, so a photo straight from a phone fits from any client. A photo over 10 MiB or 100 MP (a phone's 108 or 200 MP mode) is refused from every client, the web pages included: a browser fallback for it would be a second algorithm. Next's proxy buffered a request body only up to 10 MB, which several full-size photos in one post, or one as base64 over MCP, exceed; it now buffers up to 64 MiB (`MAX_REQUEST_BYTES`, `experimental.proxyClientMaxBodySize`), and the MCP route takes the same.

**The browser** sends a picture as it is: `shrinkImage.ts` and `NOTEFEED_SHRINK_IMAGE_BYTES` are gone, and the startup log warns when the variable is still set.

**Build.** `sharp` and `@img/sharp-wasm32` are direct dependencies; `sharp` is a server external package; the standalone build leaves out the native `@img/sharp-*` and `@img/sharp-libvips-*` packages (`outputFileTracingExcludes`; the proxy's trace ignores those, so the Dockerfile deletes what it brings), so only the WebAssembly one is in the image, and CI's image smoke test posts a picture. Where node_modules holds the native ones too (development, tests), `backend/imageprocess.ts` refuses to load them, so every run uses the build production uses; a test checks it.

Out of scope: HEIC/HEIF (a follow-up: sharp's builds have no HEVC decoder, and its patents), reprocessing images stored before, thumbnails or several sizes, converting formats.

### Consequences

* Good, because every client, MCP first, can send a photo as it is and gets the same result: upright, at most 2560 px, without the place it was taken.
* Good, because a file that only pretends to be an image is refused instead of stored.
* Good, because a decoder bug in an upload stays in WebAssembly's memory.
* Bad, because the stored bytes are not the sent ones: a small JPEG loses a little to its second encoding and may even grow, and a lossless WebP becomes lossy.
* Bad, because each image costs about 0.2–0.5 s of CPU and up to a few hundred MB of memory while it is processed, and a burst beyond ten images is refused with `503 busy`.
* Bad, because the proxy now buffers up to 64 MiB per request in memory.
* Bad, because a photo over 10 MiB, which the web pages used to shrink, is now refused there too.
* Bad, because images stored before keep their metadata.

### Confirmation

`backend/imageprocess.test.ts` checks that the WebAssembly build runs, and with real images: a phone photo with EXIF orientation and GPS comes out upright, 2560 px and without EXIF, XMP, IPTC or a profile; a small image keeps its size; a PNG keeps its transparency; an animated GIF and WebP keep frames, delays and loop; the same input gives the same bytes; a polyglot, a TIFF under a PNG's name and bytes of another format are `415`; a header declaring 400 MP is `413`; two run and eight wait, the eleventh is `busy`. `backend/takedown.test.ts` checks both hashes; the HTTP tests check that a posted and a replaced image is stored as `processImage` makes it; the MCP tests post a 5–10 MB photo as base64 and find it stored at 2560 px; `e2e/images.spec.ts` posts a camera-sized photo from the compose box and the settings page and finds it stored at 2560 px; the startup test checks the warning for the removed variable.

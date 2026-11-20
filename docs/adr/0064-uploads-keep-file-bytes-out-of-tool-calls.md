---
status: accepted
date: 2026-11-19
decision-makers: Marcel Bruckner
---

# Uploads keep a file's bytes out of MCP tool calls

## Context and Problem Statement

`post_file`, `post_note`'s attachments and `set_feed_image` took a file only as base64 in `data`. A tool call is JSON that the model writes, so every byte of a picture costs output tokens. A 670 KB phone screenshot is about 900,000 characters, which no assistant can write. In practice pictures were shrunk to a few KB first, although the tools ask for them full size (ADR 0049). Splitting the base64 into chunks does not help: the model still writes every character. How can an assistant post a full-size picture? Issue #381.

## Considered Options

* **Uploads to a short-lived URL** (chosen): a tool makes a URL, a shell sends the bytes to it with curl, and the post names the upload's id.
* **`source_url`**: the server fetches a public file itself. This needs protection against server-side request forgery (private ranges, DNS rebinding, redirects), which is its own security surface. It also only helps with files that are already public. It was left for a later issue, and came with ADR 0066.
* **Chunked base64**: it doesn't reduce what the model writes.

## Decision Outcome

Chosen: uploads, MCP first (V11).

* **`create_upload`** (`feed`, `type`, optional `size` and `password`) is admitted like a post. It needs the feed's access, the type must be one notefeed accepts, a picture is refused at once where image uploads are off or, where licenses are sold, the feed has no license for it, a new feed past `NOTEFEED_MAX_FEEDS` is refused, and it counts against the rate limit. It answers with an `upload_id`, an `upload_url`, `expires_at` and `max_bytes`, and its `guidance` gives the curl line.
* **The URL** is `/api/v1/uploads/{token}`, where the token is 32 random bytes. It carries no feed name, password or license key (V10). The token is its only credential, so the instance password does not apply to it. It takes one `PUT` of the raw bytes. `Content-Type` is not read: the type is fixed when the upload is made, and the bytes must match it by their signature (415 otherwise). The size limit is a picture's limit (`NOTEFEED_MAX_IMAGE_BYTES`) or markdown's 100 KB. A refused file may be sent again; a second file after one was taken is refused.
* **Posting**: `post_file`, `post_note`'s attachments and `set_feed_image` take `upload_id` instead of `data`, with `type` optional. An upload belongs to the feed it was made for: under any other feed's name it does not exist. The post runs every check a post with `data` runs (ADR 0049's processing included) and deletes the upload when it succeeds. A refused post leaves the upload for another try until it expires. Two posts can't use the same upload at once.
* **Where the files wait**: a folder in the data directory, `.uploads/`, with the list of uploads in memory. They expire 15 minutes after the upload was made. A restart forgets them, and the first upload afterwards clears the folder. Its name starts with a dot because the file system storage keeps each feed in a folder of the data directory, and a feed's name can't start with one: a folder called `uploads` could be a feed's. The storage interface is not involved: a file that may wait a quarter of an hour needs no database or image store, and no backend has to learn a new kind of record. notefeed runs as one process, so memory is enough. More than one process would need the list in the storage.
* **Bounds**: at most 10 uploads (a post's attachments) wait for one feed, and 10 for one sender. The sender is the account the client signed in as, else the feed's password (counted by the feed's own cap), else the address: many people can share one address (claude.ai's connectors call from Anthropic's servers, and an instance without `NOTEFEED_TRUST_PROXY` sees one address for everyone), so the address counts only for those without either. Only a hash of it is kept, in memory with the upload, and gone with it. At most 32 files wait on disk, checked when a file is sent, so uploads without a file take no place there: one sender can't block everyone's uploads by making uploads it never sends. That is at most 320 MiB on disk at the default image limit. The list in memory holds at most 1,000 uploads. An upload whose PUT is still reading when it expires is dropped too, so a body that never ends keeps no place.
* **A post that succeeded** uses its uploads up even if a file can't be deleted (logged; the next restart clears the folder), so the call never reports a stored note as failed.
* **REST** has the `PUT` and nothing else. A REST post takes the file in its own body (raw or multipart), so a script never needs an upload. Making and using uploads is left out of REST and the client packages on purpose; the generated clients still get `putUpload`.

### Consequences

* Good, because an assistant that can run a shell (Claude Code, a sandbox that reaches the instance) posts full-size pictures with one tool call, one curl and one post. The model writes only an id.
* Good, because the URL gives nothing away: no feed name, and nothing it could do outside this one upload.
* Bad, because an assistant without a shell still has only base64.
* Bad, because up to 320 MiB can wait on disk, and a restart loses what is waiting.
* Bad, because the token is a bearer secret in a URL for 15 minutes. It can end up in a shell's history or a proxy's log, where anyone who has it can send that one file. It still can't read or post anything.

### Confirmation

`backend/uploads.test.ts` covers one file per upload, expiry (also during a PUT), the size and signature checks, the caps per feed, per sender (account, password, address) and on disk, a feed called `uploads` left alone, a post whose file can't be deleted, a refused post keeping its upload, two posts at once, and the folder cleared after a restart. It also checks that the `PUT` needs no instance password. `backend/mcp.test.ts` posts a 5 MB photo by `upload_id` and finds it stored at 2560 px. It also mixes uploads and base64 in `post_note`, sets a title image from an upload, and covers the refusals: both or neither of `data` and `upload_id`, a different type, another feed's upload, an upload without its file, and a new feed past the feed cap. `backend/licensing.test.ts` checks that an upload for a picture is refused where the picture's post would need a license. Base64 in `data` may use the URL-safe alphabet, as `post_file` and `set_feed_image` always allowed.

## More Information

Values: V11 (MCP first: the feature exists for assistants); V10 (no feed name in the URL); V2 (nothing about the sender is stored; the files are deleted when posted or expired).

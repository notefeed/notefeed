# Client libraries

For Python and Node there are client packages, both called `notefeed`. They post, edit and delete notes, read a feed back page by page, and each comes with the [`notefeed` command](cli.md). Both are generated from the server's [OpenAPI description](api.md) and wrapped in a small hand-written `Client`; any other language can generate its own client from `/api/v1/openapi.json`.

## Install

=== "Python"

    ```sh
    pip install notefeed        # Python 3.11 or newer
    ```

=== "Node"

    ```sh
    npm install notefeed        # Node 20 or newer; no dependencies
    ```

## From code

Create the client with the server's URL and, usually, a default feed; every call can name another. Pass `password` only if the instance has one, and `feed_password` / `feedPassword` for a [protected feed](../using/feed-passwords.md). `Client.from_env()` / `Client.fromEnv()` reads `NOTEFEED_URL`, `NOTEFEED_FEED`, `NOTEFEED_PASSWORD` and `NOTEFEED_FEED_PASSWORD` instead. Keep the password and the feed name out of source code.

=== "Python"

    ```python
    import os
    from notefeed import Client, NotefeedError

    client = Client("https://notes.example.com", feed="homelab-7f3k2q9x4m8wz",
                    password=os.environ.get("MY_NOTEFEED_PASSWORD"))
    try:
        created = client.post("# Deploy done\nimmich v3.2.4 on host-2", tags=["ci", "deploy"])
        print(created.id, created.url, created.read_url)

        for note in client.notes():  # newest first, fetched a page at a time
            print(note.date, note.title)
    except NotefeedError as e:
        print("notefeed failed:", e, e.status, e.code)
    ```

=== "Node"

    ```js
    import { Client, NotefeedError } from "notefeed";

    const client = new Client({ url: "https://notes.example.com", feed: "homelab-7f3k2q9x4m8wz",
                                password: process.env.MY_NOTEFEED_PASSWORD });
    try {
      const created = await client.post("# Deploy done\nimmich v3.2.4 on host-2", { tags: ["ci", "deploy"] });
      console.log(created.id, created.url, created.read_url);

      for await (const note of client.notes()) { // newest first, fetched a page at a time
        console.log(note.date, note.title);
      }
    } catch (e) {
      if (e instanceof NotefeedError) console.error("notefeed failed:", e.message, e.status, e.code);
      else throw e;
    }
    ```

| Python | Node | Does |
|---|---|---|
| `post(content, feed=, type=, title=, tags=, alt=, name=, date=, read_id=, attachments=, license_key=)` | `post(content, { feed, type, title, tags, alt, name, date, readId, attachments, licenseKey })` | Posts a note, dated now unless `date` is given (a [date](../using/posting.md#a-notes-date), also in the future). A string is markdown; bytes are a file of media type `type`. `attachments` posts [pictures with the note](../using/pictures.md#posting-a-note-with-its-pictures) in one request, `Attachment(name, content, type, alt)` in Python, `{ name, content, type, alt }` in Node; `content` may be empty to post only pictures. Returns `id`, `url`, `read_url`, `file`, `file_url` and, with attachments, `attachments`. `license_key` is the [license](../hosted/licenses.md#entering-the-key) key for notefeed.me, for the feed this post creates (open or protected). |
| `notes(feed=, page_size=, tag=)` | `notes({ feed, pageSize, tag })` | Every note in the feed, newest first; the next page is fetched as you iterate. |
| `note(id, feed=)` | `note(id, { feed })` | One note. |
| `edit(id, content, feed=, type=)` | `edit(id, content, { feed, type })` | Replaces a note's content; id, URLs and metadata stay. |
| `update(id, title=, alt=, date=, feed=)` | `update(id, { title, alt, date }, { feed })` | Sets a note's title, a picture's alt text or a note's date; `""` removes a title or alt text. |
| `delete(id, feed=)` | `delete(id, { feed })` | Deletes a note for good. |
| `feed_info(feed=)` | `feedInfo({ feed })` | The feed's `name`, `title`, `description`, `image_url`, `protected` and `read_url`. |
| `update_feed(title, description, feed=, image=, read_id=)` | `updateFeed({ title, description, image, read_id }, { feed })` | Replaces the feed's title and description; `image` is the `file` of a picture for the title image. |
| `set_feed_password(password, feed=)` | `setFeedPassword(password, { feed })` | Changes a protected feed's password (the current one is the client's feed password), or [gives an open feed one](../using/feed-passwords.md#a-password-for-an-open-feed). |
| `delete_feed(feed=)` | `deleteFeed({ feed })` | Deletes the feed with everything in it, for good. |
| `attach_license(key, feed=)`, `detach_license(feed=)` | `attachLicense(key, { feed })`, `detachLicense({ feed })` | On notefeed.me: puts the [license](../hosted/licenses.md#entering-the-key) the key names on the feed (moving it from the feed it was on; no feed password needed), or takes it off. Returns the feed. |
| `read_notes(read_id, page_size=)`, `read_note(read_id, id)` | `readNotes(readId, { pageSize })`, `readNote(readId, id)` | Like `notes()` and `note()`, by the feed's [read id](../using/read-links.md): public, no password, never the name. |

A note has `id`, `type`, `title`, `content` (absent for a picture), `file`, `file_url`, `size`, `tags`, `date`, `scheduled` (only for the owner, when the date is in the future) and `url`, and optionally `alt`, `name` and `sender`. Timeouts default to 10 seconds. Feed names are checked on the client, so a typo fails with a `ConfigError` before any request.

## Errors

Every error is a `NotefeedError` with `status` and `code` (both empty for network and configuration problems). The type follows the code:

| Type | When |
|---|---|
| `ConfigError` | Empty URL, no feed, an invalid feed name, no content and no attachments: checked before any request. |
| `InvalidRequestError` | The server refused the request itself (`invalid_feed`, `reserved_feed`, `empty_note`, `invalid_body`, `unsupported_type`, `blocked`). |
| `AuthError` | The instance or the feed has a password and it's missing or wrong. |
| `NotFoundError` | No such note or feed, or a feed the operator `removed`. |
| `NoteTooLargeError` | A note over 100 KB, or a picture over the size limit. |
| `RateLimitedError` | Too many posts or wrong passwords; `retry_after` / `retryAfter` is the wait in seconds. |
| `LimitReachedError` | The instance's feed cap, or the feed's note or image cap, is reached. |
| `ImagesOffError` | The instance takes no pictures. |

The message is the server's own reason; every status and code is in the [REST API](api.md).

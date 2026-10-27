# Pictures

A picture is a note of its own. Post it with its `Content-Type`, and it is listed in the feed, shown in the read-only view and sent to RSS readers as an enclosure:

```sh
curl -H "Content-Type: image/png" --data-binary @photo.png https://notes.example.com/homelab-7f3k2q9x4m8wz
```

The answer is that of any [post](posting.md), with the picture's `file` and `file_url`. A markdown note shows it with `![](<file>)`. `X-Note-Alt` sets the alternative text, `X-Note-Name` keeps the original file name (and serves the newest picture with it at `/r/<read id>/<name>`, see [Files by name](read-links.md#files-by-name)), and `X-Note-Title` and `X-Note-Tags` work as for markdown. In the browser, the compose box and the note editor take pictures with the [Add image](web-ui.md#adding-an-image) button, by paste or by drop. From another app on a phone, share them to notefeed: see [Sharing from a phone](sharing.md).

!!! note "On notefeed.me"
    Pictures need a license: on the free tier every picture is refused with `402` (`license_required`), on its own or with a note. See [Free tier and licenses](../hosted/licenses.md).

What to know:

- **Types:** PNG, JPEG, GIF and WebP. The bytes must be that format, whatever the header says; SVG is refused because it can carry script.
- **Size:** at most 5 MiB by default (`NOTEFEED_MAX_IMAGE_BYTES`). The web pages shrink a picture to 1 MiB before uploading it, so a phone photo fits; the API takes what it is sent.
- **Stored as sent:** no resizing, no re-encoding, and no metadata removed. A photo's EXIF data, which can include where it was taken, stays in the file. Remove it first if that matters.
- **As public as the read link.** A picture is served at `/r/<read id>/<file>` with no password, even on a locked instance or a protected feed, so that feed readers can show it. Don't post anything you would not give to everyone who has the read link.
- **`![](file)` follows the read id**, so it keeps working if the read id changes; a full URL is shown as written.
- **Edit and delete** like any note: `DELETE` removes the file, `PUT` replaces the bytes with another picture of the same type, `PATCH` changes title or alt text.
- **Errors:** those of posting, plus `507` when the feed has `NOTEFEED_MAX_IMAGES_PER_FEED` pictures and `403` (`images_off`) when the instance takes [no pictures at all](../self-hosting/limits.md#no-pictures-at-all).

## Posting a note with its pictures

A note with its pictures is one `multipart/form-data` request to `POST /<feed>`: a `text` part, up to 10 `file` parts named as the text refers to them, and optional `alt.<file name>` fields. The [clients](../integrations/clients.md), `notefeed post --attach`, the [web UI](web-ui.md#adding-an-image) and the [MCP](../integrations/mcp.md) tool all send it:

```sh
curl -F "text=@note.md;type=text/markdown" -F "file=@chart.png;type=image/png" \
  -F "alt.chart.png=Disk use over a week" https://notes.example.com/homelab-7f3k2q9x4m8wz
```

The pictures are stored first, each as a note of its own; then the text, with `![](chart.png)` swapped for the stored file; a picture the text never mentions is appended as `![](file)`. Pictures may share a file name (a phone calls every photo `image.jpg`): each is stored and appended, but a text that refers to a name given twice is refused. It is all or nothing: if anything is refused, nothing of the request is stored. The answer is that of the text note plus `attachments`, the pictures in order. The parts, the file-name rules and every error are in the [REST API](../integrations/api.md).

The feed, the read-only view and RSS show such a picture once, inside the note that shows it, not again as a note of its own. Clicking it in the feed opens that note, and clicking it on the note's page opens the picture's own page. A picture is only left out of a list that also holds the note showing it, so a tag filter that lists the picture alone still shows it. The API lists every note.

# Imprint, privacy page and terms

notefeed ships no imprint, privacy page or terms: who runs an instance, and what it does with data, is different for each one. A public instance in the EU needs them. Write them as Markdown files and point notefeed at them:

```yaml
services:
  notefeed:
    environment:
      NOTEFEED_IMPRINT_FILE: /legal/imprint.md    # /imprint, "Imprint" in the footer
      NOTEFEED_PRIVACY_FILE: /legal/privacy.md    # /privacy, "Data privacy"
      NOTEFEED_TERMS_FILE: /legal/terms.md        # /terms, "Terms"
    volumes:
      - ./legal:/legal:ro
```

- Each is optional; without a file the page is `404` and nothing links to it.
- All three are public, also on a locked instance.
- The file is read on every request, so a change shows at once. Keep the files in version control: for a privacy page it matters what it said on which day.

## A notice on the start page

`NOTEFEED_NOTICE_FILE` names a Markdown file shown as a red warning banner on the start page: that the service is still being built, that a maintenance window is coming, or what you do not promise. Only the start page shows it; remove the setting to take it down.

## A support address

`NOTEFEED_SUPPORT_EMAIL` puts a **Support** link, `mailto:` the address, in every page's footer next to the legal pages. Unset, there is no link. Only an address is taken: with a space, a `?` or a second `@` in it there is no link, and the startup log says so.

```yaml
      NOTEFEED_SUPPORT_EMAIL: support@example.com
```

## What to write

That is yours to decide, and for a public service worth a lawyer's look. A privacy page usually says who is responsible and how to reach them, where the instance is hosted, what is stored (notes, feeds, images, [what the logs hold](operating.md#logs)), for how long, [how long backups keep what was deleted](backups.md#how-long-a-backup-keeps-what-was-deleted), and which rights a person has. With [sign-in](sign-in/index.md#privacy-page-and-imprint) on, say what is stored about the people who sign in.

## A report link on every published note

A public instance has to give readers a way to report content, and the report has to say which note is meant. `NOTEFEED_REPORT_URL` puts a **Report** link on every published note (not on a draft or a scheduled note, which no reader sees), on the feed page, the note page and the read-only view. It is a URL template with `{read_id}`, `{note_id}` and `{file}` filled in, percent-encoded; the feed's name is never in it:

```yaml
NOTEFEED_REPORT_URL: "https://report.example.com/?read_id={read_id}&note_id={note_id}"
# or plain e-mail:
NOTEFEED_REPORT_URL: "mailto:abuse@example.com?subject=Report%20{read_id}/{note_id}"
```

notefeed stores no reports: the link leads to a form you run, or to a mailbox. Say on the privacy page what that form or mailbox keeps of a reporter. A read id and a note id are enough to open the note at `/r/<read id>/<note id>` and to [remove the feed](deleting.md#removing-a-feed-as-the-operator).

### The built-in report page

notefeed can show the form itself, at `/report`, and still store nothing. Set `NOTEFEED_REPORT_ENDPOINT` to the endpoint of a form in an inbox you run, such as [noticebox](https://github.com/noticebox/noticebox); the page posts the note's ids, a reason, a text, an optional name and e-mail address and the reporter's statement that they report in good faith (`good_faith`, the value `Yes`) there: what a notice under Art. 16(2) DSA holds. With the endpoint set and no `NOTEFEED_REPORT_URL`, the **Report** link opens this page. The inbox has to accept posts from this instance and send the browser back to `/report?sent=1`.

# Components

Framework: Next.js 16 (App Router, React 19, server components by default), Tailwind CSS v4 (no tailwind.config; tokens via `@theme inline` in app/globals.css), icons from lucide-react, no component library: plain Tailwind classes in custom components under `components/`. Shared class string for settings section headings in `components/styles.ts`.

## `components/styles.ts`

Class string for settings-page section headings (icon + bold label).

```tsx
// The heading of a section on the settings page.
export const heading = "mb-3 flex items-center gap-2 text-base font-bold";
```

## `components/CopyButton.tsx`

Outline button that copies text; icon flips Copy→Check.

```tsx
"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [label, setLabel] = useState("Copy");
  return (
    <button
      type="button"
      onClick={() =>
        // navigator.clipboard only exists in secure contexts (https or localhost).
        (navigator.clipboard?.writeText(text) ?? Promise.reject()).then(
          () => setLabel("Copied"),
          () => setLabel("Copy failed"),
        )
      }
      className="inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-rule px-2.5 py-1 text-sm text-muted hover:border-carbon hover:text-ink"
    >
      {label === "Copied" ? <Check aria-hidden className="h-4 w-4" /> : <Copy aria-hidden className="h-4 w-4" />}
      <span aria-live="polite">{label}</span>
    </button>
  );
}
```

## `components/NoteView.tsx`

Renders markdown (react-markdown + GFM) inside .md prose styles.

```tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isRelativeLink } from "@/shared/links";

// Raw HTML in notes stays escaped: no rehype-raw. `resolve` gives a picture's URL for a link the text holds (the compose box's preview
// shows the pictures waiting in it from their files, by the name the text calls them, issue #146); undefined falls through to `imageBase`.
export function NoteView({ markdown, imageBase, resolve }: { markdown: string; imageBase?: string; resolve?: (src: string) => string | undefined }) {
  return (
    <div className="md break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // User-uploaded images from our own route: next/image's optimizer has nothing to add (max-width is in globals.css).
          img: ({ src, alt, title }) => {
            const own = typeof src === "string" ? resolve?.(src) : undefined;
            const url = own ?? (typeof src === "string" && imageBase && isRelativeLink(src) ? imageBase + src : src);
            // eslint-disable-next-line @next/next/no-img-element
            return <img src={typeof url === "string" ? url : undefined} alt={alt ?? ""} title={title} loading="lazy" />;
          },
        }}
      >{markdown}</ReactMarkdown>
    </div>
  );
}
```

## `components/MarkdownInput.tsx`

Write/Preview tabbed textarea with image paste/drop/picker and pending-image chips; children render in its toolbar row.

```tsx
"use client";

import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ClipboardEvent, type DragEvent, type ReactNode } from "react";
import { ImagePlus, X } from "lucide-react";
import { NoteView } from "@/components/NoteView";
import { type Pending, fitPending, newPending, removeReference, uniqueToken } from "@/components/pendingFiles";
import { IMAGES_OFF, TOO_MANY_PICTURES } from "@/app/_lib/messages";

const ACCEPT = "image/png,image/jpeg,image/gif,image/webp";

// The note textarea of the compose box and the editor, with pictures: the "Add image" button, paste and drag-and-drop each add the
// files to `pending` (the parent owns the list and posts it, see usePendingImages) and write `![](name)` at the cursor, with a
// name made from the file's (uniqueToken: safe to write in a link, and unlike the others'). Nothing is uploaded here, so leaving the page uploads nothing. The button and the list only exist once hydrated,
// so without JavaScript only the textarea renders. A note takes a limited number of pictures (MAX_ATTACHMENTS): of more,
// the ones that fit are added and `onMessage` sets the reason, for the parent to show where it shows its errors; removing a picture clears it.
// Two tabs above the box, Write and Preview (issue #146): the preview renders the text with the components the note pages use, so it
// cannot differ from the posted note, with the waiting pictures shown from their files and the stored ones from `imageBase` (the feed's
// read link). The textarea is hidden, not unmounted, while previewing, so the text, the cursor and the form's submit stay as they are.
// `images` false (NOTEFEED_IMAGE_UPLOADS=0, issue #152): no button, and a dropped or pasted file is refused with the reason in its place.
export function MarkdownInput({ id, name, label, value, onChange, rows, placeholder, describedBy, className = "", pending, onPendingChange, onMessage, images = true, imageBase, children }: {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
  placeholder?: string;
  describedBy?: string;
  className?: string;
  pending: Pending[];
  onPendingChange: (pending: Pending[]) => void;
  onMessage: (update: (shown: string | undefined) => string | undefined) => void; // a state setter: the message the parent shows
  images?: boolean;
  imageBase?: string; // where the text's relative image links point, for the preview
  children?: ReactNode; // more controls, rendered on the same row as the "Add image" button
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const previewing = hydrated && tab === "preview";
  // A waiting picture, by the name the text calls it (its token): shown from its file, before anything is uploaded.
  const resolve = (src: string) => pending.find((p) => p.token === src)?.preview;
  const tabClass = (own: "write" | "preview") => `-mb-px border-b-2 px-3 py-1.5 ${tab === own ? "border-carbon font-bold text-ink" : "border-transparent text-muted hover:text-ink"}`;
  const cursor = useRef<number | null>(null); // where the cursor goes once the text `insert` made is rendered

  // The textarea is controlled, so the cursor can only be placed once React has rendered the text with the reference in it: in the
  // layout effect of that render, which runs in the same task as the change, so nothing done in between can be lost to a late step
  // (a frame-later callback once let a selection made since collapse, #164).
  useLayoutEffect(() => {
    const ta = area.current;
    if (!ta || cursor.current === null) return;
    const at = Math.min(cursor.current, value.length);
    cursor.current = null;
    // If the writer is in another field (the title, the tags), what they type next belongs there.
    const active = document.activeElement;
    if (active && active !== ta && active.matches("input:not([type=file]), textarea, select")) return;
    ta.focus();
    ta.setSelectionRange(at, at);
  });

  // `text` goes in at the cursor, on a line of its own; the cursor ends up behind it.
  function insert(text: string, current: string) {
    const ta = area.current;
    if (!ta) return current + text;
    const { selectionStart: s, selectionEnd: e } = ta;
    const before = current.slice(0, s);
    const after = current.slice(e);
    const head = before && !before.endsWith("\n") ? "\n" : "";
    const tail = after && !after.startsWith("\n") ? "\n" : "";
    cursor.current = before.length + head.length + text.length;
    return before + head + text + tail + after;
  }

  function add(files: File[]) {
    if (!images) return onMessage(() => IMAGES_OFF);
    const { fit, leftOut } = fitPending(pending, files);
    if (leftOut) onMessage(() => TOO_MANY_PICTURES);
    if (!fit.length) return;
    const taken = new Set(pending.map((p) => p.token));
    const added = fit.map((file) => {
      const token = uniqueToken(file.name, taken);
      taken.add(token);
      return newPending(file, token);
    });
    // By its token, a safe and unique form of its file name: posting sends the picture under that name, and the server swaps it for the stored file's.
    onChange(insert(added.map((p) => `![](${p.token})`).join("\n"), area.current?.value ?? value));
    onPendingChange([...pending, ...added]);
  }

  function remove(p: Pending) {
    URL.revokeObjectURL(p.preview);
    onChange(removeReference(area.current?.value ?? value, p.token));
    onPendingChange(pending.filter((q) => q.key !== p.key));
    onMessage((shown) => (shown === TOO_MANY_PICTURES ? undefined : shown)); // under the limit again; any other message stays
  }

  const imageFiles = (list: FileList | null) => Array.from(list ?? []).filter((f) => f.type.startsWith("image/"));
  const paste = (e: ClipboardEvent) => {
    const files = imageFiles(e.clipboardData.files);
    if (!files.length || e.clipboardData.types.includes("text/plain")) return; // copied cells and text carry a picture too: paste the text
    e.preventDefault();
    add(files);
  };
  const drop = (e: DragEvent) => {
    const files = imageFiles(e.dataTransfer.files);
    if (!files.length) return;
    e.preventDefault();
    add(files);
  };

  return (
    <>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      {hydrated && (
        <div role="tablist" aria-label="Write or preview" className="mb-2 flex border-b border-rule text-sm">
          <button type="button" role="tab" id={`${id}-tab-write`} aria-selected={tab === "write"} aria-controls={`${id}-write`} onClick={() => setTab("write")} className={tabClass("write")}>
            Write
          </button>
          <button type="button" role="tab" id={`${id}-tab-preview`} aria-selected={tab === "preview"} aria-controls={`${id}-preview`} onClick={() => setTab("preview")} className={tabClass("preview")}>
            Preview
          </button>
        </div>
      )}
      {previewing && (
        <div id={`${id}-preview`} role="tabpanel" aria-labelledby={`${id}-tab-preview`} className="min-h-32 rounded-sm border border-rule p-3">
          {value.trim() ? <NoteView markdown={value} imageBase={imageBase} resolve={resolve} /> : <p className="text-muted">Nothing to preview.</p>}
        </div>
      )}
      <textarea
        ref={area}
        hidden={previewing}
        id={id}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
        }}
        onPaste={paste}
        onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()} // a text control accepts file drops in Chromium only otherwise
        onDrop={drop}
        rows={rows}
        placeholder={placeholder}
        aria-describedby={describedBy}
        className={`block w-full resize-y rounded-sm border border-rule bg-transparent p-3 text-ink focus:border-carbon focus:outline-none ${className}`}
      />
      {hydrated && pending.length > 0 && (
        <ul aria-label="Images to post" className="mt-2 flex flex-wrap gap-2 text-sm">
          {pending.map((p) => (
            <li key={p.key} className="flex items-center gap-2 rounded-sm border border-rule py-1 pl-1 pr-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.preview} alt="" className="h-10 w-10 rounded-sm object-cover" />
              <span className="max-w-40 truncate">{p.token}</span>
              <button type="button" onClick={() => remove(p)} aria-label={`Remove ${p.token}`} className="text-muted hover:text-ink">
                <X aria-hidden className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {(hydrated || children || !images) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          {!images && <span className="text-muted">{IMAGES_OFF}</span>}
          {hydrated && images && (
            <>
              <input
                ref={picker}
                type="file"
                accept={ACCEPT}
                multiple
                hidden
                aria-label="Image file"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = ""; // the same file can be chosen again
                  if (files.length) add(files);
                }}
              />
              <button
                type="button"
                onClick={() => picker.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-sm border border-rule px-2.5 py-1 font-bold text-carbon hover:border-carbon"
              >
                <ImagePlus aria-hidden className="h-4 w-4" />
                Add image
              </button>
            </>
          )}
          {children}
        </div>
      )}
    </>
  );
}
```

## `components/Compose.tsx`

Compose box on the feed page: markdown editor + title + tags inputs + Post note button, optional password for new feeds.

```tsx
"use client";

import { Send } from "lucide-react";
import { useState, type FormEvent } from "react";
import { postNote } from "@/app/_lib/api";
import { encodeHeaderValue } from "@/shared/headers";
import { MarkdownInput } from "@/components/MarkdownInput";
import { usePendingImages } from "@/components/usePendingImages";
import { multipart, useApiForm } from "@/app/_lib/useApiForm";
import { errorMessage, PASSWORD_HINT, SENDER_NOTICE, withPictures } from "@/app/_lib/messages";
import { PASSWORD_PATTERN } from "@/shared/password";
import { TAGS_HINT, TAGS_PATTERN } from "@/shared/tags";

// The compose box posts through the API client generated from openapi.json (the session cookie rides along same-origin) and
// shows refusals inline: the text as a raw markdown post, or, with pictures dropped, pasted or picked (they wait in the box,
// usePendingImages), the text and the pictures in one multipart request, so nothing is half-posted.
// `isNew`: a feed that doesn't exist yet, so the box offers to protect it with a password. `images` false: the instance takes no pictures.
// `imageBase`: the feed's read link, for the preview's stored pictures.
export function Compose({ feed, action, error: initialError, isNew, sender, images: imagesOn = true, imageBase }: { feed: string; action: string; error?: string; isNew?: boolean; sender?: boolean; images?: boolean; imageBase?: string }) {
  const images = usePendingImages();
  const { run, error, setError, pending, router } = useApiForm(action, initialError, withPictures(errorMessage, images.pending.length > 0));
  const [text, setText] = useState("");
  const [password, setPassword] = useState("");
  const [tags, setTags] = useState("");
  const [title, setTitle] = useState("");

  const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
  const headers = {
    ...(title.trim() && { "X-Note-Title": encodeHeaderValue(title.trim()) }),
    ...(password && { "X-Feed-Password": password }),
    ...(tagList.length && { "X-Note-Tags": tagList.join(",") }),
  };
  // The page remounts this box empty. With pictures only, the answer is the first picture's.
  const submit = (e: FormEvent) =>
    run(
      e,
      async () => {
        const form = await images.body(text); // undefined: no pictures, a raw markdown post
        return postNote({
          baseUrl: window.location.origin,
          path: { feed },
          ...(form
            ? { ...multipart(form), headers: { ...headers, "Content-Type": null } }
            : { body: new Blob([text], { type: "text/markdown" }), headers: { ...headers, "Content-Type": "text/markdown" } }),
        });
      },
      ({ data }) => router.push(`${action}?posted=${data?.id}`),
    );

  return (
    <form onSubmit={submit} className="mb-12">
      <MarkdownInput
        id="markdown"
        name="markdown"
        label="Note in markdown"
        value={text}
        onChange={setText}
        rows={5}
        placeholder="# Write a note in markdown"
        describedBy="compose-hint compose-error"
        pending={images.pending}
        onPendingChange={images.setPending}
        onMessage={setError}
        images={imagesOn}
        imageBase={imageBase}
      >
        <label htmlFor="note-title" className="sr-only">
          Title (optional, otherwise taken from the text)
        </label>
        <input
          id="note-title"
          name="title"
          type="text"
          autoComplete="off"
          maxLength={100}
          placeholder="Title (optional)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="min-w-0 flex-1 rounded-sm border border-rule bg-transparent px-3 py-1 focus:border-carbon focus:outline-none sm:max-w-xs"
        />
        <label htmlFor="note-tags" className="sr-only">
          Tags (optional, separated by commas)
        </label>
        <input
          id="note-tags"
          name="tags"
          type="text"
          autoComplete="off"
          placeholder="Tags, e.g. ci, deploy"
          pattern={TAGS_PATTERN}
          title={TAGS_HINT}
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          className="min-w-0 flex-1 rounded-sm border border-rule bg-transparent px-3 py-1 focus:border-carbon focus:outline-none sm:max-w-xs"
        />
      </MarkdownInput>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <p id="compose-hint" className="min-w-0 break-all text-sm text-muted" />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-sm bg-carbon px-4 py-1.5 font-bold text-on-carbon disabled:opacity-60"
        >
          <Send aria-hidden className="h-4 w-4" />
          {pending ? "Posting…" : "Post note"}
        </button>
      </div>
      {isNew && (
        <div className="mt-2 text-sm">
          <label htmlFor="new-feed-password" className="mb-1 block text-muted">
            Password (optional, protects this feed)
          </label>
          <input
            id="new-feed-password"
            name="password"
            type="password"
            autoComplete="new-password"
            maxLength={256}
            pattern={PASSWORD_PATTERN}
            title={PASSWORD_HINT}
            aria-describedby="new-feed-password-hint"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full max-w-sm rounded-sm border border-rule bg-transparent px-3 py-1.5 focus:border-carbon focus:outline-none"
          />
          <p id="new-feed-password-hint" className="mt-1 text-muted">
            {PASSWORD_HINT}
          </p>
        </div>
      )}
      {sender && <p className="mt-2 text-sm text-muted">{SENDER_NOTICE}</p>}
      <p id="compose-error" role="alert" className="mt-2 text-sm text-error">
        {error}
      </p>
    </form>
  );
}
```

## `components/NoteList.tsx`

Notes grouped by day (time column + title link + tags + body), NoteArticle for a single note, TagFilter banner.

```tsx
import Link from "next/link";
import { NoteView } from "@/components/NoteView";
import type { Note } from "@/backend";
import { bodyAfterTitle } from "@/shared/notes";
import { reportUrl } from "@/shared/report";

// Times use the server's TZ (set TZ in compose.yaml).
const dayKey = (d: Date) => d.toLocaleDateString("en-CA");
const time = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

function dayLabel(d: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(d) === dayKey(today)) return "Today";
  if (dayKey(d) === dayKey(yesterday)) return "Yesterday";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

function groupByDay(notes: Note[]): [string, Note[]][] {
  const groups = new Map<string, Note[]>();
  for (const n of notes) {
    const label = dayLabel(n.createdAt);
    groups.set(label, [...(groups.get(label) ?? []), n]);
  }
  return [...groups];
}

// Tags link to the list filtered by that tag (`${base}?tag=…`).
function Tags({ tags, base }: { tags: string[]; base: string }) {
  return tags.map((t) => (
    <Link key={t} href={`${base}?tag=${encodeURIComponent(t)}`} className="ml-2 rounded-sm border border-rule px-1.5 text-sm text-muted hover:text-carbon hover:underline">
      {t}
    </Link>
  ));
}

// Where a reader reports a note (issue #154): the operator's URL template with the read id, never the feed name, so the link is the
// same on the feed page and in the read-only view. `report` is unset while the instance has no template, or the feed no read link.
export type Report = { template: string; readId: string };
function ReportLink({ note, report }: { note: Note; report?: Report }) {
  if (!report) return null;
  return (
    <a href={reportUrl(report.template, { readId: report.readId, noteId: note.id, file: note.file })} rel="nofollow noopener" className="ml-2 text-sm text-muted hover:text-carbon hover:underline">
      Report
    </a>
  );
}

// An image note's picture, from the feed's current read link (`imageBase`), so it follows a changed read id. The text alternative is
// the note's own, else its title, else none: a picture without a description is decoration to a screen reader, not a file name.
function Picture({ note, imageBase, className }: { note: Note; imageBase?: string; className: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={(imageBase ?? "") + note.file} alt={note.alt ?? note.title} loading="lazy" className={className} />;
}

// Notes grouped by day; each title links to `${base}/${id}`. `imageBase` is where a note's relative image links point.
export function NoteList({ notes, base, imageBase, posted, report }: { notes: Note[]; base: string; imageBase?: string; posted?: string; report?: Report }) {
  return groupByDay(notes).map(([day, items]) => (
    <section key={day} aria-labelledby={`day-${dayKey(items[0].createdAt)}`} className="mb-10">
      <h2 id={`day-${dayKey(items[0].createdAt)}`} className="mb-3 border-b border-rule pb-1 font-bold">
        {day}
      </h2>
      <ol className="space-y-6">
        {items.map((n) => (
          <li
            key={n.id}
            className={`grid grid-cols-[3.5rem_1fr] gap-x-3 rounded-sm ${n.id === posted ? "arrived" : ""}`}
          >
            <time dateTime={n.createdAt.toISOString()} className="pt-px text-sm tabular-nums text-muted">
              {time(n.createdAt)}
            </time>
            <div className="min-w-0">
              {n.type.startsWith("image/") ? (
                <>
                  {n.title && (
                    <Link href={`${base}/${n.id}`} className="font-bold hover:text-carbon hover:underline">
                      {n.title}
                    </Link>
                  )}
                  <Link href={`${base}/${n.id}`} className="mt-1 block">
                    <Picture note={n} imageBase={imageBase} className="max-h-96 max-w-full rounded-sm" />
                  </Link>
                </>
              ) : (
                <Link href={`${base}/${n.id}`} className="font-bold hover:text-carbon hover:underline">
                  {n.title || n.id}
                </Link>
              )}
              {n.sender && <span className="ml-2 text-sm text-muted">by {n.sender}</span>}
              <Tags tags={n.tags} base={base} />
              <ReportLink note={n} report={report} />
              {bodyAfterTitle(n.content ?? "") && (
                <div className="mt-1">
                  <NoteView markdown={bodyAfterTitle(n.content ?? "")} imageBase={imageBase} />
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  ));
}

export function NoteArticle({ note, back, imageBase, report }: { note: Note; back: string; imageBase?: string; report?: Report }) {
  return (
    <>
      <article>
        <time dateTime={note.createdAt.toISOString()} className="text-sm text-muted">
          {note.createdAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
        </time>
        {note.sender && <span className="text-sm text-muted"> by {note.sender}</span>}
        <Tags tags={note.tags} base={back} />
        <ReportLink note={note} report={report} />
        <div className="mt-2">
          {note.type.startsWith("image/") ? (
            <>
              {note.title && <h1 className="mb-2 text-xl font-bold">{note.title}</h1>}
              <Picture note={note} imageBase={imageBase} className="max-w-full rounded-sm" />
            </>
          ) : (
            <NoteView markdown={(note.content ?? "")} imageBase={imageBase} />
          )}
        </div>
      </article>
      <p className="mt-10 text-sm">
        <Link href={back} className="text-carbon hover:underline">
          Back to all notes
        </Link>
      </p>
    </>
  );
}

// Shown above a filtered list: what it is filtered by, and the way back to all notes.
export function TagFilter({ tag, base }: { tag: string; base: string }) {
  return (
    <p className="mb-6 text-sm text-muted">
      Notes tagged <span className="font-mono text-ink">{tag}</span> ·{" "}
      <Link href={base} className="text-carbon hover:underline">
        Show all notes
      </Link>
    </p>
  );
}
```

## `components/NoteActions.tsx`

Edit/Delete for a single note via <details> disclosures.

```tsx
"use client";

import { useState, type FormEvent } from "react";
import { deleteNote, editNote, patchNote } from "@/app/_lib/api";
import { MarkdownInput } from "@/components/MarkdownInput";
import { usePendingImages } from "@/components/usePendingImages";
import { multipart, multipartBody, useApiForm } from "@/app/_lib/useApiForm";
import { noteErrorMessage, withPictures } from "@/app/_lib/messages";

const summary = "cursor-pointer select-none text-muted hover:text-ink";

// Edit and delete for a note, through the generated API client, with refusals shown inline (`error` is a first message to show).
export function NoteActions({ feed, id, kind, markdown, title: savedTitle, alt: savedAlt, error: initialError, images: imagesOn = true, imageBase }: { feed: string; id: string; kind: string; markdown: string; title: string; alt: string; error?: string; images?: boolean; imageBase?: string }) {
  const page = `/${feed}`;
  const images = usePendingImages();
  const { run, error, setError, pending, setPending, router } = useApiForm(page, initialError, withPictures(noteErrorMessage, images.pending.length > 0));
  const [text, setText] = useState(markdown);
  const [title, setTitle] = useState(savedTitle); // the title set by hand: empty means the one the text gives
  const [alt, setAlt] = useState(savedAlt);
  const image = kind === "image";
  const [editing, setEditing] = useState(!!initialError);
  const base = `${page}/${id}`;

  const opts = () => ({ baseUrl: window.location.origin, path: { feed, id } }); // in handlers only: no window while rendering on the server
  function save(e: FormEvent) {
    e.preventDefault();
    // Only what changed is sent: a text note's content is replaced (PUT, the text and the added pictures in one multipart request:
    // the text part goes even when it holds only the pictures' references, a PUT needs it) when its text changed or pictures were added, and its title set (PATCH)
    // when that changed; a picture has no text, only a title and an alt text. Nothing changed: nothing is sent.
    // The PATCH goes first: it can be sent twice, the PUT can't (it stores the pictures). So a refused PATCH sent nothing else,
    // and saving again after a refused PUT repeats the harmless PATCH and stores the pictures once.
    const textChanged = !image && (text !== markdown || images.pending.length > 0);
    const meta = { ...(title !== savedTitle && { title }), ...(image && alt !== savedAlt && { alt }) };
    const metaChanged = Object.keys(meta).length > 0;
    if (!textChanged && !metaChanged) return setEditing(false);
    const call = async () => {
      let last: { response?: Response; error?: { code?: string; error?: string } } | undefined;
      if (metaChanged) {
        last = await patchNote({ ...opts(), body: meta });
        if (!last.response?.ok) return last;
      }
      if (textChanged) last = await editNote({ ...opts(), ...multipart(await multipartBody(text, images.pending)), headers: { "Content-Type": null } });
      return last!;
    };
    run(e, call, () => {
      setError(undefined);
      setEditing(false);
      setPending(false);
      router.replace(`${base}?edited=1`);
      router.refresh();
    });
  }
  const remove = (e: FormEvent) => run(e, () => deleteNote(opts()), () => router.replace(`${page}?deleted=${id}`), 404); // already gone: the goal is met

  return (
    <section aria-label="Edit or delete this note" className="mt-8 space-y-3 text-sm">
      <details open={editing} onToggle={(e) => setEditing(e.currentTarget.open)}>
        <summary className={summary}>Edit</summary>
        <form onSubmit={save} className="mt-3">
          {!image && (
            <MarkdownInput
              id="edit-markdown"
              name="markdown"
              label="Note in markdown"
              value={text}
              onChange={setText}
              rows={10}
              describedBy="note-actions-error"
              className="font-mono"
              pending={images.pending}
              onPendingChange={images.setPending}
              onMessage={setError}
              images={imagesOn}
              imageBase={imageBase}
            />
          )}
          <label htmlFor="edit-title" className="mt-2 block text-muted">
            Title {image ? "(optional)" : "(optional, otherwise taken from the text)"}
          </label>
          <input id="edit-title" name="title" maxLength={100} autoComplete="off" value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full max-w-md rounded-sm border border-rule bg-transparent px-3 py-1.5 focus:border-carbon focus:outline-none" />
          {image && (
            <>
              <label htmlFor="edit-alt" className="mt-2 block text-muted">
                Alternative text (optional, for screen readers)
              </label>
              <input id="edit-alt" name="alt" maxLength={500} autoComplete="off" value={alt} onChange={(e) => setAlt(e.target.value)} className="mt-1 w-full max-w-md rounded-sm border border-rule bg-transparent px-3 py-1.5 focus:border-carbon focus:outline-none" />
            </>
          )}
          <button type="submit" disabled={pending} className="mt-2 rounded-sm bg-carbon px-4 py-1.5 font-bold text-on-carbon disabled:opacity-60">
            {pending ? "Saving…" : "Save"}
          </button>
        </form>
      </details>
      <details>
        <summary className={summary}>Delete</summary>
        <form onSubmit={remove} className="mt-3">
          <p className="text-muted">Delete this note? This can&apos;t be undone.</p>
          <button type="submit" disabled={pending} className="mt-2 rounded-sm border border-error px-4 py-1.5 font-bold text-error disabled:opacity-60">
            Delete note
          </button>
        </form>
      </details>
      <p id="note-actions-error" role="alert" className="text-error">
        {error}
      </p>
    </section>
  );
}
```

## `components/OpenFeed.tsx`

Home page form: feed name input + Open button.

```tsx
// A plain GET form: the start page normalizes and checks the name, then redirects to /<name>.
// Works without JavaScript.
export function OpenFeed({ value, error }: { value: string; error?: string }) {
  return (
    <form method="get" action="/" className="mb-12">
      <label htmlFor="feed" className="mb-1 block text-sm text-muted">
        Feed name
      </label>
      <div className="flex gap-2">
        <input
          id="feed"
          name="feed"
          defaultValue={value}
          required
          autoFocus
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          aria-describedby="feed-error"
          aria-invalid={error ? true : undefined}
          className="min-w-0 flex-1 rounded-sm border border-rule bg-transparent px-3 py-1.5 font-mono focus:border-carbon focus:outline-none"
        />
        <button type="submit" className="rounded-sm bg-carbon px-4 py-1.5 font-bold text-on-carbon">
          Open
        </button>
      </div>
      <p id="feed-error" role="alert" className="mt-2 text-sm text-error">
        {error}
      </p>
    </form>
  );
}
```

## `components/UnlockForm.tsx`

Feed password unlock form.

```tsx
// The feed password screen: a plain form, POST /<feed>/access sets the unlock cookie and returns to the feed.
export function UnlockForm({ feed, error }: { feed: string; error?: string }) {
  return (
    <main className="mt-[12vh]">
      <form method="post" action={`/${feed}/access`} className="max-w-sm">
        <input type="hidden" name="action" value="unlock" />
        <label htmlFor="feed-password" className="mb-1 block text-sm text-muted">
          Feed password
        </label>
        <div className="flex gap-2">
          <input
            id="feed-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
            maxLength={256}
            aria-describedby="unlock-error"
            aria-invalid={error ? true : undefined}
            className="min-w-0 flex-1 rounded-sm border border-rule bg-transparent px-3 py-1.5 focus:border-carbon focus:outline-none"
          />
          <button type="submit" className="rounded-sm bg-carbon px-4 py-1.5 font-bold text-on-carbon">
            Unlock
          </button>
        </div>
        <p id="unlock-error" role="alert" className="mt-2 text-sm text-error">
          {error}
        </p>
      </form>
    </main>
  );
}
```

## `components/FeedDetails.tsx`

Settings: General (title, description, show sender, read id), title image picker, children slot, Delete feed danger zone.

```tsx
"use client";

import { ImagePlus, Trash2, X, SlidersHorizontal } from "lucide-react";
import { useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { deleteFeed, updateFeed } from "@/app/_lib/api";
import { heading } from "@/components/styles";
import { feedDetailsErrorMessage } from "@/app/_lib/messages";
import { postFile, useApiForm } from "@/app/_lib/useApiForm";

const input = "w-full rounded-sm border border-rule bg-transparent px-3 py-1.5 focus:border-carbon focus:outline-none";
const secondary = "inline-flex items-center gap-1.5 rounded-sm border border-rule px-3 py-1 font-bold hover:border-carbon disabled:opacity-60";

// A feed's title, description and title image, and deleting it: plain forms to POST /<feed>/details and /delete.
// `children` (the sharing and password sections) sit between the two, so deleting stays last. With
// JavaScript they go through the generated API client and show refusals inline; without, the browser follows
// the 303 (the feed page says "Saved." or shows the refusal as `error`, or the home page says "Feed deleted.").
export function FeedDetails({ feed, title: savedTitle, description: savedDescription, image, imageUrl, images, showSender: savedShowSender, readId, readIdChoice, identity, error: initialError, children }: { children?: ReactNode; feed: string; title: string; description: string; image: string; imageUrl: string | null; images: { file: string; url: string; title: string }[]; showSender: boolean; readId: string | null; readIdChoice: "custom" | "random" | "fixed"; identity: boolean; error?: string }) {
  const page = `/${feed}/settings`;
  const { run, error, setError, pending, setPending, router } = useApiForm(page, initialError, feedDetailsErrorMessage);
  const [title, setTitle] = useState(savedTitle);
  const [description, setDescription] = useState(savedDescription);
  const [showSender, setShowSender] = useState(savedShowSender);
  const [readIdValue, setReadIdValue] = useState(readId ?? "");
  const [confirm, setConfirm] = useState("");
  // False while rendering on the server, true once hydrated: without JavaScript the delete button stays enabled
  // and the server checks the name.
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);
  const opts = () => ({ baseUrl: window.location.origin, path: { feed } }); // in handlers only: no window while rendering on the server

  const picker = useRef<HTMLInputElement>(null);
  // The read id goes along with every save while it can be chosen; an unchanged one is no change to the server.
  const save = (e: FormEvent | undefined, body: { title: string; description: string; image?: string; show_sender?: boolean; read_id?: string } = { title, description, ...(identity && { show_sender: showSender }), ...(readIdChoice === "custom" && readId && { read_id: readIdValue }) }) =>
    run(e, () => updateFeed({ ...opts(), body }), () => {
      setError(undefined);
      setPending(false);
      router.replace(`${page}?saved=1`);
      router.refresh();
    });
  // The title image saves on its own, with the title and description as they stand in the form.
  async function choose(file: File) {
    setError(undefined);
    setPending(true);
    const up = await postFile(feed, file);
    if ("error" in up) {
      setError(up.error);
      setPending(false);
    } else save(undefined, { title, description, image: up.file, ...(identity && { show_sender: showSender }) });
  }
  const remove = (e: FormEvent) => run(e, () => deleteFeed(opts()), () => router.replace("/?deleted=" + feed), 404); // already gone: the goal is met

  return (
    <div className="space-y-10 text-sm">
      <section aria-labelledby="general">
        <h2 id="general" className={heading}>
          <SlidersHorizontal aria-hidden className="h-4 w-4" />
          General
        </h2>
        <form method="post" action={`/${feed}/details`} onSubmit={(e) => save(e)} className="max-w-md">
          <label htmlFor="feed-title" className="mb-1 block text-muted">
            Title
          </label>
          <input id="feed-title" name="title" maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} className={`${input} mb-2`} />
          <label htmlFor="feed-description" className="mb-1 block text-muted">
            Description
          </label>
          <input id="feed-description" name="description" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} className={`${input} mb-2`} />
          {identity && (
            <label className="mb-3 flex items-center gap-2">
              <input type="hidden" name="show_sender_present" value="1" />
              <input type="checkbox" name="show_sender" checked={showSender} onChange={(e) => setShowSender(e.target.checked)} />
              Show who posted
            </label>
          )}
          {readIdChoice !== "fixed" && readId && (
            <div className="mb-3">
              {readIdChoice === "custom" && (
                <>
                  <label htmlFor="feed-read-id" className="mb-1 block text-muted">
                    Read id
                  </label>
                  <input id="feed-read-id" name="read_id" minLength={3} maxLength={64} spellCheck={false} autoComplete="off" value={readIdValue} onChange={(e) => setReadIdValue(e.target.value)} className={`${input} mb-2 font-mono`} />
                </>
              )}
              <button type="submit" name="generate_read_id" value="1" formNoValidate disabled={pending} onClick={(e) => { if (hydrated) { e.preventDefault(); save(undefined, { title, description, ...(identity && { show_sender: showSender }), read_id: "" }); } }} className={`${secondary} font-normal`}>
                Generate a random one
              </button>
              <p className="mt-2 text-muted">
                The read id is in the read link and the RSS link. {readIdChoice === "custom" && "3 to 64 characters: a–z, 0–9, - and _. "}A short, readable one can be guessed: protect the feed with a password if that matters. The old link stops showing this feed and may later show another one. Image links in your notes that are relative follow the new id; full URLs don&apos;t, and you change those yourself.
              </p>
            </div>
          )}
          <button type="submit" disabled={pending} className="rounded-sm bg-carbon px-4 py-1.5 font-bold text-on-carbon disabled:opacity-60">
            Save changes
          </button>
        </form>
        {hydrated && (
          <div className="mt-4 max-w-md">
            <p className="mb-1 text-muted">Title image</p>
            {imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="Current title image" loading="lazy" className="mb-2 h-16 w-auto max-w-full rounded-sm object-contain" />
            )}
            <input
              ref={picker}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              hidden
              aria-label="Image for the feed header"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) choose(file);
              }}
            />
            <button type="button" disabled={pending} onClick={() => picker.current?.click()} className={secondary}>
              <ImagePlus aria-hidden className="h-4 w-4" />
              Choose image
            </button>
            {image && (
              <button
                type="button"
                disabled={pending}
                onClick={() => save(undefined, { title, description, image: "", ...(identity && { show_sender: showSender }) })}
                className={`${secondary} ml-2 font-normal text-muted`}
              >
                <X aria-hidden className="h-4 w-4" />
                Remove image
              </button>
            )}
            {images.length > 0 && (
              <>
                <p className="mb-1 mt-3 text-muted">Or use one of this feed&apos;s images</p>
                <ul className="flex flex-wrap gap-2">
                  {images.map((i) => (
                    <li key={i.file}>
                      <button
                        type="button"
                        disabled={pending}
                        aria-pressed={image === i.file}
                        aria-label={`Use ${i.title || i.file} as the title image`}
                        onClick={() => save(undefined, { title, description, image: i.file, ...(identity && { show_sender: showSender }) })}
                        className={`rounded-sm border p-0.5 disabled:opacity-60 ${image === i.file ? "border-carbon" : "border-rule hover:border-carbon"}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={i.url} alt="" loading="lazy" className="h-14 w-14 object-cover" />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </section>
      {children}
      <section aria-labelledby="delete" className="border-t border-rule pt-6">
        <h2 id="delete" className={`${heading} text-error`}>
          <Trash2 aria-hidden className="h-4 w-4" />
          Delete feed
        </h2>
        <form method="post" action={`/${feed}/delete`} onSubmit={remove} className="max-w-md">
          <p className="text-muted">This deletes the feed and all its notes. It can&apos;t be undone. Type the feed&apos;s name to confirm.</p>
          <label htmlFor="feed-confirm" className="mb-1 mt-2 block text-muted">
            Feed name
          </label>
          <input
            id="feed-confirm"
            name="confirm"
            autoComplete="off"
            required
            pattern={feed}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={`${input} mb-2`}
          />
          <button type="submit" disabled={pending || (hydrated && confirm !== feed)} className="inline-flex items-center gap-2 rounded-sm border border-error px-4 py-1.5 font-bold text-error disabled:opacity-60">
            <Trash2 aria-hidden className="h-4 w-4" />
            Delete feed
          </button>
        </form>
      </section>
      <p role="alert" className="text-error">
        {error}
      </p>
    </div>
  );
}
```

## `components/FeedSettings.tsx`

Settings: feed password change/remove, lock this browser.

```tsx
import { KeyRound, Lock } from "lucide-react";
import { heading } from "@/components/styles";
import { PASSWORD_HINT } from "@/app/_lib/messages";
import { PASSWORD_PATTERN } from "@/shared/password";

const input = "min-w-0 flex-1 rounded-sm border border-rule bg-transparent px-3 py-1.5 focus:border-carbon focus:outline-none";

// Shown on a protected feed once unlocked: plain forms to POST /<feed>/access.
export function FeedSettings({ feed, error }: { feed: string; error?: string }) {
  const action = `/${feed}/access`;
  return (
    <section aria-labelledby="access" className="text-sm">
      <h2 id="access" className={heading}>
        <KeyRound aria-hidden className="h-4 w-4" />
        Feed password
      </h2>
      <form method="post" action={action} className="max-w-sm">
        <label htmlFor="current-password" className="mb-1 block text-muted">
          Current password
        </label>
        <input id="current-password" name="current" type="password" autoComplete="current-password" required maxLength={256} className={`${input} mb-2 w-full`} />
        <label htmlFor="new-password" className="mb-1 block text-muted">
          New password
        </label>
        <div className="flex gap-2">
          <input
            id="new-password"
            name="next"
            type="password"
            autoComplete="new-password"
            required
            maxLength={256}
            pattern={PASSWORD_PATTERN}
            title={PASSWORD_HINT}
            aria-describedby="new-password-hint settings-error"
            className={input}
          />
          <button type="submit" name="action" value="change" className="rounded-sm bg-carbon px-4 py-1.5 font-bold text-on-carbon">
            Change
          </button>
        </div>
        <p id="new-password-hint" className="mt-1 text-muted">
          {PASSWORD_HINT}
        </p>
        <p id="settings-error" role="alert" className="mt-2 text-error">
          {error}
        </p>
        <button type="submit" name="action" value="remove" formNoValidate className="mt-1 text-muted hover:text-ink hover:underline">
          Remove password
        </button>
        <span className="ml-1 text-muted">(needs the current password)</span>
      </form>
      <form method="post" action={action} className="mt-3">
        <button type="submit" name="action" value="lock" className="inline-flex items-center gap-1.5 text-muted hover:text-ink hover:underline">
          <Lock aria-hidden className="h-4 w-4" />
          Lock this browser
        </button>
      </form>
    </section>
  );
}
```

## `components/LicenseSection.tsx`

Settings: license status and key entry/removal.

```tsx
"use client";

import { BadgeCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorMessage } from "@/app/_lib/messages";
import { heading } from "@/components/styles";

const input = "min-w-0 flex-1 rounded-sm border border-rule bg-transparent px-3 py-1.5 focus:border-carbon focus:outline-none";

// On a feed's settings page while the instance sells licenses (ADR 0029): the feed's tier, a field for a key, and a way to take it off.
export function LicenseSection({ feed, licensed }: { feed: string; licensed: boolean }) {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  async function send(method: "POST" | "DELETE") {
    setError("");
    setDone("");
    const res = await fetch("/api/licenses/attach", { method, headers: { "content-type": "application/json" }, body: JSON.stringify({ feed, key }) });
    if (res.ok) {
      setKey("");
      setDone(method === "POST" ? "The license is on this feed now." : "The license is off this feed. Its key can be entered on another feed.");
      router.refresh();
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    setError(body.error && body.code === "invalid_body" ? `${body.error[0].toUpperCase()}${body.error.slice(1)}.` : (errorMessage(body.code) ?? "Something went wrong."));
  }

  return (
    <section aria-labelledby="license" className="text-sm">
      <h2 id="license" className={heading}>
        <BadgeCheck aria-hidden className="h-4 w-4" />
        License
      </h2>
      {licensed ? (
        <>
          <p className="text-muted">
            This feed has a license: no cap on stored notes, a feed password and images. To cancel the subscription, change how you pay or get an invoice, go to the{" "}
            <Link href="/license" className="underline">
              license page
            </Link>{" "}
            with your key.
          </p>
          <button type="button" onClick={() => send("DELETE")} className="mt-3 rounded-sm border border-rule px-3 py-1.5 text-muted hover:border-carbon hover:text-ink">
            Take the license off this feed
          </button>
        </>
      ) : (
        <>
          <p className="text-muted">
            This feed is on the free tier: it keeps its newest notes, and has no images and no feed password. <Link href="/license" className="underline">
              Buy a license
            </Link>, then enter its key.
          </p>
          <form
            className="mt-3 flex max-w-xl gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send("POST");
            }}
          >
            <label htmlFor="license-key" className="sr-only">
              License key
            </label>
            <input id="license-key" value={key} onChange={(e) => setKey(e.target.value)} required maxLength={64} autoComplete="off" spellCheck={false} aria-describedby="license-error" className={`${input} font-mono`} />
            <button type="submit" className="rounded-sm bg-carbon px-4 py-1.5 font-bold text-on-carbon">
              Use key
            </button>
          </form>
        </>
      )}
      <p role="status" className="mt-2 font-bold text-ink">
        {done}
      </p>
      <p id="license-error" role="alert" className="text-error">
        {error}
      </p>
    </section>
  );
}
```

## `components/BuyLicense.tsx`

/license page: free vs licensed table, buy button, shows bought key, manage subscription by key.

```tsx
"use client";

import { KeyRound, ReceiptText } from "lucide-react";
import { useEffect, useState } from "react";
import { errorMessage } from "@/app/_lib/messages";
import { CopyButton } from "@/components/CopyButton";

const KEY = /^[A-Za-z0-9_-]{22,64}$/;
const input = "min-w-0 flex-1 rounded-sm border border-rule bg-transparent px-3 py-1.5 font-mono focus:border-carbon focus:outline-none";

async function urlFrom(path: string, body?: unknown): Promise<string> {
  const res = await fetch(path, { method: "POST", ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
  const answer = (await res.json().catch(() => ({}))) as { url?: string; error?: string; code?: string };
  if (res.ok && answer.url) return answer.url;
  throw new Error(answer.error && answer.code === "invalid_body" ? `${answer.error[0].toUpperCase()}${answer.error.slice(1)}.` : (errorMessage(answer.code) ?? "Something went wrong."));
}

// The page a buyer lands on (ADR 0029). Before paying: what a license is, its price, and a button that opens the provider's checkout.
// After: the key, which is in the fragment of this page's URL, so notefeed's server has not received it; it keeps only the hash and
// cannot show it again. Below both: the way to the provider's page for a license one holds, by its key.
export function BuyLicense({ price, cap }: { price: string; cap: number }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // A hash is set after the first render; the state follows it. A checkout that comes straight back to this page changes the hash alone.
    const read = () => {
      const k = window.location.hash.slice(1);
      if (KEY.test(k)) setKey(k);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  async function buy() {
    setBusy(true);
    setError("");
    try {
      window.location.assign(await urlFrom("/api/licenses/checkout"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl text-sm">
      {key ? (
        <section aria-labelledby="your-key">
          <h2 id="your-key" className="mb-3 flex items-center gap-2 text-base font-bold">
            <KeyRound aria-hidden className="h-4 w-4" />
            Your license key
          </h2>
          <div className="flex items-center gap-3">
            <code className="min-w-0 break-all font-mono text-carbon">{key}</code>
            <CopyButton text={key} />
          </div>
          <p className="mt-3 text-muted">
            Keep this key. notefeed stores no information about you, so it cannot show the key again or recover a lost one. Enter it under <em>License</em> in a
            feed&apos;s settings. It works for one feed at a time and can be moved to another.
          </p>
          <p className="mt-2 text-muted">The payment provider&apos;s receipt is the record of your purchase.</p>
        </section>
      ) : (
        <section aria-label="Buy a license">
          <p className="text-muted">
            A license lifts the free tier&apos;s limits for one feed. Reading a feed is always free, and there are no accounts: the license is a key you keep.
          </p>
          <table className="my-4 w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-rule">
                <th className="py-1.5 pr-4 font-bold"></th>
                <th className="py-1.5 pr-4 font-bold">Free</th>
                <th className="py-1.5 font-bold">With a license</th>
              </tr>
            </thead>
            <tbody className="text-muted">
              <tr className="border-b border-rule">
                <th className="py-1.5 pr-4 font-normal text-ink">Notes kept</th>
                <td className="py-1.5 pr-4">the newest {cap}</td>
                <td className="py-1.5">all</td>
              </tr>
              <tr className="border-b border-rule">
                <th className="py-1.5 pr-4 font-normal text-ink">Images</th>
                <td className="py-1.5 pr-4">no</td>
                <td className="py-1.5">yes</td>
              </tr>
              <tr className="border-b border-rule">
                <th className="py-1.5 pr-4 font-normal text-ink">Feed password</th>
                <td className="py-1.5 pr-4">no</td>
                <td className="py-1.5">yes</td>
              </tr>
              {price && (
                <tr>
                  <th className="py-1.5 pr-4 font-normal text-ink">Price</th>
                  <td className="py-1.5 pr-4">free</td>
                  <td className="py-1.5 font-bold text-ink">{price}, per feed</td>
                </tr>
              )}
            </tbody>
          </table>
          <button type="button" disabled={busy} onClick={buy} className="rounded-sm bg-carbon px-4 py-1.5 font-bold text-on-carbon disabled:opacity-60">
            Buy a license
          </button>
          <p id="buy-error" role="alert" className="mt-2 text-error">
            {error}
          </p>
        </section>
      )}
      <ManageLicense bought={key} />
    </div>
  );
}

// Cancelling, the payment method and the invoices are the payment provider's pages. The key opens them: whoever holds it bought the license.
function ManageLicense({ bought }: { bought: string }) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function open() {
    setBusy(true);
    setError("");
    try {
      window.location.assign(await urlFrom("/api/licenses/portal", { key: (bought || typed).trim() }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="manage" className="mt-10 border-t border-rule pt-6">
      <h2 id="manage" className="mb-3 flex items-center gap-2 text-base font-bold">
        <ReceiptText aria-hidden className="h-4 w-4" />
        Cancel, payment and invoices
      </h2>
      <p className="text-muted">
        {bought
          ? "The subscription is managed at the payment provider. Come back to this page with your key to cancel it, change how you pay or get an invoice."
          : "The subscription is managed at the payment provider. Enter your license key to cancel it, change how you pay or get an invoice."}
      </p>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void open();
        }}
      >
        {!bought && (
          <>
            <label htmlFor="manage-key" className="sr-only">
              License key
            </label>
            <input id="manage-key" value={typed} onChange={(e) => setTyped(e.target.value)} required maxLength={64} autoComplete="off" spellCheck={false} aria-describedby="manage-error" className={input} />
          </>
        )}
        <button type="submit" disabled={busy} className="rounded-sm border border-rule px-4 py-1.5 hover:border-carbon disabled:opacity-60">
          Manage subscription
        </button>
      </form>
      <p id="manage-error" role="alert" className="mt-2 text-error">
        {error}
      </p>
    </section>
  );
}
```

## `components/Removed.tsx`

Status line for a feed removed by the operator.

```tsx
// What a feed the operator removed answers under its name and its read id (issue #155): never an empty feed, never a compose box.
export function Removed() {
  return (
    <p role="status" className="text-muted">
      This feed was removed by the operator. Its name and its read link cannot be used again.
    </p>
  );
}
```


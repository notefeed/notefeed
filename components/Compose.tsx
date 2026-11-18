"use client";

import { CameraIcon, CloseIcon, DescriptionIcon, DoneIcon, DraftIcon, MoreIcon, PostIcon, ScheduledIcon, SenderIcon, TagIcon } from "@/components/icons";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { bare, card, primary, secondary } from "@/components/styles";
import { editNote, patchNote, postNote } from "@/app/_lib/api";
import { encodeHeaderValue } from "@/shared/headers";
import { MarkdownInput } from "@/components/MarkdownInput";
import { usePendingImages } from "@/components/usePendingImages";
import { multipart, multipartBody, useApiForm } from "@/app/_lib/useApiForm";
import { messagesFor } from "@/app/_lib/messages";
import { useCopy } from "@/components/CopyProvider";
import { clearSharedFiles, readSharedFiles } from "@/app/_lib/sharedFiles";
import { COMPOSE_FORM } from "@/components/ProtectFeed";
import { addPending, removeReference, type Pending } from "@/components/pendingFiles";
import { TAGS_PATTERN } from "@/shared/tags";
import { NOTE_KINDS, type KindName } from "@/shared/notekinds";

// The compose box posts through the API client generated from openapi.json (the session cookie rides along same-origin) and
// shows refusals inline: the text as a raw markdown post, or, with pictures dropped, pasted or picked (they wait in the box,
// usePendingImages), the text and the pictures in one multipart request, so nothing is half-posted.
// `isNew`: a feed that doesn't exist yet. Its password and, where the instance sells licenses (ADR 0029), its license key sit in
// the feed's details (components/ProtectFeed.tsx, issue #205) but belong to this form (`id` COMPOSE_FORM): the post sends them,
// so it creates the feed protected and licensed in one go (issue #193). A post refused for the lack of a license (402) gets a
// banner that says what to do, with the feed's settings (`settingsHref`, an existing feed) as the place to enter a key.
// `errorCode` is the code behind `error`. `licensePage`: /license exists (ADR 0035), so that banner links to it.
// `images` false: the instance takes no pictures.
// `imageBase`: the feed's read link, for the preview's stored pictures. `initialTitle` and `initialText`: what was shared to
// notefeed from another app (the share target in app/manifest.ts), so the box opens with it. `shared`: pictures were shared too and wait in the browser
// (app/_lib/sharedFiles.ts): the box takes them like photos from the camera button, and posting clears them there.
// `edit`: a note to edit instead of a new one (the note page's Edit opens the feed page with ?edit=): the box opens with it, a
// picture's without the text (it has none) and with its alt text, and Save sends only what changed; Cancel and a saved edit go
// back to the note's page (`href`). `date` is an ISO string, `tags` as stored.
export type NoteToEdit = {
  id: string;
  href: string;
  kind: KindName;
  markdown: string;
  title: string;
  alt: string;
  tags: string[];
  date: string;
  draft: boolean;
};

// Below lg: the phone layout of components/AppShell.tsx.
const NARROW = "(max-width: 63.98rem)";
const subscribeNarrow = (onChange: () => void) => {
  const q = window.matchMedia(NARROW);
  q.addEventListener("change", onChange);
  return () => q.removeEventListener("change", onChange);
};

export function Compose({
  feed,
  action,
  error: initialError,
  errorCode,
  isNew,
  settingsHref,
  sender,
  images: imagesOn = true,
  imageBase,
  initialTitle = "",
  initialText = "",
  shared = false,
  licensePage = false,
  edit,
}: {
  feed: string;
  action: string;
  error?: string;
  errorCode?: string;
  isNew?: boolean;
  settingsHref?: string;
  sender?: boolean;
  images?: boolean;
  imageBase?: string;
  initialTitle?: string;
  initialText?: string;
  shared?: boolean;
  licensePage?: boolean;
  edit?: NoteToEdit;
}) {
  const images = usePendingImages();
  const all = useCopy();
  const t = all.compose;
  const { errorMessage, noteErrorMessage, IMAGES_OFF, SENDER_NOTICE, TOO_MANY_PICTURES, withPictures } = messagesFor(all);
  const { run, error, code, setError, pending, router } = useApiForm(
    action,
    initialError,
    withPictures(edit ? noteErrorMessage : errorMessage, images.pending.length > 0),
    errorCode,
  );
  const [text, setText] = useState(edit?.markdown ?? initialText);
  // What the last post sent of the feed's protection, for the banner of a refusal.
  const [sent, setSent] = useState({ password: false });
  const licenseRefused = code === "license_required";
  const [tags, setTags] = useState(edit?.tags.join(", ") ?? ""); // as typed: comma-separated
  const [title, setTitle] = useState(edit?.title ?? initialTitle); // empty: the one the text gives
  const [alt, setAlt] = useState(edit?.alt ?? "");
  const [senderName, setSenderName] = useState(""); // as shown on the note; empty: the signed-in name, if any
  // A datetime-local value, the browser's time: empty is now, a later time schedules the note. An edited note's date is the
  // browser's time too, which the server can't know: until the field is changed (null) it shows the note's date once hydrated
  // (empty in the server's render, so both renders agree), and only a changed date is sent.
  const [changedDate, setDate] = useState<string | null>(edit ? null : "");
  const [draft, setDraft] = useState(edit?.draft ?? false); // a draft (#265): on the feed page only, readers see it once it is published
  const { text: hasText, alt: hasAlt } = edit ? NOTE_KINDS[edit.kind] : { text: true, alt: false }; // a picture has no text, but an alt text
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const savedDate = edit && hydrated ? localDateTime(new Date(edit.date)) : "";
  const date = changedDate ?? savedDate;

  const tagList = splitTags(tags);
  // The page remounts this box empty. With pictures only, the answer is the first picture's.
  const submit = (e: FormEvent<HTMLFormElement>) => (edit ? save(e, edit) : post(e));
  const post = (e: FormEvent<HTMLFormElement>) => {
    const fields = new FormData(e.currentTarget); // with the feed's protection, outside the box
    const password = isNew ? String(fields.get("password") ?? "") : "";
    setSent({ password: password !== "" });
    const headers = {
      ...(title.trim() && { "X-Note-Title": encodeHeaderValue(title.trim()) }),
      ...(senderName.trim() && { "X-Note-Sender": encodeHeaderValue(senderName.trim()) }),
      ...(password && { "X-Feed-Password": password }),
      ...(tagList.length && { "X-Note-Tags": tagList.join(",") }),
      ...(date && { "X-Note-Date": new Date(date).toISOString() }),
      ...(draft && { "X-Note-Draft": "true" as const }),
    };
    return run(
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
      async ({ data }) => {
        if (shared) await clearSharedFiles();
        router.push(`${action}?posted=${data?.id}`);
      },
    );
  };

  // An edit sends only what changed: the text (PUT, the text and the added pictures in one multipart request: the text part goes
  // even when it holds only the pictures' references, a PUT needs it) when it changed or pictures were added, and the title, alt
  // text, tags, date and draft (PATCH) when they changed. Nothing changed: back to the note. The PATCH goes first: it can be sent
  // twice, the PUT can't (it stores the pictures). So a refused PATCH sent nothing else, and saving again after a refused PUT
  // repeats the harmless PATCH and stores the pictures once.
  const save = (e: FormEvent<HTMLFormElement>, note: NoteToEdit) => {
    const textChanged = hasText && (text !== note.markdown || images.pending.length > 0);
    const dateChanged = changedDate !== null && changedDate !== "" && changedDate !== savedDate; // emptied: kept
    const tagsChanged = tagList.join(",") !== note.tags.join(","); // the server folds case and drops repeats: "CI" for "ci" is sent, and stored as before
    const meta = {
      ...(title !== note.title && { title }),
      ...(hasAlt && alt !== note.alt && { alt }),
      ...(tagsChanged && { tags: tagList }),
      ...(dateChanged && { date: new Date(changedDate).toISOString() }),
      ...(draft !== note.draft && { draft }),
    };
    const metaChanged = Object.keys(meta).length > 0;
    if (!textChanged && !metaChanged) {
      e.preventDefault();
      return router.push(note.href);
    }
    const opts = { baseUrl: window.location.origin, path: { feed, id: note.id } };
    return run(
      e,
      async () => {
        let last: { response?: Response; error?: { code?: string; error?: string } } | undefined;
        if (metaChanged) {
          last = await patchNote({ ...opts, body: meta });
          if (!last.response?.ok) return last;
        }
        if (textChanged) last = await editNote({ ...opts, ...multipart(await multipartBody(text, images.pending)), headers: { "Content-Type": null } });
        return last!;
      },
      () => router.push(`${note.href}?edited=1`),
    );
  };

  // On a phone, once hydrated: a chat-style bar docked at the bottom (issue #185). Its field is the note's text (the same
  // state as the full box's), Send posts it, ＋ opens the full box as a sheet for the title, tags, pictures and the preview.
  // Like a messenger's (issue #203): a camera button next to Send, so a photo is two taps (the camera, then Send), and each tap
  // adds one more. The photos wait with the full box's pictures (shrunk on posting like them) and show above the field. On a
  // computer `capture` is ignored and the button opens the file picker, where several can be picked at once. The bar keeps clear of the screen's rounded
  // corners and the home indicator (issue #202).
  // Without JavaScript, and from lg, the box is a card at the top of the feed. The bar is only rendered on a narrow
  // screen, so the page never holds two note fields where both could show.
  const narrow = useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
  const [open, setOpen] = useState(!!initialError || !!initialText || !!edit); // an edit opens as the sheet
  const form = useRef<HTMLFormElement>(null);
  const quick = useRef<HTMLTextAreaElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const empty = !text.trim() && images.pending.length === 0;
  const addPhotos = (files: File[]) => {
    const { added, leftOut } = addPending(images.pending, files);
    if (leftOut) setError(TOO_MANY_PICTURES);
    if (!added.length) return;
    setText((t) => [t.trimEnd(), ...added.map((p) => `![](${p.token})`)].filter(Boolean).join("\n"));
    images.setPending([...images.pending, ...added]);
  };
  // Taken once: React runs a mount effect twice in development, which would attach them twice.
  const tookShared = useRef(false);
  useEffect(() => {
    if (!shared || tookShared.current) return;
    tookShared.current = true;
    void readSharedFiles().then((files) => {
      if (!files.length) return;
      setOpen(true);
      if (imagesOn) addPhotos(files);
      else setError(IMAGES_OFF);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);
  const removePhoto = (p: Pending) => {
    URL.revokeObjectURL(p.preview);
    setText((t) => removeReference(t, p.token));
    images.setPending(images.pending.filter((q) => q.key !== p.key));
  };
  // The bar's field grows with its text, up to about five lines.
  useLayoutEffect(() => {
    const q = quick.current;
    if (!q) return;
    q.style.height = "auto";
    q.style.height = `${Math.min(q.scrollHeight, 132)}px`;
  });
  // A refusal shows in the full box, so on a phone the box is open while there is one; closing it clears the refusal.
  const opened = open || (narrow && !!error);
  const close = () => {
    if (edit) return router.push(edit.href); // closing an edit goes back to the note
    setOpen(false);
    setError(undefined);
  };
  const docked = hydrated && !opened;
  const sheet = hydrated && opened;
  const openSheet = () => {
    setOpen(true);
    requestAnimationFrame(() => document.getElementById("markdown")?.focus());
  };
  useEffect(() => {
    if (!opened) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (edit) return router.push(edit.href);
      setOpen(false);
      setError(undefined);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [opened, setError, edit, router]);

  // The box's parts: the title above the text, the fields below it, the buttons in its toolbar (a picture, which has no text: below the fields).
  const titleField = (
    <>
      <label htmlFor="note-title" className="sr-only">
        {edit ? `${all.noteActions.title} ${hasText ? all.noteActions.titleOptionalText : all.noteActions.titleOptional}` : t.titleLabel}
      </label>
      <input
        id="note-title"
        name="title"
        type="text"
        autoComplete="off"
        maxLength={100}
        placeholder={t.titlePlaceholder}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className={`${bare} text-[17px] font-bold tracking-tight placeholder:font-normal`}
      />
    </>
  );
  const fields = (
    <div className="mt-2 flex flex-wrap gap-2">
      {hasAlt && (
        <div className="flex min-w-0 basis-full items-center gap-1.5 rounded-full bg-surface-2/70 px-3 py-1">
          <DescriptionIcon aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted" />
          <label htmlFor="note-alt" className="sr-only">
            {all.noteActions.alt}
          </label>
          <input
            id="note-alt"
            name="alt"
            type="text"
            autoComplete="off"
            maxLength={500}
            placeholder={all.noteActions.alt}
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            className={`${bare} text-[13px]`}
          />
        </div>
      )}
      <div className="flex min-w-0 flex-1 basis-48 items-center gap-1.5 rounded-full bg-surface-2/70 px-3 py-1 sm:max-w-sm">
        <TagIcon aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted" />
        <label htmlFor="note-tags" className="sr-only">
          {t.tagsLabel}
        </label>
        <input
          id="note-tags"
          name="tags"
          type="text"
          autoComplete="off"
          placeholder={t.tagsPlaceholder}
          pattern={TAGS_PATTERN}
          title={t.tagsHint}
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          className={`${bare} text-[13px]`}
        />
      </div>
      {!edit && (
        <div className="flex min-w-0 basis-36 items-center gap-1.5 rounded-full bg-surface-2/70 px-3 py-1 sm:max-w-48" title={t.senderHint}>
          <SenderIcon aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted" />
          <label htmlFor="note-sender" className="sr-only">
            {t.senderLabel}
          </label>
          <input
            id="note-sender"
            name="sender"
            type="text"
            autoComplete="off"
            maxLength={100}
            placeholder={t.senderPlaceholder}
            value={senderName}
            onChange={(e) => setSenderName(e.target.value)}
            className={`${bare} text-[13px]`}
          />
        </div>
      )}
      <div className="flex shrink-0 items-center gap-1.5 rounded-full bg-surface-2/70 px-3 py-1" title={t.dateHint}>
        <ScheduledIcon aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted" />
        <label htmlFor="note-date" className="sr-only">
          {edit ? all.noteActions.date : t.dateLabel}
        </label>
        <input
          id="note-date"
          name="date"
          type="datetime-local"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={`${bare} text-[13px] ${date ? "" : "text-muted"}`}
        />
      </div>
      <label className="flex shrink-0 items-center gap-1.5 rounded-full bg-surface-2/70 px-3 py-1 text-[13px]" title={t.draftHint}>
        <DraftIcon aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted" />
        <input id="note-draft" name="draft" type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
        {t.draft}
      </label>
    </div>
  );
  const actions = (
    <>
      {edit ? (
        <>
          <Link href={edit.href} className={`${secondary} ml-auto`}>
            {all.noteActions.cancel}
          </Link>
          <button type="submit" disabled={pending} className={primary}>
            <DoneIcon aria-hidden className="h-4 w-4" />
            {pending ? all.noteActions.saving : all.noteActions.save}
          </button>
        </>
      ) : (
        <>
          <span id="compose-hint" className="ml-auto mr-2 hidden min-w-0 break-all text-[12px] text-muted sm:inline">
            {t.hint}
          </span>
          <button type="submit" disabled={pending} aria-label={t.postNote} className={`${primary} max-sm:ml-auto`}>
            <PostIcon aria-hidden className="h-4 w-4" />
            {pending ? t.posting : t.post}
          </button>
        </>
      )}
    </>
  );

  return (
    <>
      {docked && narrow && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-surface pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-2.5 lg:hidden">
          {images.pending.length > 0 && (
            <ul aria-label={t.photosToSend} className="mb-2 flex gap-2 overflow-x-auto pt-1.5 pr-1.5">
              {images.pending.map((p) => (
                <li key={p.key} className="relative shrink-0" title={p.token}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.preview} alt="" className="h-14 w-14 rounded-xl border border-rule object-cover" />
                  <button
                    type="button"
                    onClick={() => removePhoto(p)}
                    aria-label={t.remove(p.token)}
                    className="absolute -right-1.5 -top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-ink text-paper"
                  >
                    <CloseIcon aria-hidden className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {imagesOn && (
            <input
              ref={camera}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              hidden
              aria-label={t.cameraPhoto}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = ""; // the same photo can be taken again
                if (files.length) addPhotos(files);
              }}
            />
          )}
          <div className="flex items-end gap-1.5">
            <button
              type="button"
              onClick={openSheet}
              aria-label={t.more}
              title={t.more}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-carbon hover:bg-surface-2"
            >
              <MoreIcon aria-hidden className="h-[22px] w-[22px]" />
            </button>
            <textarea
              ref={quick}
              rows={1}
              aria-label={t.quickNote}
              placeholder={t.writeANote}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) form.current?.requestSubmit();
              }}
              className="block max-h-[8.25rem] min-h-10 min-w-0 flex-1 resize-none rounded-[1.25rem] border border-rule bg-surface-2 px-4 py-2 text-[15px] leading-normal placeholder:text-muted focus:border-carbon/60 focus-visible:outline-none"
            />
            {imagesOn && (
              <button
                type="button"
                onClick={() => camera.current?.click()}
                aria-label={t.takePhoto}
                title={t.takePhoto}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-carbon hover:bg-surface-2"
              >
                <CameraIcon aria-hidden className="h-[22px] w-[22px]" />
              </button>
            )}
            <button
              type="button"
              disabled={pending || empty}
              onClick={() => form.current?.requestSubmit()}
              aria-label={t.send}
              title={t.send}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-carbon hover:bg-surface-2 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <PostIcon aria-hidden className="h-[22px] w-[22px]" />
            </button>
          </div>
        </div>
      )}
      {sheet && <div aria-hidden className="fixed inset-0 z-40 bg-ink/40 lg:hidden" onClick={close} />}
      <form
        ref={form}
        id={COMPOSE_FORM}
        onSubmit={submit}
        aria-label={edit ? t.editNote : t.newNote}
        className={`${card} mb-6 px-4 pt-3 pb-2 focus-within:border-carbon/60 ${docked ? "max-lg:hidden" : ""} ${sheet ? "max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-50 max-lg:mb-0 max-lg:max-h-[90dvh] max-lg:overflow-y-auto max-lg:rounded-b-none max-lg:shadow-sheet max-lg:pb-[max(0.5rem,env(safe-area-inset-bottom))]" : ""}`}
      >
        {sheet && (
          <div className="-mx-4 mb-2 flex items-center justify-between border-b border-rule px-2 pb-2 lg:hidden">
            <button
              type="button"
              onClick={close}
              aria-label={t.close}
              title={t.close}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-surface-2"
            >
              <CloseIcon aria-hidden className="h-5 w-5" />
            </button>
            <span className="truncate rounded-full border border-rule bg-surface-2 px-3 py-1 text-[13px] font-bold text-carbon">{feed}</span>
            <span className="w-9" />
          </div>
        )}
        {hasText ? (
          <MarkdownInput
            id="markdown"
            name="markdown"
            label={t.noteInMarkdown}
            value={text}
            onChange={setText}
            rows={sheet ? 6 : 3}
            placeholder={t.writeInMarkdown}
            describedBy="compose-hint compose-error"
            pending={images.pending}
            onPendingChange={images.setPending}
            onMessage={setError}
            images={imagesOn}
            imageBase={imageBase}
            bare
            above={titleField}
            below={fields}
          >
            {actions}
          </MarkdownInput>
        ) : (
          <>
            {titleField}
            {fields}
            <div className="-mx-4 mt-2 flex flex-wrap items-center gap-1 border-t border-rule px-3 pt-2 text-sm">{actions}</div>
          </>
        )}
        {sender && <p className="mt-2 text-sm text-muted">{SENDER_NOTICE}</p>}
        {licenseRefused && <LicenseNeeded isNew={!!isNew} password={sent.password} settingsHref={settingsHref} licensePage={licensePage} />}
        <p id="compose-error" role="alert" className="text-sm text-error empty:hidden">
          {licenseRefused ? "" : error}
        </p>
      </form>
    </>
  );
}

// The tags as typed, a list as the API takes it: split at commas, trimmed, empty ones dropped (as backend/tags.ts splits a header).
const splitTags = (typed: string) =>
  typed
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

// A datetime-local value for `d` in the browser's time, to the minute as the field shows it.
function localDateTime(d: Date): string {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

// The post was refused with 402 (`license_required`): a banner instead of the one red line, with what needs the license, what to
// do and where (issue #193). `password`: the post sent a password, so that is what was refused (else it was the pictures);
// `licensePage`: /license exists (ADR 0035), so the banner
// says to buy one there; without it, only where a key goes.
export function LicenseNeeded({
  isNew,
  password,
  settingsHref,
  licensePage,
}: {
  isNew: boolean;
  password: boolean;
  settingsHref?: string;
  licensePage: boolean;
}) {
  const t = useCopy().licenseNeeded;
  const what = password ? t.password : t.pictures;
  // A license is an account's (ADR 0061): a new feed goes under the signed-in account's, an existing one is put there by its owner.
  const next = isNew ? t.newFeed : `${t.freeTier} ${t.ownerPutsIt}`;
  return (
    <section role="alert" aria-labelledby="license-needed" className="mt-3 rounded-xl border border-error/40 bg-error/5 p-4 text-sm">
      <p id="license-needed" className="font-bold text-ink">
        {what}
      </p>
      <p className="mt-1 text-muted">{next}</p>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-bold">
        {licensePage && (
          <Link href="/license" className="text-carbon underline">
            {t.buy}
          </Link>
        )}
        {settingsHref && (
          <Link href={`${settingsHref}#license`} className="text-carbon underline">
            {t.settings}
          </Link>
        )}
      </p>
    </section>
  );
}

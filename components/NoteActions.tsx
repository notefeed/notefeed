"use client";

import Link from "next/link";
import { Check, ChevronLeft, Flag, Link2, Pencil, Trash2 } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { copyText } from "@/components/copy";
import { card, field, primary, secondary, sectionLabel } from "@/components/styles";
import { deleteNote, editNote, patchNote } from "@/app/_lib/api";
import { MarkdownInput } from "@/components/MarkdownInput";
import { usePendingImages } from "@/components/usePendingImages";
import { multipart, multipartBody, useApiForm } from "@/app/_lib/useApiForm";
import { noteErrorMessage, withPictures } from "@/app/_lib/messages";
import { NOTE_KINDS, type KindName } from "@/shared/notekinds";

// Edit and delete for a note, through the generated API client, with refusals shown inline (`error` is a first message to show).
// The state of the note page's actions, for the two places they show: the bar (NoteActionsBar, in the shell's right column)
// and the forms (NoteActionsPanel, under the note). `reportHref`: the note's Report link, in the bar (the note shows none).
// `date`: the note's date, an ISO string.
export function NoteActions({ feed, id, kind, markdown, title: savedTitle, alt: savedAlt, date: savedDate, error: initialError, images: imagesOn = true, imageBase, reportHref, children }: { feed: string; id: string; kind: KindName; markdown: string; title: string; alt: string; date: string; error?: string; images?: boolean; imageBase?: string; reportHref?: string; children: ReactNode }) {
  const page = `/${feed}`;
  const images = usePendingImages();
  const { run, error, setError, pending, setPending, router } = useApiForm(page, initialError, withPictures(noteErrorMessage, images.pending.length > 0));
  const [text, setText] = useState(markdown);
  const [title, setTitle] = useState(savedTitle); // the title set by hand: empty means the one the text gives
  const [alt, setAlt] = useState(savedAlt);
  // The date field holds the browser's time, which the server can't know: until the field is changed it shows the note's
  // date once hydrated (empty in the server's render, so both renders agree), and only a changed date is sent.
  const [changedDate, setDate] = useState<string | null>(null);
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);
  const date = changedDate ?? (hydrated ? localDateTime(new Date(savedDate)) : "");
  const { text: hasText, alt: hasAlt } = NOTE_KINDS[kind]; // what the edit form offers: a text, an alternative text
  const [mode, setMode] = useState<"edit" | "delete" | null>(initialError ? "edit" : null);
  const base = `${page}/${id}`;

  const opts = () => ({ baseUrl: window.location.origin, path: { feed, id } }); // in handlers only: no window while rendering on the server
  function save(e: FormEvent) {
    e.preventDefault();
    // Only what changed is sent: a text note's content is replaced (PUT, the text and the added pictures in one multipart request:
    // the text part goes even when it holds only the pictures' references, a PUT needs it) when its text changed or pictures were added, and its title,
    // alt text and date set (PATCH) when they changed; a picture has no text, only a title, an alt text and a date. Nothing changed: nothing is sent.
    // The PATCH goes first: it can be sent twice, the PUT can't (it stores the pictures). So a refused PATCH sent nothing else,
    // and saving again after a refused PUT repeats the harmless PATCH and stores the pictures once.
    const textChanged = hasText && (text !== markdown || images.pending.length > 0);
    const dateChanged = changedDate !== null && changedDate !== "" && changedDate !== localDateTime(new Date(savedDate)); // emptied: kept
    const meta = { ...(title !== savedTitle && { title }), ...(hasAlt && alt !== savedAlt && { alt }), ...(dateChanged && { date: new Date(changedDate).toISOString() }) };
    const metaChanged = Object.keys(meta).length > 0;
    if (!textChanged && !metaChanged) return setMode(null);
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
      setMode(null);
      setPending(false);
      router.replace(`${base}?edited=1`);
      router.refresh();
    });
  }
  const remove = (e: FormEvent) => run(e, () => deleteNote(opts()), () => router.replace(`${page}?deleted=${id}`), 404); // already gone: the goal is met

  const [copied, setCopied] = useState(false);
  const copyLink = () => copyText(window.location.href).then(() => setCopied(true), () => {});

  const value = { back: page, mode, setMode, text, setText, title, setTitle, alt, setAlt, date, setDate, hasText, hasAlt, images, imagesOn, imageBase, save, remove, pending, error, setError, hydrated, copied, copyLink, reportHref };
  return <Actions.Provider value={value}>{children}</Actions.Provider>;
}

// A datetime-local value for `d` in the browser's time, to the minute as the field shows it.
function localDateTime(d: Date): string {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

type ActionsState = {
  back: string;
  mode: "edit" | "delete" | null;
  setMode: (m: "edit" | "delete" | null) => void;
  text: string;
  setText: (t: string) => void;
  title: string;
  setTitle: (t: string) => void;
  alt: string;
  setAlt: (t: string) => void;
  date: string;
  setDate: (d: string) => void;
  hasText: boolean;
  hasAlt: boolean;
  images: ReturnType<typeof usePendingImages>;
  imagesOn: boolean;
  imageBase?: string;
  save: (e: FormEvent) => void;
  remove: (e: FormEvent) => void;
  pending: boolean;
  error?: string;
  setError: Parameters<typeof MarkdownInput>[0]["onMessage"];
  hydrated: boolean;
  copied: boolean;
  copyLink: () => void;
  reportHref?: string;
};
const Actions = createContext<ActionsState | null>(null);
const useActions = () => useContext(Actions)!;

// Edit opens its form under the note: a sheet on a phone, a card from lg. Delete asks in a dialog (DeleteDialog).
export function NoteActionsPanel() {
  const { mode, setMode, text, setText, title, setTitle, alt, setAlt, date, setDate, hasText, hasAlt, images, imagesOn, imageBase, save, remove, pending, error, setError, hydrated } = useActions();
  return (
    <section aria-label="Edit or delete this note" className="mt-4 text-sm">
      {mode === "delete" && <DeleteDialog onSubmit={remove} onClose={() => setMode(null)} pending={pending} error={error} />}
      {mode === "edit" && (
        <>
          {hydrated && <div aria-hidden className="fixed inset-0 z-40 bg-ink/40 lg:hidden" onClick={() => setMode(null)} />}
          <div className={`${card} p-4 max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-50 max-lg:max-h-[90dvh] max-lg:overflow-y-auto max-lg:rounded-b-none max-lg:shadow-sheet max-lg:pb-8`}>
              <form onSubmit={save}>
                {hasText && (
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
                <label htmlFor="edit-title" className="mt-3 block text-muted">
                  Title {hasText ? "(optional, otherwise taken from the text)" : "(optional)"}
                </label>
                <input id="edit-title" name="title" maxLength={100} autoComplete="off" value={title} onChange={(e) => setTitle(e.target.value)} className={`${field} mt-1 max-w-md`} />
                {hasAlt && (
                  <>
                    <label htmlFor="edit-alt" className="mt-3 block text-muted">
                      Alternative text (optional, for screen readers)
                    </label>
                    <input id="edit-alt" name="alt" maxLength={500} autoComplete="off" value={alt} onChange={(e) => setAlt(e.target.value)} className={`${field} mt-1 max-w-md`} />
                  </>
                )}
                <label htmlFor="edit-date" className="mt-3 block text-muted">
                  Date (in your time; a later one schedules the note)
                </label>
                <input id="edit-date" name="date" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} className={`${field} mt-1 max-w-md`} />
                <div className="mt-4 flex gap-2">
                  <button type="submit" disabled={pending} className={primary}>
                    <Check aria-hidden className="h-4 w-4" />
                    {pending ? "Saving…" : "Save"}
                  </button>
                  <button type="button" onClick={() => setMode(null)} className={secondary}>
                    Cancel
                  </button>
                </div>
              </form>
          </div>
        </>
      )}
      {mode !== "delete" && (
        <p id="note-actions-error" role="alert" className="mt-2 text-error empty:hidden">
          {error}
        </p>
      )}
    </section>
  );
}

// The question before deleting, as a modal dialog at every width: under the note, from lg, it sat below a tall picture where it
// was easy to miss. showModal() dims the page, keeps the focus inside and closes on Escape (onClose); a click on the backdrop,
// which is the dialog element itself, closes it too. Cancel gets the focus, so a stray Enter deletes nothing. A refused delete
// says why inside the dialog.
function DeleteDialog({ onSubmit, onClose, pending, error }: { onSubmit: (e: FormEvent) => void; onClose: () => void; pending: boolean; error?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    cancel.current?.focus(); // after showModal, which would focus the first button (Delete); React's autoFocus runs before it
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="delete-note-title"
      aria-describedby="delete-note-text"
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className={`${card} m-auto w-[min(24rem,calc(100%-2rem))] p-5 text-center text-sm backdrop:bg-ink/40 sm:text-left`}
    >
      <form onSubmit={onSubmit}>
        <h2 id="delete-note-title" className="text-[17px] font-bold text-ink">
          Delete this note?
        </h2>
        <p id="delete-note-text" className="mt-1 text-muted">
          This can&apos;t be undone.
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button type="submit" disabled={pending} className={`${primary} bg-error`}>
            <Trash2 aria-hidden className="h-4 w-4" />
            Delete note
          </button>
          <button ref={cancel} type="button" onClick={onClose} className={secondary}>
            Cancel
          </button>
        </div>
        <p id="note-actions-error" role="alert" className="mt-2 text-error empty:hidden">
          {error}
        </p>
      </form>
    </dialog>
  );
}

// The note's actions (issue #185): docked at the bottom of a phone's screen, so they stay in reach on a long note; a row
// above the note from lg; a card in the right column from xl, which stays put while the note scrolls, level with the note
// (the "All notes" link above the note is hidden from lg, NoteArticle).
export function NoteActionsBar() {
  const { back, mode, setMode, copied, copyLink, reportHref } = useActions();
  const button = "inline-flex min-w-16 flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-[11px] hover:bg-surface-2 xl:min-w-0 xl:flex-row xl:gap-3 xl:px-3 xl:py-2 xl:text-[14px]";
  return (
    <nav
      aria-label="Note actions"
      className="flex items-center justify-around bg-surface max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-30 max-lg:border-t max-lg:border-rule max-lg:px-[max(0.75rem,env(safe-area-inset-left),env(safe-area-inset-right))] max-lg:pt-1.5 max-lg:pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:justify-start lg:gap-2 lg:rounded-2xl lg:border lg:border-rule lg:p-1.5 lg:shadow-card xl:flex-col xl:items-stretch xl:gap-0.5 xl:p-2"
    >
      <p className={`${sectionLabel} hidden px-3 pb-1 pt-1.5 xl:block`}>This note</p>
      <button type="button" aria-pressed={mode === "edit"} onClick={() => setMode(mode === "edit" ? null : "edit")} className={`${button} ${mode === "edit" ? "text-carbon" : ""}`}>
        <Pencil aria-hidden className="h-5 w-5" />
        Edit
      </button>
      <button type="button" onClick={copyLink} className={button}>
        {copied ? <Check aria-hidden className="h-5 w-5" /> : <Link2 aria-hidden className="h-5 w-5" />}
        <span aria-live="polite">{copied ? "Copied" : "Copy link"}</span>
      </button>
      {reportHref && (
        <a href={reportHref} rel="nofollow noopener" className={button}>
          <Flag aria-hidden className="h-5 w-5" />
          Report
        </a>
      )}
      <button type="button" aria-pressed={mode === "delete"} onClick={() => setMode(mode === "delete" ? null : "delete")} className={`${button} text-error`}>
        <Trash2 aria-hidden className="h-5 w-5" />
        Delete
      </button>
      {/* Not on a phone, where the "All notes" link above the note is at hand: first in the row from lg, last in the right
          column from xl (the note's own link is hidden from lg). */}
      <div className="hidden lg:order-first lg:mr-auto lg:flex xl:order-none xl:mr-0 xl:flex-col">
        <div className="mx-2 my-1 hidden border-t border-rule xl:block" />
        <Link href={back} className={`${button} text-carbon`}>
          <ChevronLeft aria-hidden className="h-5 w-5" />
          All notes
        </Link>
      </div>
    </nav>
  );
}

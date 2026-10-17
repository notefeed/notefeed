"use client";

import Link from "next/link";
import { Check, ChevronLeft, Flag, Link2, Pencil, Trash2 } from "lucide-react";
import { createContext, useContext, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { copyText } from "@/components/copy";
import { card, field, primary, secondary, sectionLabel } from "@/components/styles";
import { deleteNote, editNote, patchNote } from "@/app/_lib/api";
import { MarkdownInput } from "@/components/MarkdownInput";
import { usePendingImages } from "@/components/usePendingImages";
import { multipart, multipartBody, useApiForm } from "@/app/_lib/useApiForm";
import { noteErrorMessage, withPictures } from "@/app/_lib/messages";

// Edit and delete for a note, through the generated API client, with refusals shown inline (`error` is a first message to show).
// The state of the note page's actions, for the two places they show: the bar (NoteActionsBar, in the shell's right column)
// and the forms (NoteActionsPanel, under the note). `reportHref`: the note's Report link, in the bar (the note shows none).
export function NoteActions({ feed, id, kind, markdown, title: savedTitle, alt: savedAlt, error: initialError, images: imagesOn = true, imageBase, reportHref, children }: { feed: string; id: string; kind: string; markdown: string; title: string; alt: string; error?: string; images?: boolean; imageBase?: string; reportHref?: string; children: ReactNode }) {
  const page = `/${feed}`;
  const images = usePendingImages();
  const { run, error, setError, pending, setPending, router } = useApiForm(page, initialError, withPictures(noteErrorMessage, images.pending.length > 0));
  const [text, setText] = useState(markdown);
  const [title, setTitle] = useState(savedTitle); // the title set by hand: empty means the one the text gives
  const [alt, setAlt] = useState(savedAlt);
  const image = kind === "image";
  const [mode, setMode] = useState<"edit" | "delete" | null>(initialError ? "edit" : null);
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
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);

  const value = { back: page, mode, setMode, text, setText, title, setTitle, alt, setAlt, image, images, imagesOn, imageBase, save, remove, pending, error, setError, hydrated, copied, copyLink, reportHref };
  return <Actions.Provider value={value}>{children}</Actions.Provider>;
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
  image: boolean;
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

// Edit and Delete open their form under the note: a sheet on a phone, a card from lg.
export function NoteActionsPanel() {
  const { mode, setMode, text, setText, title, setTitle, alt, setAlt, image, images, imagesOn, imageBase, save, remove, pending, error, setError, hydrated } = useActions();
  return (
    <section aria-label="Edit or delete this note" className="mt-4 text-sm">
      {mode && (
        <>
          {hydrated && <div aria-hidden className="fixed inset-0 z-40 bg-ink/40 lg:hidden" onClick={() => setMode(null)} />}
          <div className={`${card} p-4 max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-50 max-lg:max-h-[90dvh] max-lg:overflow-y-auto max-lg:rounded-b-none max-lg:shadow-sheet max-lg:pb-8`}>
            {mode === "edit" ? (
              <form onSubmit={save}>
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
                <label htmlFor="edit-title" className="mt-3 block text-muted">
                  Title {image ? "(optional)" : "(optional, otherwise taken from the text)"}
                </label>
                <input id="edit-title" name="title" maxLength={100} autoComplete="off" value={title} onChange={(e) => setTitle(e.target.value)} className={`${field} mt-1 max-w-md`} />
                {image && (
                  <>
                    <label htmlFor="edit-alt" className="mt-3 block text-muted">
                      Alternative text (optional, for screen readers)
                    </label>
                    <input id="edit-alt" name="alt" maxLength={500} autoComplete="off" value={alt} onChange={(e) => setAlt(e.target.value)} className={`${field} mt-1 max-w-md`} />
                  </>
                )}
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
            ) : (
              <form onSubmit={remove} className="text-center lg:text-left">
                <p className="text-muted">
                  <span className="block text-[17px] font-bold text-ink">Delete this note?</span> This can&apos;t be undone.
                </p>
                <div className="mt-4 flex flex-col gap-2 lg:flex-row">
                  <button type="submit" disabled={pending} className={`${primary} bg-error`}>
                    <Trash2 aria-hidden className="h-4 w-4" />
                    Delete note
                  </button>
                  <button type="button" onClick={() => setMode(null)} className={secondary}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </>
      )}
      <p id="note-actions-error" role="alert" className="mt-2 text-error empty:hidden">
        {error}
      </p>
    </section>
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

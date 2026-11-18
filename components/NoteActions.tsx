"use client";

import Link from "next/link";
import { BackIcon, DeleteIcon, DoneIcon, EditIcon, NoteLinkIcon, ReportIcon } from "@/components/icons";
import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { copyText } from "@/components/copy";
import { card, primary, secondary, sectionLabel } from "@/components/styles";
import { deleteNote } from "@/app/_lib/api";
import { useApiForm } from "@/app/_lib/useApiForm";
import { messagesFor } from "@/app/_lib/messages";
import { useCopy } from "@/components/CopyProvider";

// Delete for a note, through the generated API client, with refusals shown inline (`error` is a first message to show). Edit
// opens the feed page's compose box with the note in it (components/Compose.tsx, `edit`): one box writes and edits notes.
// The state of the note page's actions, for the two places they show: the bar (NoteActionsBar, in the shell's right column)
// and the dialog (NoteActionsPanel, under the note). `reportHref`: the note's Report link, in the bar (the note shows none).
export function NoteActions({
  feed,
  id,
  error: initialError,
  reportHref,
  children,
}: {
  feed: string;
  id: string;
  error?: string;
  reportHref?: string;
  children: ReactNode;
}) {
  const page = `/${feed}`;
  const { noteErrorMessage } = messagesFor(useCopy());
  const { run, error, pending, router } = useApiForm(page, initialError, noteErrorMessage);
  const [mode, setMode] = useState<"delete" | null>(null);

  const remove = (e: FormEvent) =>
    run(
      e,
      () => deleteNote({ baseUrl: window.location.origin, path: { feed, id } }),
      () => router.replace(`${page}?deleted=${id}`),
      404,
    ); // already gone: the goal is met

  const [copied, setCopied] = useState(false);
  const copyLink = () =>
    copyText(window.location.href).then(
      () => setCopied(true),
      () => {},
    );

  const value = { back: page, editHref: `${page}?edit=${encodeURIComponent(id)}`, mode, setMode, remove, pending, error, copied, copyLink, reportHref };
  return <Actions.Provider value={value}>{children}</Actions.Provider>;
}

type ActionsState = {
  back: string;
  editHref: string;
  mode: "delete" | null;
  setMode: (m: "delete" | null) => void;
  remove: (e: FormEvent) => void;
  pending: boolean;
  error?: string;
  copied: boolean;
  copyLink: () => void;
  reportHref?: string;
};
const Actions = createContext<ActionsState | null>(null);
const useActions = () => useContext(Actions)!;

// Delete asks in a dialog (DeleteDialog); a refusal shown on arrival (`error`) goes under the note.
export function NoteActionsPanel() {
  const { mode, setMode, remove, pending, error } = useActions();
  const t = useCopy().noteActions;
  return (
    <section aria-label={t.panel} className="mt-4 text-sm">
      {mode === "delete" && <DeleteDialog onSubmit={remove} onClose={() => setMode(null)} pending={pending} error={error} />}
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
  const t = useCopy().noteActions;
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
          {t.deleteTitle}
        </h2>
        <p id="delete-note-text" className="mt-1 text-muted">
          {t.cantUndo}
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button type="submit" disabled={pending} className={`${primary} bg-error`}>
            <DeleteIcon aria-hidden className="h-4 w-4" />
            {t.deleteNote}
          </button>
          <button ref={cancel} type="button" onClick={onClose} className={secondary}>
            {t.cancel}
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
  const { back, editHref, mode, setMode, copied, copyLink, reportHref } = useActions();
  const t = useCopy().noteActions;
  const button =
    "inline-flex min-w-16 flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-[11px] hover:bg-surface-2 xl:min-w-0 xl:flex-row xl:gap-3 xl:px-3 xl:py-2 xl:text-[14px]";
  return (
    <nav
      aria-label={t.bar}
      className="flex items-center justify-around bg-surface max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-30 max-lg:border-t max-lg:border-rule max-lg:px-[max(0.75rem,env(safe-area-inset-left),env(safe-area-inset-right))] max-lg:pt-1.5 max-lg:pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:justify-start lg:gap-2 lg:rounded-2xl lg:border lg:border-rule lg:p-1.5 lg:shadow-card xl:flex-col xl:items-stretch xl:gap-0.5 xl:p-2"
    >
      <p className={`${sectionLabel} hidden px-3 pb-1 pt-1.5 xl:block`}>{t.thisNote}</p>
      <Link href={editHref} className={button}>
        <EditIcon aria-hidden className="h-5 w-5" />
        {t.edit}
      </Link>
      <button type="button" onClick={copyLink} className={button}>
        {copied ? <DoneIcon aria-hidden className="h-5 w-5" /> : <NoteLinkIcon aria-hidden className="h-5 w-5" />}
        <span aria-live="polite">{copied ? t.copied : t.copyLink}</span>
      </button>
      {reportHref && (
        <a href={reportHref} rel="nofollow noopener" className={button}>
          <ReportIcon aria-hidden className="h-5 w-5" />
          {t.report}
        </a>
      )}
      <button type="button" aria-pressed={mode === "delete"} onClick={() => setMode(mode === "delete" ? null : "delete")} className={`${button} text-error`}>
        <DeleteIcon aria-hidden className="h-5 w-5" />
        {t.delete}
      </button>
      {/* Not on a phone, where the "All notes" link above the note is at hand: first in the row from lg, last in the right
          column from xl (the note's own link is hidden from lg). */}
      <div className="hidden lg:order-first lg:mr-auto lg:flex xl:order-none xl:mr-0 xl:flex-col">
        <div className="mx-2 my-1 hidden border-t border-rule xl:block" />
        <Link href={back} className={`${button} text-carbon`}>
          <BackIcon aria-hidden className="h-5 w-5" />
          {t.allNotes}
        </Link>
      </div>
    </nav>
  );
}

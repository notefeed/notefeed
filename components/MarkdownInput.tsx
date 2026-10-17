"use client";

import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ClipboardEvent, type DragEvent, type ReactNode } from "react";
import { Eye, ImagePlus, PenLine, X } from "lucide-react";
import { NoteView } from "@/components/NoteView";
import { type Pending, addPending, removeReference } from "@/components/pendingFiles";
import { IMAGES_OFF, TOO_MANY_PICTURES } from "@/app/_lib/messages";

const ACCEPT = "image/png,image/jpeg,image/gif,image/webp";

// The note textarea of the compose box and the editor, with pictures: the "Add image" button, paste and drag-and-drop each add the
// files to `pending` (the parent owns the list and posts it, see usePendingImages) and write `![](name)` at the cursor, with a
// name made from the file's (uniqueToken: safe to write in a link, and unlike the others'). Nothing is uploaded here, so leaving the page uploads nothing. The button and the list only exist once hydrated,
// so without JavaScript only the textarea renders. A note takes a limited number of pictures (MAX_ATTACHMENTS): of more,
// the ones that fit are added and `onMessage` sets the reason, for the parent to show where it shows its errors; removing a picture clears it.
// A Preview toggle in the toolbar (issue #146; tabs Write and Preview before #185): the preview renders the text with the components the note pages use, so it
// cannot differ from the posted note, with the waiting pictures shown from their files and the stored ones from `imageBase` (the feed's
// read link). The textarea is hidden, not unmounted, while previewing, so the text, the cursor and the form's submit stay as they are.
// `images` false (NOTEFEED_IMAGE_UPLOADS=0, issue #152): no button, and a dropped or pasted file is refused with the reason in its place.
export function MarkdownInput({ id, name, label, value, onChange, rows, placeholder, describedBy, className = "", pending, onPendingChange, onMessage, images = true, imageBase, bare = false, above, below, children }: {
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
  bare?: boolean; // the text is the card's content: no border of its own, the toolbar spans the card
  above?: ReactNode; // fields above the text (the title)
  below?: ReactNode; // fields below the text and the waiting pictures (the tags)
  children?: ReactNode; // more controls at the end of the toolbar (the post button)
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [height, setHeight] = useState<number>(); // the text box's height when the preview opened: the preview keeps it, so nothing jumps
  const previewing = hydrated && tab === "preview";
  // A waiting picture, by the name the text calls it (its token): shown from its file, before anything is uploaded.
  const resolve = (src: string) => pending.find((p) => p.token === src)?.preview;
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
    const { added, leftOut } = addPending(pending, files);
    if (leftOut) onMessage(() => TOO_MANY_PICTURES);
    if (!added.length) return;
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

  const plain = bare ? "border-0 bg-transparent px-0 py-1 focus-visible:outline-none" : "rounded-xl border border-rule bg-surface-2/60 p-3 focus:border-carbon";

  return (
    <>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      {above}
      {previewing && (
        <div id={`${id}-preview`} role="region" aria-label="Preview" style={{ minHeight: height }} className={`box-border ${bare ? "py-1" : "rounded-xl border border-rule p-3"}`}>
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
        className={`block w-full resize-y text-[15px] leading-relaxed text-ink placeholder:text-muted focus:outline-none ${plain} ${className}`}
      />
      {hydrated && pending.length > 0 && (
        <ul aria-label="Images to post" className="mt-2 flex flex-wrap gap-2 text-sm">
          {pending.map((p) => (
            <li key={p.key} className="relative" title={p.token}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.preview} alt="" className="h-16 w-16 rounded-xl border border-rule object-cover" />
              <span className="sr-only">{p.token}</span>
              <button type="button" onClick={() => remove(p)} aria-label={`Remove ${p.token}`} className="absolute -right-1.5 -top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-ink text-paper">
                <X aria-hidden className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {below}
      <div className={`mt-2 flex flex-wrap items-center gap-1 text-sm ${bare ? "-mx-4 border-t border-rule px-3 pt-2" : ""}`}>
        {hydrated && (
          // One toggle: the eye shows the preview, the pencil goes back to the text. Its name stays "Preview"; aria-pressed says which.
          <button
            type="button"
            aria-pressed={previewing}
            aria-controls={`${id}-preview`}
            aria-label="Preview"
            title={previewing ? "Back to writing" : "Preview"}
            onClick={() => {
              if (!previewing) setHeight(area.current?.offsetHeight);
              setTab(previewing ? "write" : "preview");
            }}
            className={`inline-flex h-9 w-9 items-center justify-center rounded-full ${previewing ? "bg-carbon-soft text-carbon" : "text-muted hover:bg-surface-2 hover:text-ink"}`}
          >
            {previewing ? <PenLine aria-hidden className="h-[18px] w-[18px]" /> : <Eye aria-hidden className="h-[18px] w-[18px]" />}
          </button>
        )}
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
            <button type="button" onClick={() => picker.current?.click()} aria-label="Add image" title="Add image" className="inline-flex h-9 w-9 items-center justify-center rounded-full text-carbon hover:bg-surface-2">
              <ImagePlus aria-hidden className="h-[18px] w-[18px]" />
            </button>
          </>
        )}
        {children}
      </div>
    </>
  );
}

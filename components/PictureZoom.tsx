"use client";

import { useRef, type MouseEvent, type ReactNode } from "react";
import { CloseIcon } from "@/components/icons";
import { useCopy } from "@/components/CopyProvider";

// A picture of a note on the note's page (#418): a click opens it enlarged in a dialog over the page, as a diagram does (#301): Esc,
// the close button or a click beside it closes it. The picture's own page, the address to share it, stays one link away in the dialog.
// It is a link to that page underneath: without JavaScript, and with a modifier key (a new tab), the click goes there as before.
export function PictureZoom({ page, src, alt, children }: { page: string; src: string; alt: string; children: ReactNode }) {
  const t = useCopy().picture;
  const dialog = useRef<HTMLDialogElement>(null);
  const open = (e: MouseEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    dialog.current?.showModal();
  };
  return (
    <>
      <a href={page} onClick={open} title={t.enlarge} className="block w-fit cursor-zoom-in">
        {children}
      </a>
      <dialog
        ref={dialog}
        aria-label={alt || t.picture}
        onClick={(e) => e.target === e.currentTarget && dialog.current?.close()}
        className="picture-enlarged m-auto h-[calc(100dvh-2rem)] max-h-none w-[calc(100vw-2rem)] max-w-none bg-transparent p-0 backdrop:bg-black/85"
      >
        <div onClick={(e) => e.target === e.currentTarget && dialog.current?.close()} className="flex h-full flex-col">
          <div className="flex items-center justify-end gap-2 p-2 text-[14px]">
            <a href={page} className="rounded-full px-3 py-1.5 hover:bg-white/10">
              {t.page}
            </a>
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              aria-label={t.close}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-white/85 hover:bg-white/10 hover:text-white"
            >
              <CloseIcon aria-hidden className="h-5 w-5" />
            </button>
          </div>
          <div onClick={(e) => e.target === e.currentTarget && dialog.current?.close()} className="flex min-h-0 flex-1 items-center justify-center px-2 pb-2">
            {/* The same file as on the page, already fetched: as large as the screen allows, never past its own size. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={alt} className="max-h-full max-w-full object-contain" />
          </div>
        </div>
      </dialog>
    </>
  );
}

"use client";

import { useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { CloseIcon, NextIcon, PreviousIcon } from "@/components/icons";
import { useCopy } from "@/components/CopyProvider";

// A note's pictures, enlarged (#418): a click on one opens it in a dialog over the page, as a diagram does (#301), in the feed and on
// the note's page. `Lightbox` holds one note's pictures: the arrows (and the arrow keys) step through them in the order the note shows
// them, as does a swipe, which slides them. Esc, the close button or a click beside the picture closes it. A picture with a page of its own keeps that page, the address
// to share it, one link away in the dialog.

/** A picture that enlarges: a link to its page (else the file) underneath, which a click without JavaScript or with a modifier follows. */
export function ZoomLink({ src, page, className = "block w-fit", children }: { src: string; page?: string; className?: string; children: ReactNode }) {
  const t = useCopy().picture;
  return (
    <a href={page ?? src} data-zoom={src} data-page={page} title={t.enlarge} className={`${className} cursor-zoom-in`}>
      {children}
    </a>
  );
}

type Item = { src: string; alt: string; page?: string };

const SLIDE_MS = 200;

/** One note's pictures (its `ZoomLink`s) and the dialog that shows them enlarged. */
export function Lightbox({ children }: { children: ReactNode }) {
  const t = useCopy().picture;
  const box = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [at, setAt] = useState(0);
  const touch = useRef<number | null>(null);

  const open = (e: MouseEvent) => {
    const link = (e.target as Element).closest<HTMLAnchorElement>("a[data-zoom]");
    if (!link || !box.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    const links = [...box.current.querySelectorAll<HTMLAnchorElement>("a[data-zoom]")];
    setItems(links.map((l) => ({ src: l.dataset.zoom!, alt: l.querySelector("img")?.alt ?? "", page: l.dataset.page })));
    setAt(links.indexOf(link));
    dialog.current?.showModal();
  };
  const close = () => dialog.current?.close();
  const step = (by: number) => setAt((i) => (i + by + items.length) % items.length);
  // A swipe's slide: out to the side the finger went, then the next picture in from the other side. Without motion, at once.
  const [slide, setSlide] = useState({ x: 0, eased: false });
  const swipe = (by: number) => {
    const width = window.innerWidth;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setSlide({ x: 0, eased: false });
      return step(by);
    }
    setSlide({ x: -by * width, eased: true });
    window.setTimeout(() => {
      step(by);
      setSlide({ x: by * width, eased: false });
      requestAnimationFrame(() => requestAnimationFrame(() => setSlide({ x: 0, eased: true })));
    }, SLIDE_MS);
  };
  const keys = (e: KeyboardEvent) => {
    if (items.length < 2) return;
    if (e.key === "ArrowLeft") step(-1);
    else if (e.key === "ArrowRight") step(1);
  };
  const beside = (e: MouseEvent) => e.target === e.currentTarget && close();
  const item = items[at];
  const many = items.length > 1;
  const round = "inline-flex h-10 w-10 items-center justify-center rounded-full text-white/85 hover:bg-white/10 hover:text-white";
  const arrow = "absolute top-1/2 -translate-y-1/2 inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/45 text-white hover:bg-black/70";

  return (
    <div ref={box} onClick={open}>
      {children}
      <dialog
        ref={dialog}
        aria-label={item?.alt || t.picture}
        // A click in the dialog stays in it: a note's card (NoteCard) would take it as a click to open the note.
        onClick={(e) => {
          e.stopPropagation();
          beside(e);
        }}
        onKeyDown={keys}
        className="picture-enlarged m-auto h-[calc(100dvh-2rem)] max-h-none w-[calc(100vw-2rem)] max-w-none cursor-default bg-transparent p-0 backdrop:bg-black/85"
      >
        {item && (
          <div onClick={beside} className="flex h-full flex-col">
            <div className="flex items-center justify-end gap-2 p-2 text-[14px] text-white/85">
              {many && <span className="mr-auto px-3 tabular-nums">{t.position(at + 1, items.length)}</span>}
              {item.page && (
                <a href={item.page} className="rounded-full px-3 py-1.5 text-white/85 hover:bg-white/10 hover:text-white">
                  {t.page}
                </a>
              )}
              <button type="button" onClick={close} aria-label={t.close} className={round}>
                <CloseIcon aria-hidden className="h-5 w-5" />
              </button>
            </div>
            {/* The arrows lie over the picture's edges, so a phone's narrow screen gives the picture its whole width. A swipe moves the
                picture with the finger; let go past 50 px, it slides out and the next one slides in, else it slides back. */}
            <div
              onClick={beside}
              onTouchStart={(e) => {
                if (!many) return;
                touch.current = e.touches[0].clientX;
                setSlide({ x: 0, eased: false });
              }}
              onTouchMove={(e) => touch.current !== null && setSlide({ x: e.touches[0].clientX - touch.current, eased: false })}
              onTouchEnd={(e) => {
                if (touch.current === null) return;
                const dx = e.changedTouches[0].clientX - touch.current;
                touch.current = null;
                if (Math.abs(dx) > 50) swipe(dx < 0 ? 1 : -1);
                else setSlide({ x: 0, eased: true });
              }}
              className="relative flex min-h-0 flex-1 touch-pan-y items-center justify-center overflow-hidden px-2 pb-2"
            >
              {/* The same file as in the note, already fetched: as large as the screen allows, never past its own size. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={item.src}
                src={item.src}
                alt={item.alt}
                style={{ transform: `translateX(${slide.x}px)`, transition: slide.eased ? `transform ${SLIDE_MS}ms ease-out` : "none" }}
                className="max-h-full max-w-full object-contain"
              />
              {many && (
                <>
                  <button type="button" onClick={() => step(-1)} aria-label={t.previous} className={`${arrow} left-2`}>
                    <PreviousIcon aria-hidden className="h-6 w-6" />
                  </button>
                  <button type="button" onClick={() => step(1)} aria-label={t.next} className={`${arrow} right-2`}>
                    <NextIcon aria-hidden className="h-6 w-6" />
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}

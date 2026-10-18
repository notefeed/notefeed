import Link from "next/link";
import type { ReactNode } from "react";
import { card, secondary } from "@/components/styles";

// A page of its own for what is missing or broken (app/not-found.tsx, app/error.tsx, app/global-error.tsx): the logo, what happened in a
// sentence or two, and the way on. No server code, so the client error boundaries can use it too; never an error's own message.
export function ErrorPage({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[42rem] flex-col px-[max(1rem,env(safe-area-inset-left),env(safe-area-inset-right))] py-6 sm:py-10">
      <Link href="/" className="inline-flex items-center gap-2.5 self-start" aria-label="notefeed home">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" className="h-8 w-8" />
        <span className="text-xl font-bold tracking-tight">notefeed</span>
      </Link>
      <div className={`${card} mt-8 p-6`}>
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        <div className="mt-2 space-y-2 text-muted">{children}</div>
        <div className="mt-5 flex flex-wrap gap-2">
          {actions}
          <Link href="/" className={secondary}>
            Go to the start page
          </Link>
        </div>
      </div>
    </main>
  );
}

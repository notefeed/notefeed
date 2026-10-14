import Link from "next/link";
import { connection } from "next/server";
import { Footer } from "@/components/LegalLinks";

// The plain pages (home, the operator's legal pages, the license page, login, report): the logo, one column, the footer.
export default async function SiteLayout({ children }: LayoutProps<"/">) {
  await connection(); // the footer looks for the operator's files on every request
  return (
    <div className="mx-auto flex min-h-dvh max-w-[42rem] flex-col px-4 py-6 sm:py-10">
      <Link href="/" className="mb-8 inline-flex items-center gap-2.5 self-start" aria-label="notefeed home">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" className="h-8 w-8" />
        <span className="text-xl font-bold tracking-tight">notefeed</span>
      </Link>
      <div className="flex-1">{children}</div>
      <Footer className="mt-12 border-t border-rule pt-4" />
    </div>
  );
}

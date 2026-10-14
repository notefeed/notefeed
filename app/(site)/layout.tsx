import Link from "next/link";
import { connection } from "next/server";
import { InfoMenu, hasSession } from "@/components/AppShell";
import { Footer, footerLinks } from "@/components/LegalLinks";

// The plain pages (home, the operator's legal pages, the license page, login, report): the logo and the ⓘ menu, one
// column, the footer (both: the footer is the plain, labelled way to the imprint).
export default async function SiteLayout({ children }: LayoutProps<"/">) {
  await connection(); // the footer looks for the operator's files on every request
  const [links, loggedIn] = await Promise.all([footerLinks(), hasSession()]);
  return (
    <div className="mx-auto flex min-h-dvh max-w-[42rem] flex-col px-4 py-6 sm:py-10">
      <div className="mb-8 flex items-center justify-between">
        <Link href="/" className="inline-flex items-center gap-2.5" aria-label="notefeed home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" className="h-8 w-8" />
          <span className="text-xl font-bold tracking-tight">notefeed</span>
        </Link>
        <InfoMenu links={links} loggedIn={loggedIn} />
      </div>
      <div className="flex-1">{children}</div>
      <Footer className="mt-12 border-t border-rule pt-4" />
    </div>
  );
}

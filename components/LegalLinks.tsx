import Link from "next/link";
import { serverCopy } from "@/app/_lib/copy";
import { hasLegalPage, licensePageOn, footerFeedLinks, runningVersion, supportEmail, type RunningVersion } from "@/backend";

export type FooterLink = { href: string; label: string; external?: boolean };

// The product links with the feeds the operator lists (NOTEFEED_FOOTER_FEEDS: releases, a blog) after them, and the operator's legal pages. The imprint, privacy and terms pages are the operator's own files
// (backend/legal.ts), looked for on every request: a link only where there is a page; the license page only while
// the instance sells licenses and has its license.md (ADR 0035); a Support link where the operator gave an address.
export async function footerLinks(): Promise<{ product: FooterLink[]; legal: FooterLink[]; version: RunningVersion }> {
  const [t, imprint, privacy, terms, license, feeds] = await Promise.all([
    serverCopy(),
    hasLegalPage("imprint"),
    hasLegalPage("privacy"),
    hasLegalPage("terms"),
    licensePageOn(),
    footerFeedLinks(),
  ]);
  return {
    product: [
      { href: "https://docs.notefeed.me/", label: t.footer.docs, external: true },
      { href: "https://docs.notefeed.me/values/", label: t.footer.values, external: true }, // what notefeed stands for (docs/values.md)
      { href: "https://github.com/notefeed/notefeed", label: t.footer.github, external: true },
      ...(license ? [{ href: "/license", label: t.pages.license }] : []),
      ...feeds,
    ],
    legal: [
      ...(imprint ? [{ href: "/imprint", label: t.pages.imprint }] : []),
      ...(privacy ? [{ href: "/privacy", label: t.pages.privacy }] : []),
      ...(terms ? [{ href: "/terms", label: t.pages.terms }] : []),
      ...(supportEmail() ? [{ href: `mailto:${supportEmail()}`, label: t.footer.support, external: true }] : []),
    ],
    version: runningVersion(), // the version it runs (#306), under the links
  };
}

function FooterAnchor({ link }: { link: FooterLink }) {
  const className = "hover:text-ink hover:underline";
  return link.external ? (
    <a href={link.href} className={className}>
      {link.label}
    </a>
  ) : (
    <Link href={link.href} className={className}>
      {link.label}
    </Link>
  );
}

// The footer: the product links on the left, the legal ones on the right, as the ⓘ menu groups them; each group wraps
// on its own, and the legal one moves under the product one where the line is too short for both.
export async function Footer({ className = "" }: { className?: string }) {
  const { product, legal, version } = await footerLinks();
  const group = (links: FooterLink[]) => (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {links.map((l) => (
        <FooterAnchor key={l.href} link={l} />
      ))}
    </div>
  );
  return (
    <footer className={`flex flex-wrap justify-between gap-x-8 gap-y-2 text-[13px] text-muted ${className}`}>
      {group(product)}
      {legal.length > 0 && group(legal)}
      <a href={version.url} className="w-full font-mono text-[12px] hover:text-ink hover:underline">
        {version.label}
      </a>
    </footer>
  );
}

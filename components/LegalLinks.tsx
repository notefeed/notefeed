import Link from "next/link";
import { hasLegalPage, licensePageOn } from "@/backend";

export type FooterLink = { href: string; label: string; external?: boolean };

// The product links and the operator's legal pages. The imprint, privacy and terms pages are the operator's own files
// (backend/legal.ts), looked for on every request: a link only where there is a page; the license page only while
// the instance sells licenses and has its license.md (ADR 0035).
export async function footerLinks(): Promise<{ product: FooterLink[]; legal: FooterLink[] }> {
  const [imprint, privacy, terms, license] = await Promise.all([hasLegalPage("imprint"), hasLegalPage("privacy"), hasLegalPage("terms"), licensePageOn()]);
  return {
    product: [
      { href: "https://docs.notefeed.me/", label: "Docs", external: true },
      { href: "https://github.com/notefeed/notefeed", label: "GitHub", external: true },
      ...(license ? [{ href: "/license", label: "License" }] : []),
    ],
    legal: [...(imprint ? [{ href: "/imprint", label: "Imprint" }] : []), ...(privacy ? [{ href: "/privacy", label: "Data privacy" }] : []), ...(terms ? [{ href: "/terms", label: "Terms" }] : [])],
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

// The footer: the product links, then the legal ones, on one line that wraps where it has to.
export async function Footer({ className = "" }: { className?: string }) {
  const { product, legal } = await footerLinks();
  return (
    <footer className={`flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted ${className}`}>
      {[...product, ...legal].map((l) => (
        <FooterAnchor key={l.href} link={l} />
      ))}
    </footer>
  );
}

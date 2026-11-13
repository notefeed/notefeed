import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { publicUrl } from "@/backend";
import { CopyProvider } from "@/components/CopyProvider";
import { copyFor, isLocale, LOCALES } from "@/shared/copy";
import { ServiceWorker } from "@/components/ServiceWorker";
import { mono, sans } from "../fonts";
import "../globals.css";

// metadataBase makes the share image's URL absolute, on whatever host this instance is reached.
export async function generateMetadata({ params }: LayoutProps<"/[lang]">): Promise<Metadata> {
  return {
    metadataBase: new URL(publicUrl(await headers())),
    title: { default: "notefeed", template: "%s · notefeed" },
    description: copyFor((await params).lang).site.description,
  };
}

// The languages the UI speaks; the proxy only ever rewrites to one of them (#352).
export const generateStaticParams = () => LOCALES.map((lang) => ({ lang }));

// `viewportFit: "cover"`: the page reaches into the screen's rounded corners and under the home indicator, and the bars
// at a phone's edges keep clear of them with env(safe-area-inset-*) (issue #202).
export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { color: "#f2f3f0", media: "(prefers-color-scheme: light)" },
    { color: "#15161b", media: "(prefers-color-scheme: dark)" },
  ],
};

// The document only: the plain pages (app/[lang]/(site)/layout.tsx) and a feed's pages (components/AppShell.tsx) bring their own
// frame. Its language is the page's, from the proxy's rewrite (#352).
export default async function RootLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  return (
    <html lang={lang} className={`${sans.variable} ${mono.variable} antialiased`}>
      <body className="font-sans text-base leading-relaxed">
        <CopyProvider lang={lang}>{children}</CopyProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}

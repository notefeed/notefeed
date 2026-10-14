import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next } from "next/font/google";
import { publicUrl, shrinkImageBytes } from "@/backend";
import "./globals.css";

const sans = Atkinson_Hyperlegible_Next({ variable: "--font-atkinson", subsets: ["latin"] });
const mono = Atkinson_Hyperlegible_Mono({ variable: "--font-atkinson-mono", subsets: ["latin"] });

const description = "Markdown notes and RSS. Post from where you need it, follow where you want.";

// metadataBase makes the share image's URL absolute, on whatever host this instance is reached.
export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: new URL(publicUrl(await headers())),
    title: { default: "notefeed", template: "%s · notefeed" },
    description,
  };
}

export const viewport: Viewport = { themeColor: [{ color: "#f2f3f0", media: "(prefers-color-scheme: light)" }, { color: "#15161b", media: "(prefers-color-scheme: dark)" }] };

// The document only: the plain pages (app/(site)/layout.tsx) and a feed's pages (components/AppShell.tsx) bring their own frame.
// `data-shrink-image-bytes`: NOTEFEED_SHRINK_IMAGE_BYTES, for the browser code that uploads pictures (app/_lib/shrinkImage.ts).
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-shrink-image-bytes={shrinkImageBytes()} className={`${sans.variable} ${mono.variable} antialiased`}>
      <body className="font-sans text-base leading-relaxed">{children}</body>
    </html>
  );
}

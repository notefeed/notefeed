import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "notefeed",
    short_name: "notefeed",
    description: "Markdown notes and RSS. Post from where you need it, follow where you want.",
    start_url: "/",
    display: "standalone",
    background_color: "#f2f3f0",
    theme_color: "#f2f3f0",
    // Android: an installed notefeed is in the share sheet. What is shared goes to the start page, which asks for the feed
    // and hands it to that feed's compose box (issue #185; pictures need a POST target and are not taken yet, #148).
    share_target: { action: "/", method: "GET", params: { title: "share_title", text: "share_text", url: "share_url" } },
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

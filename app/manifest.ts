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
    // Android: an installed notefeed is in the share sheet for text, links and pictures (issues #185 and #148). The POST to
    // /api/share is the service worker's (public/sw.js, ADR 0048): it keeps the pictures in the browser and goes on to the start
    // page, which asks for the feed and hands everything to that feed's compose box. No server route answers it.
    share_target: {
      action: "/api/share",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "share_title",
        text: "share_text",
        url: "share_url",
        files: [{ name: "files", accept: ["image/png", "image/jpeg", "image/gif", "image/webp"] }],
      },
    },
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

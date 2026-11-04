"use client";

import { useEffect } from "react";

// Installs public/sw.js, which only takes what other apps share to notefeed (ADR 0048). Rendered once, by the root layout.
export function ServiceWorker() {
  useEffect(() => {
    navigator.serviceWorker?.register("/sw.js").catch(() => {}); // sharing pictures just isn't offered then
  }, []);
  return null;
}

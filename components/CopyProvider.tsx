"use client";
import { createContext, useContext, type ReactNode } from "react";
import { copyFor, DEFAULT_LOCALE, type Copy, type Locale } from "@/shared/copy";

// The page's language for client components (#352). Only the locale crosses from the server: the copy modules hold functions,
// which can't be passed as props, so each client component takes its words from the module itself.
const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function CopyProvider({ lang, children }: { lang: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={lang}>{children}</LocaleContext.Provider>;
}

export const useLocale = (): Locale => useContext(LocaleContext);
export const useCopy = (): Copy => copyFor(useContext(LocaleContext));

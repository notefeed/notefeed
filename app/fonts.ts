import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next } from "next/font/google";

// The UI's fonts, for every document: the root layout (app/[lang]/layout.tsx) and the 404 for unmatched addresses (app/global-not-found.tsx).
export const sans = Atkinson_Hyperlegible_Next({ variable: "--font-atkinson", subsets: ["latin"] });
export const mono = Atkinson_Hyperlegible_Mono({ variable: "--font-atkinson-mono", subsets: ["latin"] });

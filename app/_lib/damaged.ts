import { UnreadableNoteError } from "@/backend";

// A note page's read: "damaged" for a note whose stored copy can't be decrypted (the page shows DamagedNote), anything else as it is.
export const orDamaged = <T>(read: Promise<T>): Promise<T | "damaged"> => read.catch((e) => (e instanceof UnreadableNoteError ? ("damaged" as const) : Promise.reject(e)));

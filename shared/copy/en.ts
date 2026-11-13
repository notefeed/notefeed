// The UI in English: the reference every other language is checked against (copy.test.ts). Grouped by where the words show.
// A value is a string, or a function when the sentence takes a value; other languages give the same keys and the same kinds.
export const en = {
  site: {
    description: "Markdown notes and RSS. Post from where you need it, follow where you want.",
  },
};

// Every language has these keys, with a string where English has one and a function of the same arguments where it has one.
type Widen<T> = T extends string ? string : T extends (...a: infer A) => string ? (...a: A) => string : { [K in keyof T]: Widen<T[K]> };
export type Copy = Widen<typeof en>;

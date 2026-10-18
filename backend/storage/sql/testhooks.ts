// Test support: a Kysely plugin to put another write between two of the storage's statements.
import type { KyselyPlugin } from "kysely";

// Runs `run` once, right after the first query whose row has exactly these columns: a way to put another write between two of the
// storage's statements.
export function after(columns: string[], run: () => Promise<void>): KyselyPlugin {
  let done = false;
  return {
    transformQuery: (a) => a.node,
    async transformResult(a) {
      const row = a.result.rows[0] as object | undefined;
      if (!done && row && Object.keys(row).sort().join() === [...columns].sort().join()) {
        done = true;
        await run();
      }
      return a.result;
    },
  };
}

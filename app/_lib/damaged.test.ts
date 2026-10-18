import { expect, test } from "vitest";
import { UnreadableNoteError } from "@/backend";
import { orDamaged } from "./damaged";

test("a damaged note is 'damaged'; a note or none comes through; anything else still throws", async () => {
  expect(await orDamaged(Promise.reject(new UnreadableNoteError()))).toBe("damaged");
  expect(await orDamaged(Promise.resolve(null))).toBeNull();
  expect(await orDamaged(Promise.resolve(1))).toBe(1);
  await expect(orDamaged(Promise.reject(new Error("disk")))).rejects.toThrow("disk");
});

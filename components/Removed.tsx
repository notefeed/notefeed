import { serverCopy } from "@/app/_lib/copy";

// What a feed the operator removed answers under its name and its read id (issue #155): never an empty feed, never a compose box.
export async function Removed() {
  const t = await serverCopy();
  return (
    <p role="status" className="text-muted">
      {t.removed.feed}
    </p>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BuyLicense } from "@/components/BuyLicense";
import { NoteView } from "@/components/NoteView";
import { freeNoteCap, licensePlans, licensingOn, readLicensePage } from "@/backend";

export const metadata: Metadata = { title: "License" };

export const dynamic = "force-dynamic"; // whether licenses are sold is the instance's setting, and license.md is read on every request

export default async function LicensePage() {
  if (!licensingOn()) notFound(); // self-hosted: everything is open, nothing to buy
  const text = await readLicensePage();
  if (!text) notFound(); // license.md removed or broken since the start: the operator's to fix
  return (
    <main>
      <h1 className="mb-2 text-3xl font-bold tracking-tight">License</h1>
      <BuyLicense
        text={text}
        intro={text.intro && <NoteView markdown={text.intro} />}
        fineprint={text.fineprint && <NoteView markdown={text.fineprint} />}
        plans={await licensePlans()}
        cap={freeNoteCap()}
      />
    </main>
  );
}

import { notFound } from "next/navigation";
import { accountsMode, safeNext } from "@/backend";
import { CreateAccount } from "@/components/CreateAccount";
import { copyFor } from "@/shared/copy";

export const dynamic = "force-dynamic";

// Creating an account, where anyone may (accounts `open`); elsewhere the operator creates them, or the identity provider does.
export default async function NewAccountPage({ params, searchParams }: PageProps<"/[lang]/account/new">) {
  const t = copyFor((await params).lang).account;
  if (accountsMode() !== "open") notFound();
  const { next } = await searchParams;
  return (
    <main>
      <h1 className="mb-4 text-xl font-bold tracking-tight">{t.newTitle}</h1>
      <p className="mb-6 max-w-md text-muted">{t.newIntro}</p>
      <CreateAccount next={safeNext(next)} />
    </main>
  );
}

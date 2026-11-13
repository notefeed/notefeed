import type { Metadata } from "next";
import { copyFor } from "@/shared/copy";
import { LegalPage } from "@/components/LegalPage";

export const generateMetadata = async ({ params }: PageProps<"/[lang]/terms">): Promise<Metadata> => ({
  title: copyFor((await params).lang).pages.terms,
});

export const dynamic = "force-dynamic"; // the operator's file is read on every request

export default function Page() {
  return <LegalPage which="terms" />;
}

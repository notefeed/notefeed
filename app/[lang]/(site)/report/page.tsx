import type { Metadata } from "next";
import { copyFor } from "@/shared/copy";
import { notFound } from "next/navigation";
import { reportEndpoint } from "@/backend";
import { ReportForm, Sent, type ReportValues } from "@/components/ReportForm";

export const generateMetadata = async ({ params }: PageProps<"/[lang]/report">): Promise<Metadata> => ({
  title: copyFor((await params).lang).pages.report,
  robots: { index: false, follow: false },
});

export const dynamic = "force-dynamic"; // the endpoint is read on every request

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));
const all = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]);

// The built-in report page (issue #156): the "Report" link on a note opens it with the note's ids in the query, and
// the form posts to the operator's inbox (NOTEFEED_REPORT_ENDPOINT). notefeed stores nothing (ADR 0026). Without an
// endpoint there is no page.
export default async function ReportPage({ params, searchParams }: PageProps<"/[lang]/report">) {
  const t = copyFor((await params).lang);
  const endpoint = reportEndpoint();
  if (!endpoint) notFound();
  const q = await searchParams;
  const values: ReportValues = {
    read_id: one(q.read_id).slice(0, 200),
    note_id: one(q.note_id).slice(0, 200),
    file: one(q.file).slice(0, 200),
    reason: one(q.reason).slice(0, 200),
    text: one(q.text).slice(0, 4000),
    name: one(q.name).slice(0, 200),
    email: one(q.email).slice(0, 254),
    good_faith: one(q.good_faith).slice(0, 10),
  };
  const errors = all(q.error)
    .slice(0, 10)
    .map((e) => e.slice(0, 200));
  const sent = one(q.sent) === "1";
  return (
    <main>
      <h1 className="text-2xl font-bold tracking-tight">{sent ? t.reportPage.sent : t.pages.report}</h1>
      {sent ? (
        <div className="mt-4">
          <Sent />
        </div>
      ) : (
        <>
          <p className="mt-1 mb-6 max-w-prose text-muted">{t.reportPage.intro}</p>
          <ReportForm endpoint={endpoint} values={values} errors={errors} />
        </>
      )}
    </main>
  );
}

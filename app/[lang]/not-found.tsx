import { serverCopy } from "@/app/_lib/copy";
import { ErrorPage } from "@/components/ErrorPage";

// Every notFound() and every unknown page: in words, never Next's plain page. It says nothing about whether a feed of that name exists.
export default async function NotFound() {
  const t = await serverCopy();
  return (
    <ErrorPage t={t} title={t.errorPage.notFoundTitle}>
      <p>{t.errorPage.notFound}</p>
    </ErrorPage>
  );
}

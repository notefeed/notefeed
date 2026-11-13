import { ErrorPage } from "@/components/ErrorPage";

// Every notFound() and every unknown page: in words, never Next's plain page. It says nothing about whether a feed of that name exists.
export default function NotFound() {
  return (
    <ErrorPage title="Nothing here">
      <p>This page doesn&apos;t exist, or what was on it has been deleted. Check the link, or start again from the start page.</p>
    </ErrorPage>
  );
}

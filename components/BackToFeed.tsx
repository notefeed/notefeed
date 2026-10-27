import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { card } from "@/components/styles";

// The right column beside a note on the read page (#307): the feed it belongs to and a large way back to all its notes, in the
// column that is otherwise empty there. Only from xl, where that column stands beside the note; narrower screens have the link
// above the note (NoteArticle).
export function BackToFeed({ title, imageUrl, href }: { title: string; imageUrl: string | null; href: string }) {
  return (
    <nav aria-label="Feed" className="hidden xl:block">
      <Link href={href} className={`${card} group flex items-center gap-3 p-4 hover:border-carbon/60 xl:p-5`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl ?? "/icon.svg"} alt="" className={`h-12 w-12 shrink-0 rounded-full border border-rule bg-surface ${imageUrl ? "object-cover" : "p-2"}`} />
        <span className="min-w-0">
          <span className="block truncate text-[13px] text-muted">{title}</span>
          <span className="flex items-center gap-1 text-lg font-bold text-carbon group-hover:underline">
            <ChevronLeft aria-hidden className="h-5 w-5" />
            All notes
          </span>
        </span>
      </Link>
    </nav>
  );
}

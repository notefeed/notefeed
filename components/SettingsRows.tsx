import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { card, sectionLabel } from "@/components/styles";

// The settings page as grouped rows (issue #185): a label over a card of rows, each with an icon tile, a label and a value.
// A row that holds a form opens as a <details>, so everything works without JavaScript.

export function Group({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className={`${sectionLabel} mb-2 px-1`}>
        {label}
      </h2>
      <div className={`${card} divide-y divide-rule overflow-hidden`}>{children}</div>
    </section>
  );
}

function Tile({ icon, danger }: { icon: ReactNode; danger?: boolean }) {
  return <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg [&>svg]:h-[18px] [&>svg]:w-[18px] ${danger ? "bg-error/10 text-error" : "bg-carbon-soft text-carbon"}`}>{icon}</span>;
}

// A row with its value or control on the right.
export function Row({ icon, label, hint, danger, children }: { icon: ReactNode; label: ReactNode; hint?: ReactNode; danger?: boolean; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Tile icon={icon} danger={danger} />
      <div className="min-w-0 flex-1">
        <div className={`text-[15px] ${danger ? "text-error" : ""}`}>{label}</div>
        {hint && <div className="text-[13px] text-muted">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

// A row with a text field next to its icon tile. The field's placeholder names it; the label is for screen readers.
export function FieldRow({ icon, label, htmlFor, children }: { icon: ReactNode; label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Tile icon={icon} />
      <label htmlFor={htmlFor} className="sr-only">
        {label}
      </label>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// A row that opens to show its form. `value`: the current state, shown on the right while closed.
export function DisclosureRow({ icon, label, value, danger, open, children }: { icon: ReactNode; label: string; value?: ReactNode; danger?: boolean; open?: boolean; children: ReactNode }) {
  return (
    <details open={open} className="group/row">
      <summary className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-surface-2/60 group-open/row:hover:bg-transparent">
        <Tile icon={icon} danger={danger} />
        <span className={`min-w-0 flex-1 text-[15px] ${danger ? "text-error" : ""}`}>{label}</span>
        {value !== undefined && <span className="min-w-0 truncate text-[13px] text-muted">{value}</span>}
        <ChevronRight aria-hidden className="chevron h-4 w-4 shrink-0 text-muted transition-transform" />
      </summary>
      <div className="px-4 pb-4 sm:pl-[3.75rem]">{children}</div>
    </details>
  );
}

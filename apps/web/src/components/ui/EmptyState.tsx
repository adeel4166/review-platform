import type { ReactNode } from "react";

/** Decorative single-hue line illustration; meaning is carried by the heading. */
function Glyph() {
  return (
    <svg aria-hidden="true" width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" strokeDasharray="2 2" />
      <path d="m3.5 15 4.5-4.5 4 4 3-3 5.5 5" />
      <circle cx="9" cy="9" r="1.2" className="text-primary" />
    </svg>
  );
}

export function EmptyState({ title, description, action, level = 2 }: { title: string; description?: string; action?: ReactNode; level?: 2 | 3 }) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-border bg-bg-subtle px-4 py-10 text-center" data-testid="empty-state">
      <Glyph />
      <H className="mt-3 text-lg font-semibold">{title}</H>
      {description && <p className="mt-1 max-w-reading text-text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

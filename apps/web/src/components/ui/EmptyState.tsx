import type { ReactNode } from "react";
import { ImageOff } from "lucide-react";

/** Decorative single-hue line illustration; meaning is carried by the heading. */
function Glyph() {
  return <ImageOff aria-hidden="true" size={96} strokeWidth={1.5} className="text-text-muted" />;
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

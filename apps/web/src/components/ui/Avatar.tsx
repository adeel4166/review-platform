const sizes = { sm: "h-8 w-8 text-xs", md: "h-10 w-10 text-sm", lg: "h-16 w-16 text-xl" } as const;

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const s = parts.length > 1 ? `${parts[0]![0]}${parts[parts.length - 1]![0]}` : (parts[0] ?? "?").slice(0, 2);
  return s.toUpperCase();
}

/** Initials avatar (decorative: the name is always rendered next to it). Fixed size, so no layout shift. */
export function Avatar({ name, size = "md", className = "" }: { name: string; size?: keyof typeof sizes; className?: string }) {
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center rounded-full bg-info-bg font-semibold text-info ${sizes[size]} ${className}`}>
      {initials(name)}
    </span>
  );
}

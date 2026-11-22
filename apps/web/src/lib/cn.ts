import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/** tailwind-merge configured for our design-token class names (ADR-0034 D2). */
const twMerge = extendTailwindMerge({
  extend: {
    theme: { radius: ["sm", "md", "lg", "xl", "2xl", "3xl", "full"], shadow: ["xs", "sm", "md", "lg", "xl", "glow"] },
    classGroups: {
      "font-size": [{ text: ["display", "h1", "h2", "h3", "body", "small", "caption", "eyebrow"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

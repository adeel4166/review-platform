import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("merges conflicting token utilities, last wins", () => {
    expect(cn("rounded-md p-2", "rounded-lg")).toBe("p-2 rounded-lg");
    expect(cn("shadow-sm", "shadow-lg")).toBe("shadow-lg");
    const off: boolean = Boolean(0);
    expect(cn("text-text", off && "x", "text-text-muted")).toContain("text-text-muted");
  });
  it("keeps font-size and colour utilities distinct", () => {
    expect(cn("text-h2", "text-text")).toBe("text-h2 text-text");
  });
});

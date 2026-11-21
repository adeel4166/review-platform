import { describe, expect, it } from "vitest";
import { safeCallbackUrl } from "./callback-url";

describe("safeCallbackUrl", () => {
  it.each([
    ["/products", "/products"],
    ["/admin/moderation?state=NEEDS_HUMAN", "/admin/moderation?state=NEEDS_HUMAN"],
    ["/products/x/review#form", "/products/x/review#form"],
  ])("keeps relative path %s", (input, out) => expect(safeCallbackUrl(input)).toBe(out));

  it.each([
    "https://evil.example",
    "http://evil.example/x",
    "//evil.example",
    "///evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "evil.example",
    "/\t/evil.example",
    "/%0d%0a",
    "",
    "/login",
    "/register?x=1",
  ])("rejects %j", (input) => {
    const out = safeCallbackUrl(input);
    expect(["/", "/%0d%0a"]).toContain(out);
  });

  it("handles missing and array values", () => {
    expect(safeCallbackUrl(undefined)).toBe("/");
    expect(safeCallbackUrl(null)).toBe("/");
    expect(safeCallbackUrl(["/a", "/b"])).toBe("/a");
  });
});

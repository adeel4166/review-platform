import { describe, expect, it } from "vitest";
import { FakeMailProvider, createMailProvider, generateEmailToken, hashEmailToken, renderMail } from "./index";

describe("mail + tokens", () => {
  it("tokens are 256-bit base64url with a SHA-256 hex digest", () => {
    const t = generateEmailToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashEmailToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(generateEmailToken()).not.toBe(t);
  });
  it("fake provider is idempotent on the key and refused in production", async () => {
    const p = new FakeMailProvider();
    const m = renderMail("verify_account", "a@x.io", { url: "https://x/?t=1&u=<" });
    await p.send(m, { idempotencyKey: "k" });
    await p.send(m, { idempotencyKey: "k" });
    expect(p.sent).toHaveLength(1);
    expect(m.html).toContain("&amp;");
    expect(() => createMailProvider({ MAIL_PROVIDER: "fake", NODE_ENV: "production" })).toThrow();
    expect(createMailProvider({ MAIL_PROVIDER: "fake", NODE_ENV: "test" })).toBeInstanceOf(FakeMailProvider);
    expect(() => createMailProvider({ MAIL_PROVIDER: "smtp", NODE_ENV: "production", SMTP_URL: "smtp://h:25" })).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { REPLY_MAX_CHARS, checkReplyPolicy, replyForcesHuman } from "./reply-policy";

const hard = (s: string) => checkReplyPolicy(s).hard;
const soft = (s: string) => checkReplyPolicy(s).soft;

describe("checkReplyPolicy hard rules (RPL-001)", () => {
  const links: Array<[string, string]> = [
    ["https scheme", "See https://example.com/refund for details"],
    ["http scheme", "Go to http://evil.test now"],
    ["ftp scheme", "ftp://files.example.org/x"],
    ["javascript scheme", "javascript:alert(1)"],
    ["data scheme", "data:text/html;base64,AAAA"],
    ["mailto", "mailto:a@b.co"],
    ["tel", "tel:+4915112345678"],
    ["www", "visit www.brand for refunds"],
    ["bare domain", "Visit brand.com for your refund"],
    ["bare domain with path", "brand.shop/refund"],
    ["fullwidth dot", "brand．com"],
    ["ideographic dot", "brand。com"],
    ["[.] obfuscation", "brand[.]com"],
    ["(.) obfuscation", "brand(.)com"],
  ];
  for (const [name, text] of links) it(`link: ${name}`, () => expect(hard(text)).toContain("link"));

  it("email addresses are hard, also with obfuscated dots", () => {
    expect(hard("write to jane@brand.com")).toContain("email");
    expect(hard("write to jane@brand[.]com")).toContain("email");
    expect(hard("write to jane＠brand。com")).toContain("email");
  });
  it("markup: tags, markdown links and images, entities", () => {
    for (const t of ["<b>hi</b>", "<a href=x>y</a>", "[click](x)", "![img](x)", "a &amp; b", "&#106;avascript", "<!-- x -->"]) expect(hard(t)).toContain("markup");
  });
  it("invisible: bidi, zero-width, tag chars, control chars", () => {
    for (const t of ["abc‮def", "abc⁦def", "a​b", "a⁠b", "a﻿b", "a\u{E0041}b", "a\u0007b", "a\u0085b"]) expect(hard(t)).toContain("invisible");
  });
  it("length: more than 1500 chars or 15 line breaks", () => {
    expect(hard("a".repeat(REPLY_MAX_CHARS + 1))).toContain("too_long");
    expect(hard("a".repeat(REPLY_MAX_CHARS))).not.toContain("too_long");
    expect(hard(Array.from({ length: 17 }, (_, i) => `l${i}`).join("\n"))).toContain("too_long");
  });
  it("empty / whitespace-only is rejected", () => {
    expect(hard("")).toContain("empty");
    expect(hard("  \n ")).toContain("empty");
  });
  it("plain support text passes with no flags", () => {
    const r = checkReplyPolicy("Thank you for the feedback. We are sorry the strap broke; please use the in-app help to start a return for order 12345.");
    expect(r.hard).toEqual([]);
    expect(r.soft).toEqual([]);
  });
  it("normalizes NFC, CRLF and collapses blank-line runs", () => {
    expect(checkReplyPolicy("é\r\n\r\n\r\n\r\nx").body).toBe("é\n\nx");
  });
});

describe("checkReplyPolicy soft flags (RPL-001)", () => {
  it("phone numbers are soft only", () => {
    const r = checkReplyPolicy("Call +49 151 1234 5678 anytime");
    expect(r.hard).toEqual([]);
    expect(r.soft).toContain("phone");
  });
  it("messenger keywords are soft only", () => {
    for (const t of ["Message us on WhatsApp", "Ping us on Telegram please", "dm us for a refund", "email us any time"]) {
      expect(hard(t)).toEqual([]);
      expect(soft(t)).toContain("contact_channel");
    }
  });
  it("spelled-out links and emails are soft only", () => {
    expect(hard("go to brand dot com")).toEqual([]);
    expect(soft("go to brand dot com")).toContain("spelled_out_link");
    expect(hard("jane (at) brand")).toEqual([]);
    expect(soft("jane (at) brand")).toContain("spelled_out_email");
  });
  it("replyForcesHuman: soft flags or fewer than 5 prior replies", () => {
    expect(replyForcesHuman([], 5)).toBe(false);
    expect(replyForcesHuman([], 4)).toBe(true);
    expect(replyForcesHuman(["phone"], 50)).toBe(true);
  });
});

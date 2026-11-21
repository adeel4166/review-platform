import { describe, expect, it } from "vitest";
import { DomainNotAllowedError, assertHasMx, assertOwnableDomain, businessEmailDomain, isPublicAddress } from "./index";

const reason = (f: () => unknown) => { try { f(); return "OK"; } catch (e) { return e instanceof DomainNotAllowedError ? e.reason : "OTHER"; } };

describe("domain policy (SEL-002)", () => {
  it("accepts a registrable domain and converts IDN to an A-label", () => {
    expect(assertOwnableDomain("Acme.COM.").domain).toBe("acme.com");
    expect(assertOwnableDomain("shop.co.uk").domain).toBe("shop.co.uk");
    expect(assertOwnableDomain("bücher.de").domain).toBe("xn--bcher-kva.de");
  });
  it.each(["github.io", "foo.github.io", "shop.myshopify.com", "shop.wixsite.com", "x.netlify.app", "a.vercel.app", "a.pages.dev", "blog.blogspot.com"])("private suffix %s is refused", (d) => {
    expect(reason(() => assertOwnableDomain(d))).toBe("shared_host");
  });
  it.each(["co.uk", "shop.acme.com", "www.acme.com"])("%s is not a registrable domain", (d) => {
    expect(reason(() => assertOwnableDomain(d))).toBe("not_registrable");
  });
  it.each(["shopify.com", "wix.com", "squarespace.com"])("hosting domain %s is refused", (d) => {
    expect(reason(() => assertOwnableDomain(d))).toBe("shared_host");
  });
  it.each(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.fr", "yahoo.co.uk", "icloud.com", "proton.me", "gmx.de", "mail.ru", "yandex.ru"])("%s is refused as a business e-mail domain", (d) => {
    expect(reason(() => assertOwnableDomain(d, "email"))).toBe("free_mail");
  });
  it.each(["127.0.0.1", "2130706433", "0x7f000001", "0177.0.0.1", "[::1]", "::1", "10.0.0.1.", "1.2.3"])("IP literal %s is refused", (d) => {
    expect(["ip_literal", "invalid"]).toContain(reason(() => assertOwnableDomain(d)));
  });
  it.each(["localhost", "intranet", "printer.local", "a.internal", "", " ", "a b.com", "-a.com", `${"a".repeat(64)}.com`])("invalid or internal name %j is refused", (d) => {
    expect(reason(() => assertOwnableDomain(d))).not.toBe("OK");
  });
  it("business e-mail must sit under the claimed domain and not be free-mail", () => {
    expect(businessEmailDomain("ceo@acme.com", "acme.com")).toBe("acme.com");
    expect(reason(() => businessEmailDomain("ceo@gmail.com", "gmail.com"))).toBe("free_mail");
    expect(reason(() => businessEmailDomain("ceo@evil.com", "acme.com"))).toBe("invalid");
    expect(reason(() => businessEmailDomain("a@b@acme.com", "acme.com"))).toBe("invalid");
  });
  it("requires an MX record", async () => {
    await expect(assertHasMx("acme.com", async () => [])).rejects.toMatchObject({ reason: "no_mx" });
    await expect(assertHasMx("acme.com", async () => { throw new Error("x"); })).rejects.toMatchObject({ reason: "no_mx" });
    await expect(assertHasMx("acme.com", async () => [{ exchange: "mx.acme.com" }])).resolves.toBeUndefined();
  });
});

describe("isPublicAddress (spec §6.3 deny table)", () => {
  const denied = [
    "0.0.0.0", "0.1.2.3", "10.0.0.1", "10.255.255.255", "100.64.0.1", "100.127.255.255", "127.0.0.1", "127.255.255.254", "169.254.169.254", "169.254.0.1", "172.16.0.1", "172.31.255.255",
    "192.0.0.1", "192.0.2.1", "192.88.99.1", "192.168.1.1", "198.18.0.1", "198.19.255.255", "198.51.100.1", "203.0.113.1", "224.0.0.1", "239.255.255.255", "240.0.0.1", "255.255.255.255",
    "::", "::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.169.254", "::ffff:7f00:1", "64:ff9b::7f00:1", "64:ff9b::a9fe:a9fe", "64:ff9b:1::1", "100::1", "2001::1", "2001:2::1", "2001:10::1",
    "2001:db8::1", "2002::1", "2002:7f00:1::1", "fc00::1", "fd00:ec2::254", "fe80::1", "fe80::1%eth0", "fec0::1", "ff02::1", "not-an-ip", "", "1.2.3", "999.1.1.1", "::ffff:999.1.1.1",
  ];
  const allowed = ["1.1.1.1", "8.8.8.8", "93.184.216.34", "172.32.0.1", "100.63.255.255", "198.17.0.1", "2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8", "64:ff9b::808:808"];
  it.each(denied)("denies %s", (a) => expect(isPublicAddress(a)).toBe(false));
  it.each(allowed)("allows %s", (a) => expect(isPublicAddress(a)).toBe(true));
});

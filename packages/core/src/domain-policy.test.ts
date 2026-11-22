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

import { EmailNotAllowedError, assertClaimableBusinessEmail, classifySuffix } from "./index";
import { PSL_ICANN_RULES, PSL_SHA256, PSL_VERSION } from "./psl-snapshot";

describe("pinned full PSL snapshot (T-10)", () => {
  it("is a real, versioned snapshot", () => {
    expect(PSL_VERSION).toMatch(/^\d{4}-\d\d-\d\d/);
    expect(PSL_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(PSL_ICANN_RULES.split("\n").length).toBeGreaterThan(5000);
  });
  it("applies wildcard and exception rules and suffixes the old subset missed", () => {
    expect(classifySuffix("a.b.example.ck".split("."))).toEqual({ suffixLen: 2, isPrivate: false }); // *.ck makes example.ck the suffix
    expect(classifySuffix("www.ck".split("."))).toEqual({ suffixLen: 1, isPrivate: false }); // !www.ck
    expect(classifySuffix("brand.com.au".split("."))).toEqual({ suffixLen: 2, isPrivate: false });
    expect(classifySuffix("brand.gov.in".split("."))).toEqual({ suffixLen: 2, isPrivate: false }); // not in the old subset
    expect(classifySuffix("brand.github.io".split("."))).toEqual({ suffixLen: 2, isPrivate: true });
  });
  it.each(["brand.pages.dev", "x.vercel.app", "x.s3.amazonaws.com", "x.cloudfront.net", "x.my.id.example.web.app"])("private-section suffix %s is shared_host", (d) => {
    expect(reason(() => assertOwnableDomain(d))).toBe("shared_host");
  });
  it("registrable domains under newer multi-label suffixes are accepted", () => {
    expect(assertOwnableDomain("brand.com.ng").domain).toBe("brand.com.ng");
    expect(assertOwnableDomain("brand.ac.nz").domain).toBe("brand.ac.nz");
    expect(reason(() => assertOwnableDomain("com.ng"))).toBe("not_registrable");
  });
});

describe("assertClaimableBusinessEmail (m3b-spec 4.1)", () => {
  const err = (f: () => unknown) => { try { f(); return "OK"; } catch (e) { return e instanceof DomainNotAllowedError ? e.reason : e instanceof EmailNotAllowedError ? e.reason : "OTHER"; } };
  it("accepts a personal address and flags role addresses", () => {
    expect(assertClaimableBusinessEmail("Jane.Doe+rp@Acme.com", "acme.com")).toMatchObject({ domain: "acme.com", localClass: "personal", address: "Jane.Doe+rp@Acme.com" });
    expect(assertClaimableBusinessEmail("info@acme.com").localClass).toBe("role");
    expect(assertClaimableBusinessEmail("Sales+x@acme.com").localClass).toBe("role");
  });
  it.each(["jane@gmail.com", "jane@hotmail.fr", "jane@yahoo.co.uk"])("free mail %s is refused", (a) => expect(err(() => assertClaimableBusinessEmail(a))).toBe("free_mail"));
  it.each(["jane@shop.myshopify.com", "jane@brand.github.io", "jane@brand.pages.dev", "jane@shopify.com"])("shared suffix / host %s is refused", (a) => expect(err(() => assertClaimableBusinessEmail(a))).toBe("shared_host"));
  it("refuses a subdomain mailbox, a bare suffix and a mismatching claimed domain", () => {
    expect(err(() => assertClaimableBusinessEmail("jane@mail.acme.com"))).toBe("subdomain_mailbox");
    expect(err(() => assertClaimableBusinessEmail("jane@co.uk"))).toBe("not_registrable");
    expect(err(() => assertClaimableBusinessEmail("jane@acme.com", "other.com"))).toBe("invalid");
  });
  it.each(["noreply@acme.com", "no-reply+x@acme.com", "abuse@acme.com", "x-request@acme.com", "owner-list@acme.com"])("reserved %s is refused", (a) => expect(err(() => assertClaimableBusinessEmail(a))).toBe("reserved_local_part"));
  it.each(['"jane doe"@acme.com', "jane@[1.2.3.4]", "jane..doe@acme.com", ".jane@acme.com", "jane.@acme.com", "jäne@acme.com", "a@b@acme.com", "jane", `${"a".repeat(65)}@acme.com`])("invalid address %j is refused", (a) => {
    expect(["invalid_email", "invalid", "ip_literal"]).toContain(err(() => assertClaimableBusinessEmail(a)));
  });
});

// ---- M3b gate (task #63): SEL-031 named corpus, SEL-033 reserved local parts ----
const refuseAddress = (a: string) => { try { assertClaimableBusinessEmail(a); return "OK"; } catch (e) { return (e as { reason?: string }).reason ?? "OTHER"; } };
describe("SEL-031: named address corpus (address parser)", () => {
  it.each(['"jane doe"@acme.com', "jane(note)@acme.com", "jäne@acme.com", `${"a".repeat(65)}@acme.com`])("SEL-031: %s is refused as invalid_email", (a) => {
    expect(refuseAddress(a)).toBe("invalid_email");
  });
  it("SEL-031: an IP-literal domain is refused", () => {
    expect(refuseAddress("jane@[1.2.3.4]")).not.toBe("OK");
  });
  it("SEL-031: info+x@ is classified as a role address; a personal address is not", () => {
    expect(assertClaimableBusinessEmail("info+x@acme.com").localClass).toBe("role");
    expect(assertClaimableBusinessEmail("jane@acme.com").localClass).toBe("personal");
  });
});
describe("SEL-033: reserved local parts (address parser)", () => {
  it.each(["noreply@acme.com", "no-reply+x@acme.com", "abuse@acme.com", "x-request@acme.com", "owner-list@acme.com"])("SEL-033: reserved %s -> reserved_local_part", (a) => {
    expect(refuseAddress(a)).toBe("reserved_local_part");
  });
});

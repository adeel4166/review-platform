/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { axe, toHaveNoViolations } from "jest-axe";
import { NOTIFICATION_TYPES } from "@rp/core";
import { describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { typeLabel } from "./NotificationCenter";
import { AccountErasure, eraseConfirmed, eraseErrorKey } from "../account/AccountErasure";
import { ApiError } from "@/lib/upload";
import { putFollow } from "@/server/social";

expect.extend(toHaveNoViolations);

describe("DEF-LIVE-07 notification labels", () => {
  it("has a non-empty notif.type.<TYPE> label for every NotificationType", () => {
    for (const type of NOTIFICATION_TYPES) expect((en as Record<string, string>)[`notif.type.${type}`], type).toBeTruthy();
  });
  it("typeLabel returns the label for known types and the raw type for unknown ones (never throws)", () => {
    expect(typeLabel("NEW_FOLLOWER")).toBe(en["notif.type.NEW_FOLLOWER"]);
    expect(typeLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });
});

describe("DEF-LIVE-06 putFollow emits NEW_FOLLOWER in the same transaction", () => {
  const mk = (existing: unknown) => {
    const tx = { follow: { create: vi.fn(async () => ({ id: "f1" })) }, outboxEvent: { create: vi.fn(async () => ({})) } };
    const db: any = {
      user: { findFirst: async () => ({ id: "u2" }) }, userBlock: { findUnique: async () => null },
      follow: { findFirst: async () => existing, create: vi.fn() },
      $transaction: async (fn: any) => fn(tx),
    };
    return { db, tx };
  };
  it("new user follow -> follow row + outbox notification.requested", async () => {
    const { db, tx } = mk(null);
    expect(await putFollow(db, "u1", { targetType: "USER", targetId: "u2" })).toEqual({ id: "f1", following: true, created: true });
    expect(tx.outboxEvent.create).toHaveBeenCalledOnce();
    expect((tx.outboxEvent.create.mock.calls as any)[0][0].data).toMatchObject({ type: "notification.requested", aggregateId: "f1", payload: { type: "NEW_FOLLOWER", targetType: "USER", targetId: "u2", actorId: "u1" } });
  });
  it("idempotent re-follow emits nothing", async () => {
    const { db, tx } = mk({ id: "f0" });
    expect((await putFollow(db, "u1", { targetType: "USER", targetId: "u2" })).created).toBe(false);
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });
  it("following a product emits no NEW_FOLLOWER", async () => {
    const { db, tx } = mk(null);
    db.product = { findFirst: async () => ({ id: "p1" }) };
    await putFollow(db, "u1", { targetType: "PRODUCT", targetId: "p1" });
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });
});

describe("DEF-LIVE-08 account erasure UI", () => {
  it("typed confirmation must equal the handle", () => {
    expect(eraseConfirmed("alice", "alice")).toBe(true);
    expect(eraseConfirmed(" alice ", "alice")).toBe(true);
    expect(eraseConfirmed("alic", "alice")).toBe(false);
    expect(eraseConfirmed("", "alice")).toBe(false);
  });
  it("maps API errors to i18n keys with a generic fallback", () => {
    expect(eraseErrorKey(new ApiError(422, "confirmation_mismatch"))).toBe("erase.err.confirmation_mismatch");
    expect(eraseErrorKey(new ApiError(409, "last_owner"))).toBe("erase.err.last_owner");
    expect(eraseErrorKey(new ApiError(401, "invalid_credentials"))).toBe("erase.err.invalid_credentials");
    expect(eraseErrorKey(new ApiError(500, "boom"))).toBe("erase.err.error");
    expect(eraseErrorKey(new Error("x"))).toBe("erase.err.error");
  });
  it("renders an accessible danger zone with the dialog closed and no axe violations", async () => {
    document.body.innerHTML = `<main><h1>Page</h1>${renderToStaticMarkup(createElement(AccountErasure, { handle: "alice" }))}</main>`;
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector("#erase-h")?.textContent).toBe(en["erase.h2"]);
    expect(await axe(document.body)).toHaveNoViolations();
  });
});

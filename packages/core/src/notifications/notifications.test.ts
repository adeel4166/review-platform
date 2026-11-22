import { describe, expect, it } from "vitest";
import { MANDATORY_TYPES, NOTIFICATION_TYPES, assertPreferenceAllowed, dispatch, preferenceView, MandatoryNotificationError, type Channel, type NotificationPorts, type NotificationType } from "./index";

function ports(disabled: Partial<Record<NotificationType, Channel[]>>) {
  const inApp = new Map<string, unknown>(), emails: string[] = [];
  const p: NotificationPorts = {
    disabled: async (_r, t) => new Set(disabled[t] ?? []),
    insertInApp: async (r) => { const k = `${r.recipientId}:${r.groupKey}`; if (inApp.has(k)) return false; inApp.set(k, r); return true; },
    enqueueEmail: async (id) => { emails.push(id); },
  };
  return { p, inApp, emails };
}
const ev = (type: NotificationType, id = "e1") => ({ eventId: id, type, recipientId: "u1", entityId: "x", at: new Date("2027-03-01T10:00:00Z") });

describe("TRS-009 / NTF-001 mandatory notification types cannot be disabled", () => {
  it("a preference PUT for a mandatory type is refused (422 mandatory_notification)", () => {
    expect(() => assertPreferenceAllowed("CONTENT_REMOVED")).toThrow(MandatoryNotificationError);
    expect(() => assertPreferenceAllowed("NEW_FOLLOWER")).not.toThrow();
  });
  it("a direct DB row enabled=false for CONTENT_REMOVED still yields the in-app row AND the e-mail", async () => {
    const { p, inApp, emails } = ports({ CONTENT_REMOVED: ["IN_APP", "EMAIL"] });
    expect(await dispatch(p, ev("CONTENT_REMOVED"))).toEqual({ inApp: true, email: true, duplicate: false });
    expect(inApp.size).toBe(1); expect(emails).toHaveLength(1);
  });
  it("every mandatory type survives disabled preferences; optional types honour them", async () => {
    for (const t of MANDATORY_TYPES) {
      const { p } = ports({ [t]: ["IN_APP", "EMAIL"] });
      expect(await dispatch(p, ev(t))).toMatchObject({ inApp: true, email: true });
    }
    const { p, inApp, emails } = ports({ NEW_FOLLOWER: ["EMAIL"], SELLER_REPLIED: ["IN_APP", "EMAIL"] });
    expect(await dispatch(p, ev("NEW_FOLLOWER"))).toMatchObject({ inApp: true, email: false });
    expect(await dispatch(p, ev("SELLER_REPLIED"))).toMatchObject({ inApp: false, email: false });
    expect(inApp.size).toBe(1); expect(emails).toHaveLength(0);
  });
  it("is idempotent per event and groups daily types", async () => {
    const { p, emails } = ports({});
    await dispatch(p, ev("SELLER_REPLIED"));
    expect(await dispatch(p, ev("SELLER_REPLIED"))).toMatchObject({ duplicate: true, email: false });
    expect(emails).toHaveLength(1);
    await dispatch(p, ev("NEW_FOLLOWER", "a")); const r = await dispatch(p, ev("NEW_FOLLOWER", "b"));
    expect(r.duplicate).toBe(true); // same day group
  });
  it("preference view marks mandatory rows enabled+mandatory regardless of stored rows; no MESSAGE types exist", () => {
    const v = preferenceView([{ type: "CONTENT_REMOVED", channel: "EMAIL", enabled: false }, { type: "NEW_FOLLOWER", channel: "EMAIL", enabled: false }]);
    expect(v.find((x) => x.type === "CONTENT_REMOVED" && x.channel === "EMAIL")).toEqual({ type: "CONTENT_REMOVED", channel: "EMAIL", enabled: true, mandatory: true });
    expect(v.find((x) => x.type === "NEW_FOLLOWER" && x.channel === "EMAIL")!.enabled).toBe(false);
    expect(NOTIFICATION_TYPES.some((t) => t.startsWith("MESSAGE"))).toBe(false);
  });
});

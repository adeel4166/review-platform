export type FollowTarget = "USER" | "SELLER" | "PRODUCT";
export type FollowDeny = "SELF_FOLLOW" | "BLOCKED" | "NOT_FOUND";
export const FOLLOW_LIMIT_PER_DAY = 200;
export const HANDLE_CHANGE_DAYS = 30;
export const BIO_MAX = 300;

/** Follow rules (AZ-014 follow clause): not self, and a target that blocked the actor is refused. */
export function authorizeFollow(c: { actorId: string; targetType: FollowTarget; targetId: string; targetExists: boolean; targetBlockedActor: boolean }): { ok: true } | { ok: false; deny: FollowDeny } {
  if (!c.targetExists) return { ok: false, deny: "NOT_FOUND" };
  if (c.targetType === "USER" && c.targetId === c.actorId) return { ok: false, deny: "SELF_FOLLOW" };
  if (c.targetType === "USER" && c.targetBlockedActor) return { ok: false, deny: "BLOCKED" };
  return { ok: true };
}
export const handleChangeAllowed = (changedAt: Date | null, now: Date) => !changedAt || now.getTime() - changedAt.getTime() >= HANDLE_CHANGE_DAYS * 86_400_000;

/** Public profile DTO: whitelist only. Private fields (email, status, numeric trust score, ipHash) never appear (X-5). */
export interface ProfileRow { handle: string; displayName: string; bio: string | null; avatarUrl?: string | null; trustBand: string; createdAt: Date; status: string }
export interface ProfileCounts { reviews: number; helpfulReceived: number; followers: number; following: number }
export function publicProfile(u: ProfileRow, c: ProfileCounts) {
  return { handle: u.handle, displayName: u.displayName, avatarUrl: u.avatarUrl ?? null, bio: u.bio, band: u.trustBand, memberSinceYear: u.createdAt.getUTCFullYear(), counts: { ...c } };
}
/** Suspended/banned/deleted users and users who blocked the viewer are the same neutral 404. */
export const profileVisible = (status: string, blockedViewer: boolean) => status === "ACTIVE" && !blockedViewer;

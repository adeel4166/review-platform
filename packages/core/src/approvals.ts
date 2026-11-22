import { addHours, type Clock } from "./clock";

/** Four-eyes (ADR-0026, spec §8). Pure decision logic; persistence in apps/web/src/server/approvals.ts. */
export type ApprovalKind = "CONFIG_ACTIVATION" | "ROLE_GRANT" | "TWO_FACTOR_RESET" | "ENFORCEMENT_OVERTURN_MAJOR" | "BREAK_GLASS_REPEAT";
export type ApprovalStatus = "PENDING" | "EXECUTED" | "REJECTED" | "EXPIRED" | "CANCELLED";
export type StaffRole = "MODERATOR" | "SENIOR_MODERATOR" | "ADMIN" | "SUPER_ADMIN";
export const APPROVAL_TTL_HOURS = 24;

export class ApprovalError extends Error {
  constructor(public status: 403 | 409, public code: "approval_self" | "approval_expired" | "approval_stale" | "approval_pending" | "forbidden" | "not_pending") { super(code); }
}
/** Roles that need a second SUPER_ADMIN (AZ-015). MODERATOR is single-actor with step-up. */
export const roleGrantNeedsFourEyes = (role: StaffRole): boolean => role !== "MODERATOR";
/** Who may approve each kind (distinct from the requester, enforced separately). */
export const APPROVER_ROLES: Record<ApprovalKind, readonly StaffRole[]> = {
  CONFIG_ACTIVATION: ["ADMIN", "SUPER_ADMIN"],
  ROLE_GRANT: ["SUPER_ADMIN"],
  TWO_FACTOR_RESET: ["ADMIN", "SUPER_ADMIN"],
  ENFORCEMENT_OVERTURN_MAJOR: ["SENIOR_MODERATOR", "ADMIN", "SUPER_ADMIN"],
  BREAK_GLASS_REPEAT: ["SENIOR_MODERATOR", "ADMIN", "SUPER_ADMIN"],
};
export const targetKeyFor = {
  role: (userId: string, role: string) => `role:${userId}:${role}`,
  config: (version: string) => `config:${version}`,
  twoFa: (userId: string) => `2fa:${userId}`,
  appeal: (id: string) => `appeal:${id}`,
  breakGlass: (submitterId: string) => `bg:${submitterId}`,
};
export const approvalExpiry = (clock: Clock): Date => addHours(clock.now(), APPROVAL_TTL_HOURS);

export interface ApprovalRec { kind: ApprovalKind; status: ApprovalStatus; requestedById: string; decidedById?: string | null; expiresAt: Date; payloadHash: string }
/** Guards for approve/reject. `currentPayloadHash` = hash of the precondition recomputed now (stale detection). */
export function assertCanApprove(a: ApprovalRec, approver: { id: string; roles: readonly StaffRole[] }, clock: Clock, currentPayloadHash: string): void {
  if (a.status !== "PENDING") throw new ApprovalError(409, "not_pending");
  if (a.expiresAt.getTime() <= clock.now().getTime()) throw new ApprovalError(409, "approval_expired");
  if (approver.id === a.requestedById) throw new ApprovalError(403, "approval_self");
  if (!approver.roles.some((r) => APPROVER_ROLES[a.kind].includes(r))) throw new ApprovalError(403, "forbidden");
  if (currentPayloadHash !== a.payloadHash) throw new ApprovalError(409, "approval_stale");
}

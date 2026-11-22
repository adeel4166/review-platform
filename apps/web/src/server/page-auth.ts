import { redirect } from "next/navigation";
import { auth } from "./auth";

/** Page-level guards: sign-in redirect with a callback; staff pages bounce non-admins (APIs enforce roles independently). */
export async function pageUser(callback: string): Promise<{ id: string; role: string }> {
  const s = await auth();
  if (!s?.user?.id) redirect(`/login?callbackUrl=${encodeURIComponent(callback)}`);
  return { id: s.user.id, role: String((s.user as { role?: string }).role ?? "user") };
}
export async function pageStaff(callback: string) {
  const u = await pageUser(callback);
  if (u.role !== "admin" && u.role !== "super_admin") redirect("/");
  return u;
}

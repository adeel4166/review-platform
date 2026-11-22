import Link from "next/link";
import type { ReactNode } from "react";
import { t, type MessageKey } from "@/i18n/en";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";

const addBtn = "inline-flex min-h-target items-center justify-center rounded-md bg-primary px-4 py-2 font-semibold text-on-primary hover:bg-primary-hover";

export function statusVariant(status: string): BadgeVariant {
  return status === "VERIFIED" ? "success" : status === "SUSPENDED" ? "danger" : "neutral";
}

export interface SellerPick { id: string; name: string; role: string; status?: string }

/** Seller picker (design 05): one card per seller with a text status badge; the empty state offers registration. */
export function SellerPicker({ sellers }: { sellers: SellerPick[] }) {
  if (sellers.length === 0) {
    return <EmptyState title={t("seller.list.empty.title")} description={t("seller.list.empty.body")} level={2} action={<Link href="/sellers/new" className={addBtn}>{t("seller.list.create")}</Link>} />;
  }
  return (
    <>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sellers.map((x) => (
          <li key={x.id} className="rounded-lg border border-border bg-surface p-4">
            <div className="flex items-center gap-3">
              <Avatar name={x.name} />
              <div className="min-w-0">
                <Link className="inline-flex min-h-target items-center break-words font-semibold text-link underline" href={`/seller/${x.id}`}>{x.name}</Link>
                <p className="text-sm text-text-muted">{t(`role.${x.role}` as MessageKey)}</p>
              </div>
            </div>
            {x.status && <p className="mt-2"><Badge variant={statusVariant(x.status)}>{t("seller.list.status", { status: x.status })}</Badge></p>}
          </li>
        ))}
      </ul>
      <Link href="/sellers/new" className={`${addBtn} mt-6`}>{t("seller.list.create")}</Link>
    </>
  );
}

export function SectionCard({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-6 rounded-lg border border-border bg-surface p-4 sm:p-5">
      <h2 id={id} className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** Verification status card: text badge + next step, never colour alone. */
export function VerificationStatusCard({ sellerId, verified, inProgress, canManage }: { sellerId: string; verified: boolean; inProgress: boolean; canManage: boolean }) {
  const label = verified ? t("seller.dash.statusCard.verified") : inProgress ? t("seller.dash.statusCard.progress") : t("seller.dash.statusCard.unverified");
  return (
    <SectionCard id="vstatus-h" title={t("seller.dash.statusCard")}>
      <p className="mt-2"><Badge variant={verified ? "success" : inProgress ? "info" : "warning"}>{label}</Badge></p>
      {!verified && canManage && (
        <p className="mt-3"><Link className="inline-flex min-h-target items-center text-link underline" href={`/seller/${sellerId}/verification`}>{inProgress ? t("seller.dash.verification") : t("seller.dash.attention.verifyAction")}</Link></p>
      )}
    </SectionCard>
  );
}

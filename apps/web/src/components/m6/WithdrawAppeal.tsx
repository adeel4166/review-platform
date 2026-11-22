"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { t } from "@/i18n/en";
import { api } from "@/lib/upload";
import { Dialog } from "../Dialog";
import { primaryBtn, secondaryBtn } from "../seller/ui";

export function WithdrawAppeal({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  async function run() {
    try { await api(`/api/appeals/${id}`, { method: "DELETE" }); setOpen(false); router.refresh(); } catch { setErr(t("appeal.err.generic")); }
  }
  return (
    <>
      <button type="button" aria-haspopup="dialog" className={secondaryBtn} onClick={() => setOpen(true)}>{t("appeal.withdraw")}</button>
      {open && (
        <Dialog titleId="wd-title" title={t("appeal.withdraw.title")} onClose={() => setOpen(false)}>
          <p className="mt-2">{t("appeal.withdraw.body")}</p>
          <p role="alert" className="text-danger">{err}</p>
          <div className="mt-4 flex gap-2"><button type="button" className={primaryBtn} onClick={run}>{t("appeal.withdraw.confirm")}</button><button type="button" data-autofocus className={secondaryBtn} onClick={() => setOpen(false)}>{t("appeal.cancel")}</button></div>
        </Dialog>
      )}
    </>
  );
}

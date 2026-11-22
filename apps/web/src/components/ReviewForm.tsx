"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { t } from "@/i18n/en";
import { LIMITS, errorKeyFor, isVideoType, uploadErrorKey, validateMedia, validateReview, type ReviewErrors } from "@/lib/review-form";
import { ApiError, api, putWithProgress, readVideoDuration } from "@/lib/upload";
import { MediaStatusList } from "./MediaStatusList";

type Item = { key: number; file: File; status: "uploading" | "processing" | "failed"; pct: number; reason?: string; durationMs?: number };
interface Slot { assetId: string; uploadUrl: string; headers: Record<string, string> }

const field = "mt-1 block w-full min-h-target rounded-md border border-border-strong bg-surface px-3 py-2";

export function ReviewForm({ productId, productName, productHref }: { productId: string; productName: string; productHref: string }) {
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [errors, setErrors] = useState<ReviewErrors>({});
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<{ message: string; signIn: boolean } | null>(null);
  const [done, setDone] = useState(false);
  const reviewId = useRef<string | null>(null); // review already created (retry after media failure must not re-create)
  const counter = useRef(0);
  const summaryRef = useRef<HTMLDivElement>(null);

  const itemsRef = useRef<Item[]>([]);
  itemsRef.current = items;
  const uploading = items.some((i) => i.status === "uploading");
  const update = (key: number, patch: Partial<Item>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  async function upload(file: File, key: number, rid: string) {
    update(key, { status: "uploading", pct: 0, reason: undefined });
    try {
      const item = itemsRef.current.find((x) => x.key === key);
      const slot = await api<Slot>(`/api/reviews/${rid}/media`, { method: "POST", body: JSON.stringify({ mimeType: file.type, sizeBytes: file.size, ...(item?.durationMs ? { durationMs: item.durationMs } : {}) }) });
      await putWithProgress(slot.uploadUrl, file, slot.headers, (pct) => update(key, { pct }));
      await api(`/api/media/${slot.assetId}/confirm`, { method: "POST" });
      update(key, { status: "processing", pct: 100 });
    } catch (e) {
      update(key, { status: "failed", reason: e instanceof ApiError ? e.code : "network" });
    }
  }

  async function addFiles(list: FileList | null) {
    if (!list) return;
    const errs: string[] = [];
    const next: Item[] = [];
    for (const f of Array.from(list)) {
      const all = [...itemsRef.current, ...next];
      const counts = { photos: all.filter((x) => !isVideoType(x.file.type)).length, videos: all.filter((x) => isVideoType(x.file.type)).length };
      const sec = isVideoType(f.type) ? await readVideoDuration(f) : null;
      const err = validateMedia(f, counts, sec);
      if (err) errs.push(err);
      else next.push({ key: ++counter.current, file: f, status: "uploading", pct: 0, ...(sec ? { durationMs: Math.max(1, Math.round(sec * 1000)) } : {}) });
    }
    setFileErrors(errs);
    setItems((xs) => [...xs, ...next]);
  }

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    const errs = validateReview({ rating, title, body });
    setErrors(errs);
    setFormError(null);
    if (Object.keys(errs).length) { queueMicrotask(() => summaryRef.current?.focus()); return; }
    setSubmitting(true);
    try {
      if (!reviewId.current) {
        const r = await api<{ id: string }>(`/api/products/${productId}/reviews`, {
          method: "POST", body: JSON.stringify({ rating, title: title.trim(), body: body.trim() }),
        });
        reviewId.current = r.id;
      }
      const rid = reviewId.current;
      // Images attach to the (pending) review after it exists; failures never block the review itself.
      await Promise.all(items.filter((i) => i.status === "uploading" || i.status === "failed").map((i) => upload(i.file, i.key, rid)));
      setDone(true);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      setFormError({ message: t(errorKeyFor(code)), signIn: code === "unauthenticated" });
      queueMicrotask(() => summaryRef.current?.focus());
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <section aria-labelledby="pending-h" className="rounded-lg border border-border bg-info-bg p-4" role="status">
        <h2 id="pending-h" className="text-xl font-semibold">{t("form.pending.heading")}</h2>
        <p className="mt-2">{t("form.pending.body")}</p>
        {reviewId.current && <MediaStatusList reviewId={reviewId.current} />}
        <p className="mt-4"><Link href={productHref} className="text-link underline">{t("form.pending.back", { product: productName })}</Link></p>
      </section>
    );
  }

  const errorList = [
    ...(errors.rating ? [{ id: "rating", msg: errors.rating }] : []),
    ...(errors.title ? [{ id: "title", msg: errors.title }] : []),
    ...(errors.body ? [{ id: "body", msg: errors.body }] : []),
  ];
  const rid = (k: string) => `${k}-error`;

  return (
    <form onSubmit={onSubmit} noValidate className="grid max-w-reading gap-6">
      <div ref={summaryRef} tabIndex={-1} role={errorList.length || formError ? "alert" : undefined}>
        {errorList.length > 0 && (
          <div className="rounded-md border border-danger bg-danger-bg p-3 text-danger">
            <p className="font-medium">{t("form.errorSummary")}</p>
            <ul className="list-disc pl-5">
              {errorList.map((e) => (<li key={e.id}><a href={`#${e.id}`} className="underline">{e.msg}</a></li>))}
            </ul>
          </div>
        )}
        {formError && (
          <p className="rounded-md border border-danger bg-danger-bg p-3 text-danger">
            {formError.message} {formError.signIn && <a className="underline" href={`/login?callbackUrl=${encodeURIComponent(productHref + "/review")}`}>{t("form.signin.link")}</a>}
          </p>
        )}
      </div>

      <fieldset aria-describedby={errors.rating ? rid("rating") : undefined}>
        <legend className="font-medium">{t("form.rating.legend")} <span className="text-text-muted">({t("form.required")})</span></legend>
        <div id="rating" tabIndex={-1} className="mt-1 flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className={`inline-flex min-h-target cursor-pointer items-center gap-2 rounded-md border px-3 ${rating === n ? "border-primary bg-bg-subtle" : "border-border-strong"} focus-within:outline focus-within:outline-2 focus-within:outline-focus`}>
              <input type="radio" name="rating" value={n} checked={rating === n} onChange={() => setRating(n)} className="h-4 w-4" />
              <span><span aria-hidden="true" className="text-star">{"★".repeat(n)}</span><span className="sr-only">{t("form.rating.option", { n, s: n === 1 ? "" : "s" })}</span><span aria-hidden="true" className="ml-1 text-sm">{n}</span></span>
            </label>
          ))}
        </div>
        {errors.rating && <p id={rid("rating")} className="mt-1 text-danger">{errors.rating}</p>}
      </fieldset>

      <div>
        <label htmlFor="title" className="font-medium">{t("form.title.label")} <span className="text-text-muted">({t("form.required")})</span></label>
        <input id="title" name="title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={LIMITS.titleMax}
          aria-required="true" aria-invalid={!!errors.title} aria-describedby={errors.title ? rid("title") : undefined} className={field} />
        {errors.title && <p id={rid("title")} className="mt-1 text-danger">{errors.title}</p>}
      </div>

      <div>
        <label htmlFor="body" className="font-medium">{t("form.body.label")} <span className="text-text-muted">({t("form.required")})</span></label>
        <p id="body-hint" className="text-sm text-text-muted">{t("form.body.hint", { min: LIMITS.bodyMin })}</p>
        <textarea id="body" name="body" rows={7} value={body} onChange={(e) => setBody(e.target.value)} maxLength={LIMITS.bodyMax}
          aria-required="true" aria-invalid={!!errors.body} aria-describedby={`body-hint${errors.body ? ` ${rid("body")}` : ""}`} className={field} />
        <p className="text-sm text-text-muted">{t("form.counter", { count: body.length, max: LIMITS.bodyMax })}</p>
        {errors.body && <p id={rid("body")} className="mt-1 text-danger">{errors.body}</p>}
      </div>

      <fieldset>
        <legend className="font-medium">{t("form.photos.legend")}</legend>
        <p id="photos-hint" className="text-sm text-text-muted">{t("form.media.hint", { photos: LIMITS.mediaMax, videos: LIMITS.videoMax })}</p>
        <input id="photos" type="file" accept={[...LIMITS.mime, ...LIMITS.videoMime].join(",")} multiple aria-describedby="photos-hint"
          onChange={(e) => { const input = e.target; void addFiles(input.files).then(() => { input.value = ""; }); }}
          disabled={items.length >= LIMITS.mediaMax + LIMITS.videoMax} aria-label={t("form.media.choose")} className="mt-2 block min-h-target" />
        {fileErrors.length > 0 && <ul role="alert" className="mt-1 text-danger">{fileErrors.map((m) => <li key={m}>{m}</li>)}</ul>}
        {items.length > 0 && (
          <ul className="mt-3 grid gap-2">
            {items.map((i) => (
              <li key={i.key} className="flex flex-wrap items-center gap-3 rounded-md border border-border p-2">
                <span className="min-w-0 flex-1 truncate">{i.file.name}</span>
                {i.status === "uploading" && reviewId.current && <progress value={i.pct} max={100} aria-label={i.file.name} className="w-32" />}
                <span role="status" className={i.status === "failed" ? "text-danger" : "text-text-muted"}>
                  {i.status === "uploading" ? (reviewId.current ? t("form.photo.uploading", { pct: i.pct }) : "") : i.status === "processing" ? t("form.photo.processing") : t("form.media.failedItem", { name: i.file.name, message: t(uploadErrorKey(i.reason)) })}
                </span>
                {i.status === "failed" && reviewId.current && (
                  <button type="button" className="min-h-target underline" aria-label={t("form.media.retry", { name: i.file.name })} onClick={() => void upload(i.file, i.key, reviewId.current!)}>Retry</button>
                )}
                {!submitting && i.status !== "processing" && (
                  <button type="button" className="min-h-target underline" aria-label={t("form.photo.remove", { name: i.file.name })} onClick={() => setItems((xs) => xs.filter((x) => x.key !== i.key))}>Remove</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <div>
        <button type="submit" disabled={submitting || uploading && !!reviewId.current} aria-describedby={submitting ? "submit-reason" : undefined}
          className="min-h-target rounded-md bg-primary px-6 font-medium text-on-primary hover:bg-primary-hover disabled:opacity-60">
          {submitting ? t("form.submitting") : t("form.submit")}
        </button>
        {submitting && uploading && <p id="submit-reason" className="mt-1 text-sm text-text-muted">{t("form.submitBlocked")}</p>}
      </div>
    </form>
  );
}

import type { ObjectHeaders, ObjectStore } from "./media";
import { MediaTooLargeError } from "./media";

/** In-memory ObjectStore for tests (no network, no credentials). */
export class FakeObjectStore implements ObjectStore {
  objects = new Map<string, Buffer>();
  /** Content-type and headers recorded per object, for header assertions (MED-034). */
  meta = new Map<string, { contentType: string; headers?: ObjectHeaders }>();
  private k = (b: string, key: string) => `${b}/${key}`;
  async presignPut(b: string, key: string, o: { contentType: string; contentLength: number }) {
    return `https://fake.local/put/${this.k(b, key)}?ct=${encodeURIComponent(o.contentType)}&len=${o.contentLength}`;
  }
  async presignGet(b: string, key: string) {
    return `https://fake.local/get/${this.k(b, key)}`;
  }
  async head(b: string, key: string) {
    const o = this.objects.get(this.k(b, key));
    return o ? { size: o.length } : null;
  }
  async get(b: string, key: string, max: number) {
    const o = this.objects.get(this.k(b, key));
    if (!o) return null;
    if (o.length > max) throw new MediaTooLargeError();
    return o;
  }
  async put(b: string, key: string, body: Buffer, contentType = "application/octet-stream", headers?: ObjectHeaders) {
    this.objects.set(this.k(b, key), body);
    this.meta.set(this.k(b, key), { contentType, ...(headers ? { headers } : {}) });
  }
  /** Test hook: when set, `list` reports this as the last-modified time of every object (default: now). */
  modifiedAt = new Map<string, Date>();
  async list(b: string, prefix: string, limit = 1000) {
    const p = this.k(b, prefix);
    return [...this.objects.keys()].filter((k) => k.startsWith(p)).slice(0, limit).map((k) => ({ key: k.slice(b.length + 1), lastModified: this.modifiedAt.get(k) ?? new Date() }));
  }
  async delete(b: string, key: string) {
    this.objects.delete(this.k(b, key));
    this.meta.delete(this.k(b, key));
  }
}

import type { ObjectStore } from "./media";
import { MediaTooLargeError } from "./media";

/** In-memory ObjectStore for tests (no network, no credentials). */
export class FakeObjectStore implements ObjectStore {
  objects = new Map<string, Buffer>();
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
  async put(b: string, key: string, body: Buffer) {
    this.objects.set(this.k(b, key), body);
  }
  async delete(b: string, key: string) {
    this.objects.delete(this.k(b, key));
  }
}

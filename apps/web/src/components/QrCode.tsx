import { qrMatrix } from "@/lib/qr";

/** QR drawn as SVG on a fixed white tile with a 4-module quiet zone, so scanners work in the dark theme too. */
export function QrCode({ text, alt }: { text: string; alt: string }) {
  let m: boolean[][];
  try { m = qrMatrix(text); } catch { return null; }
  const n = m.length, q = 4;
  const path = m.flatMap((row, y) => row.map((d, x) => (d ? `M${x + q} ${y + q}h1v1h-1z` : ""))).join("");
  return (
    <svg role="img" aria-label={alt} viewBox={`0 0 ${n + q * 2} ${n + q * 2}`} className="h-56 w-56 rounded-md border border-border bg-white" shapeRendering="crispEdges">
      <rect width="100%" height="100%" fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

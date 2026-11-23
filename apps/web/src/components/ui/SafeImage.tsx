"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Image, { type ImageProps } from "next/image";

/**
 * next/image that renders `fallback` (the letter/brand placeholder) if the file fails to load (ADR-0034 D9/D11),
 * so no broken-image icon is ever shown. Also catches errors that fired before hydration.
 */
export function SafeImage({ fallback, onError, ...props }: ImageProps & { fallback: ReactNode }) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => { setFailed(false); }, [props.src]);
  useEffect(() => {
    const el = ref.current;
    if (el && el.complete && el.naturalWidth === 0) setFailed(true);
  }, [props.src]);
  if (failed) return <>{fallback}</>;
  return <Image ref={ref} {...props} onError={(e) => { setFailed(true); onError?.(e); }} />;
}

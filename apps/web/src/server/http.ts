import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });

/** Parses a JSON request body; malformed or non-JSON bodies become a 400. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON");
  }
}

/** Wraps a route handler: maps validation/HTTP errors to JSON responses, hides internals on 500. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) return json({ error: { code: e.code, message: e.message } }, e.status);
    if (e instanceof ZodError) {
      return json(
        { error: { code: "validation_error", message: "Invalid input", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } },
        400,
      );
    }
    console.error("unhandled route error", e instanceof Error ? e.name : "unknown");
    return json({ error: { code: "internal_error", message: "Internal server error" } }, 500);
  }
}

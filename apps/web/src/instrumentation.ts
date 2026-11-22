/** Next.js boot hook (SEC-M4-01): refuse to start the Node server without IP_HASH_KEY. Runs once per server start. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertIpHashKey } = await import("@rp/core");
  assertIpHashKey();
}

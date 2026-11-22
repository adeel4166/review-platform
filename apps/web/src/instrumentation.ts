/** Next.js boot hook (SEC-M4-01): refuse to start the Node server without IP_HASH_KEY. Runs once per server start. */
export async function register() {
  // The import must sit inside the `=== "nodejs"` branch so the edge compile drops it (the @rp/core barrel pulls node:* modules).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertIpHashKey } = await import("./instrumentation-node");
    assertIpHashKey();
  }
}

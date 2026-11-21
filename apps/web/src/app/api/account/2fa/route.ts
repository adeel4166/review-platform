import { handle } from "@/server/http";
import { statusRoute } from "@/server/two-factor-routes";

export const runtime = "nodejs";

export const GET = () => handle(() => statusRoute());

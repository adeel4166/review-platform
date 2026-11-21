import { handle } from "@/server/http";
import { confirmRoute } from "@/server/two-factor-routes";

export const runtime = "nodejs";

export const POST = (req: Request) => handle(() => confirmRoute(req));

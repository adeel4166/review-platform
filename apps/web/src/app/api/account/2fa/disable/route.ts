import { handle } from "@/server/http";
import { disableRoute } from "@/server/two-factor-routes";

export const runtime = "nodejs";

export const POST = (req: Request) => handle(() => disableRoute(req));

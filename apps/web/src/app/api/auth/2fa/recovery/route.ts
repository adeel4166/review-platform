import { handle } from "@/server/http";
import { verifyRoute } from "@/server/two-factor-routes";

export const runtime = "nodejs";

export const POST = (req: Request) => handle(() => verifyRoute(req, "RECOVERY_CODE"));

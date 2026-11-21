import { handle } from "@/server/http";
import { enrolRoute } from "@/server/two-factor-routes";

export const runtime = "nodejs";

export const POST = (req: Request) => handle(() => enrolRoute(req));

import { NextRequest } from "next/server";
import GoaParcelService from "@/services/india/goa";
import { handleIndiaOverlayResolve } from "@/services/india/shared/route-handlers";

export async function POST(request: NextRequest) {
  return handleIndiaOverlayResolve(request, GoaParcelService, "Goa");
}

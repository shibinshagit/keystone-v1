import { NextRequest } from "next/server";
import KeralaParcelService from "@/services/india/kerala";
import { handleIndiaOverlayResolve } from "@/services/india/shared/route-handlers";

export async function POST(request: NextRequest) {
  return handleIndiaOverlayResolve(request, KeralaParcelService, "Kerala");
}

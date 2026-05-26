import { NextRequest } from "next/server";
import PunjabParcelService from "@/services/india/punjab";
import { handleIndiaOverlayResolve } from "@/services/india/shared/route-handlers";

export async function POST(request: NextRequest) {
  return handleIndiaOverlayResolve(request, PunjabParcelService, "Punjab");
}

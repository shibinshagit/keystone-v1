import { NextRequest } from "next/server";
import AssamParcelService from "@/services/india/assam";
import { handleIndiaOverlayResolve } from "@/services/india/shared/route-handlers";

export async function POST(request: NextRequest) {
  return handleIndiaOverlayResolve(request, AssamParcelService, "Assam");
}

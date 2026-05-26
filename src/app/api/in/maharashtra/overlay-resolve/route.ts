import { NextRequest } from "next/server";
import MaharashtraParcelService from "@/services/india/maharashtra";
import { handleIndiaOverlayResolve } from "@/services/india/shared/route-handlers";

export async function POST(request: NextRequest) {
  return handleIndiaOverlayResolve(request, MaharashtraParcelService, "Maharashtra");
}

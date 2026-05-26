import { NextRequest } from "next/server";
import RajasthanParcelService from "@/services/india/rajasthan";
import { handleIndiaOverlayResolve } from "@/services/india/shared/route-handlers";

export async function POST(request: NextRequest) {
  return handleIndiaOverlayResolve(
    request,
    RajasthanParcelService,
    "Rajasthan",
  );
}

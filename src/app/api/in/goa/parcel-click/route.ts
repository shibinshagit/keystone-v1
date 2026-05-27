import { NextRequest } from "next/server";
import { GoaParcelService } from "@/services/india/goa";
import { handleIndiaParcelClick } from "@/services/india/shared/route-handlers";

export async function POST(request: NextRequest) {
  return handleIndiaParcelClick(request, GoaParcelService, "Goa");
}

import { NextRequest } from "next/server";
import { PunjabParcelService } from "@/services/india/punjab";
import { handleIndiaParcelClick } from "@/services/india/shared/route-handlers";

export async function POST(request: NextRequest) {
  return handleIndiaParcelClick(request, PunjabParcelService, "Punjab");
}

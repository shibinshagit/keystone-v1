import { NextRequest } from "next/server";
import { AssamParcelService } from "@/services/india/assam";
import { handleIndiaParcelClick } from "@/services/india/shared/route-handlers";

export async function POST(request: NextRequest) {
  return handleIndiaParcelClick(request, AssamParcelService, "Assam");
}

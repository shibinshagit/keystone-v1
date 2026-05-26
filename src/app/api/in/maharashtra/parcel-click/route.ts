import { NextRequest } from "next/server";
import { MaharashtraParcelService } from "@/services/india/maharashtra";
import { handleIndiaParcelClick } from "@/services/india/shared/route-handlers";

export async function POST(request: NextRequest) {
  return handleIndiaParcelClick(request, MaharashtraParcelService, "Maharashtra");
}

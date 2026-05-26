import { NextRequest } from "next/server";
import RajasthanParcelService from "@/services/india/rajasthan";
import { handleIndiaParcelClick } from "@/services/india/shared/route-handlers";

export async function POST(request: NextRequest) {
  return handleIndiaParcelClick(request, RajasthanParcelService, "Rajasthan");
}

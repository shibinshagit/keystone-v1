"use client";

import { FileText, MapPin } from "lucide-react";

import type { IndiaParcelSelection } from "@/services/india/shared/types";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

export function IndiaParcelDetailsCard({
  parcel,
  title = "Official Parcel Details",
}: {
  parcel: IndiaParcelSelection;
  title?: string;
}) {
  return (
    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-emerald-700">{title}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {parcel.locationLabel || parcel.parcelLabel}
          </p>
        </div>
        <Badge variant="outline" className="text-[10px]">
          {parcel.sourceBadge || parcel.sourceName}
        </Badge>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-md border bg-background/80 p-2 text-xs">
          <div className="mb-2 flex items-center gap-1.5 font-medium text-emerald-700">
            <MapPin className="h-3.5 w-3.5" />
            Parcel
          </div>
          <div className="space-y-1.5">
            {parcel.parcelFields.map((field) => (
              <DataRow key={field.label} label={field.label} value={field.value} />
            ))}
          </div>
        </div>
        <div className="rounded-md border bg-background/80 p-2 text-xs">
          <div className="mb-2 flex items-center gap-1.5 font-medium text-emerald-700">
            <FileText className="h-3.5 w-3.5" />
            Record
          </div>
          <div className="space-y-1.5">
            {parcel.administrativeFields.map((field) => (
              <DataRow key={field.label} label={field.label} value={field.value} />
            ))}
          </div>
        </div>
      </div>

      {parcel.owners?.length ? (
        <div className="mt-3 rounded-md border bg-background/70 p-2 text-xs">
          <div className="font-medium text-muted-foreground">Owners</div>
          <div className="mt-1 space-y-1">
            {parcel.owners.slice(0, 3).map((owner) => (
              <p key={owner} className="break-words">
                {owner}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {parcel.mapSketchUrl || parcel.plotReportUrl ? (
          <Button asChild size="sm" variant="outline" className="h-8 text-xs">
            <a
              href={parcel.mapSketchUrl || parcel.plotReportUrl || "#"}
              target="_blank"
              rel="noreferrer"
            >
              Open Official Plot Report
            </a>
          </Button>
        ) : null}
        {parcel.remarks ? (
          <div className="rounded-md border bg-background/70 px-2 py-1 text-[11px] text-muted-foreground">
            {parcel.remarks}
          </div>
        ) : null}
      </div>
    </div>
  );
}

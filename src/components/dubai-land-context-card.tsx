import {
  Building2,
  FileCheck2,
  Landmark,
  LineChart,
  Link as LinkIcon,
  ShieldCheck,
} from "lucide-react";

import type { DubaiLandContextResult } from "@/services/uae/dubai-land-service";
import { Badge } from "@/components/ui/badge";

function formatCurrencyAed(value?: number) {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatNumber(value?: number, digits: number = 1) {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function formatPct(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatDatasetLabel(status: string) {
  return status.replace(/-/g, " ");
}

function getIntegrationTone(status: DubaiLandContextResult["integrationStatus"]) {
  if (status === "live") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  }
  if (status === "onboarding-required") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  }
  return "border-border/60 bg-background/60 text-muted-foreground";
}

function VerificationRow({
  label,
  detail,
  requiredFields,
  availableIdentifiers,
  officialUrl,
}: {
  label: string;
  detail: string;
  requiredFields: string[];
  availableIdentifiers: string[];
  officialUrl: string;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-background/70 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{label}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p>
        </div>
        <a
          href={officialUrl}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-md border border-border/60 px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-secondary/40"
        >
          Open
        </a>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {availableIdentifiers.length > 0 ? (
          availableIdentifiers.map((field) => (
            <Badge key={field} variant="outline" className="text-[10px] text-emerald-300 border-emerald-500/30">
              {field}
            </Badge>
          ))
        ) : (
          requiredFields.slice(0, 4).map((field) => (
            <Badge key={field} variant="outline" className="text-[10px] text-muted-foreground">
              needs {field}
            </Badge>
          ))
        )}
      </div>
    </div>
  );
}

export function DubaiLandContextCard({
  data,
  className = "",
}: {
  data: DubaiLandContextResult;
  className?: string;
}) {
  const liveDatasetCount = data.datasetStatuses.filter((dataset) => dataset.status === "live").length;

  return (
    // This card is intentionally transparent about access state so users can
    // tell the difference between live Dubai data and official-but-manual fallbacks.
    <div className={`space-y-3 rounded-lg border border-border/60 bg-background/80 p-4 ${className}`.trim()}>
      <div className="flex items-start gap-3">
        <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-2">
          <Landmark className="h-4 w-4 text-cyan-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">Dubai Land Context</p>
            <Badge variant="outline" className={`text-[10px] ${getIntegrationTone(data.integrationStatus)}`}>
              {data.integrationStatus}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {liveDatasetCount} live dataset{liveDatasetCount === 1 ? "" : "s"}
            </Badge>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{data.summary}</p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-border/50 bg-background/70 p-3">
          <div className="flex items-center gap-2">
            <LineChart className="h-4 w-4 text-emerald-400" />
            <p className="text-sm font-semibold">Transactions & Pricing</p>
          </div>
          <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
            <div>
              Transactions:{" "}
              <span className="font-medium text-foreground">
                {data.transactions ? `${data.transactions.sampleCount} matched` : "No live match"}
              </span>
            </div>
            {data.transactions ? (
              <>
                <div>
                  Avg amount:{" "}
                  <span className="font-medium text-foreground">
                    {formatCurrencyAed(data.transactions.averageAmountAed)}
                  </span>
                </div>
                <div>
                  Avg sale price / sqm:{" "}
                  <span className="font-medium text-foreground">
                    {data.transactions.averageSalePricePerSqm != null
                      ? `${formatNumber(data.transactions.averageSalePricePerSqm)} AED`
                      : "N/A"}
                  </span>
                </div>
              </>
            ) : null}
            {data.saleIndex ? (
              <>
                <div>
                  Sale index month:{" "}
                  <span className="font-medium text-foreground">
                    {data.saleIndex.latestMonth || "N/A"}
                  </span>
                </div>
                <div>
                  YoY change:{" "}
                  <span className="font-medium text-foreground">
                    {formatPct(data.saleIndex.yearlyChangePct)}
                  </span>
                </div>
                <div>
                  MoM change:{" "}
                  <span className="font-medium text-foreground">
                    {formatPct(data.saleIndex.monthlyChangePct)}
                  </span>
                </div>
              </>
            ) : null}
            {data.valuations ? (
              <div>
                Avg valuation:{" "}
                <span className="font-medium text-foreground">
                  {formatCurrencyAed(data.valuations.averagePropertyTotalValueAed)}
                </span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="rounded-lg border border-border/50 bg-background/70 p-3">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-blue-400" />
            <p className="text-sm font-semibold">Parcel / Project Context</p>
          </div>
          <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
            <div>
              Search label:{" "}
              <span className="font-medium text-foreground">
                {data.searchContext.reverseGeocodedLabel || data.searchContext.locationLabel}
              </span>
            </div>
            <div>
              Area candidates:{" "}
              <span className="font-medium text-foreground">
                {data.searchContext.areaCandidates.length > 0
                  ? data.searchContext.areaCandidates.join(", ")
                  : "None inferred"}
              </span>
            </div>
            {data.landRecord?.landNumber ? (
              <div>
                Land record:{" "}
                <span className="font-medium text-foreground">
                  {data.landRecord.landNumber}
                  {data.landRecord.areaName ? ` in ${data.landRecord.areaName}` : ""}
                </span>
              </div>
            ) : null}
            {data.unitRecord?.unitNumber ? (
              <div>
                Unit record:{" "}
                <span className="font-medium text-foreground">{data.unitRecord.unitNumber}</span>
              </div>
            ) : null}
            {data.projectRecord?.projectName ? (
              <div>
                Project:{" "}
                <span className="font-medium text-foreground">
                  {data.projectRecord.projectName}
                  {data.projectRecord.projectStatus ? ` (${data.projectRecord.projectStatus})` : ""}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border/50 bg-background/70 p-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-amber-400" />
          <p className="text-sm font-semibold">Official Verification Paths</p>
        </div>
        <div className="mt-3 grid gap-3">
          <VerificationRow
            label="Title Deed Verification"
            detail={data.titleDeedVerification.detail}
            requiredFields={data.titleDeedVerification.requiredFields}
            availableIdentifiers={data.titleDeedVerification.availableIdentifiers}
            officialUrl={data.titleDeedVerification.officialUrl}
          />
          <VerificationRow
            label="Property Status"
            detail={data.propertyStatus.detail}
            requiredFields={data.propertyStatus.requiredFields}
            availableIdentifiers={data.propertyStatus.availableIdentifiers}
            officialUrl={data.propertyStatus.officialUrl}
          />
          <VerificationRow
            label="Project Status"
            detail={data.projectStatus.detail}
            requiredFields={data.projectStatus.requiredFields}
            availableIdentifiers={data.projectStatus.availableIdentifiers}
            officialUrl={data.projectStatus.officialUrl}
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-border/50 bg-background/70 p-3">
          <div className="flex items-center gap-2">
            <FileCheck2 className="h-4 w-4 text-violet-400" />
            <p className="text-sm font-semibold">Dataset Status</p>
          </div>
          <div className="mt-3 space-y-2">
            {data.datasetStatuses.map((dataset) => (
              <div key={dataset.datasetKey} className="rounded-md border border-border/40 px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium">{dataset.label}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {formatDatasetLabel(dataset.status)}
                  </Badge>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {dataset.detail}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border/50 bg-background/70 p-3">
          <div className="flex items-center gap-2">
            <LinkIcon className="h-4 w-4 text-cyan-400" />
            <p className="text-sm font-semibold">Official Sources</p>
          </div>
          <div className="mt-3 space-y-2">
            {data.officialLinks.slice(0, 5).map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="block rounded-md border border-border/40 px-2.5 py-2 text-xs text-muted-foreground hover:bg-secondary/30"
              >
                <div className="font-medium text-foreground">{link.label}</div>
                <div className="mt-1">{link.url}</div>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default DubaiLandContextCard;

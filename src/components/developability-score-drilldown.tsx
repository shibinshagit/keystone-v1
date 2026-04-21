"use client";

import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import type {
  DevelopabilityScoreCategory,
  DevelopabilityScoreItem,
} from "@/lib/types";
import { cn } from "@/lib/utils";

interface DrilldownSection {
  id: string;
  label: string;
  color: string;
  category: DevelopabilityScoreCategory;
}

export function DevelopabilityScoreDrilldown({
  sections,
  className,
}: {
  sections: DrilldownSection[];
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-border/60 bg-background/80 p-4", className)}>
      <div>
        <h3 className="text-sm font-bold">Score Drill-Down</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Review each scoring item inside every category, including pass/fail and pending checks.
        </p>
      </div>

      <Accordion type="multiple" className="mt-4 w-full">
        {sections.map((section) => {
          const passedCount = section.category.items.filter((item) => item.status === "pass").length;
          const failedCount = section.category.items.filter((item) => item.status === "fail").length;
          const pendingCount = section.category.items.filter((item) => item.status === "pending").length;

          return (
            <AccordionItem
              key={section.id}
              value={section.id}
              className="mb-3 rounded-lg border border-border/60 px-3 last:mb-0"
            >
              <AccordionTrigger className="py-3 hover:no-underline">
                <div className="flex min-w-0 flex-1 items-start justify-between gap-3 text-left">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: section.color }}
                      />
                      <span className="text-sm font-semibold">{section.label}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <StatusSummaryBadge status="pass" count={passedCount} />
                      <StatusSummaryBadge status="fail" count={failedCount} />
                      <StatusSummaryBadge status="pending" count={pendingCount} />
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold tabular-nums">
                      {section.category.score}/{section.category.maxScore}
                    </div>
                    <div className="text-[11px] text-muted-foreground">category score</div>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent className="space-y-2 pt-1">
                {section.category.items.map((item) => (
                  <ScoreItemRow key={item.id} item={item} />
                ))}
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
}

function ScoreItemRow({ item }: { item: DevelopabilityScoreItem }) {
  const statusMeta =
    item.status === "pass"
      ? {
          label: "Pass",
          className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700",
          icon: CheckCircle2,
        }
      : item.status === "fail"
        ? {
            label: "Fail",
            className: "border-red-500/40 bg-red-500/10 text-red-700",
            icon: XCircle,
          }
        : {
            label: "Pending",
            className: "border-amber-500/40 bg-amber-500/10 text-amber-700",
            icon: Clock3,
          };

  const StatusIcon = statusMeta.icon;

  return (
    <div className="rounded-lg border border-border/50 bg-background/70 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <p className="text-sm font-medium leading-5">{item.title}</p>
          </div>
          {item.detail ? (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {item.detail}
            </p>
          ) : (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              No supporting detail is available for this item yet.
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <Badge variant="outline" className={cn("gap-1 text-[10px] font-semibold", statusMeta.className)}>
            <StatusIcon className="h-3 w-3" />
            {statusMeta.label}
          </Badge>
          <div className="mt-2 text-xs font-semibold tabular-nums">
            {item.score}/{item.maxScore}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusSummaryBadge({
  status,
  count,
}: {
  status: "pass" | "fail" | "pending";
  count: number;
}) {
  const meta =
    status === "pass"
      ? {
          label: `${count} pass`,
          className: "border-emerald-500/40 text-emerald-700",
          icon: CheckCircle2,
        }
      : status === "fail"
        ? {
            label: `${count} fail`,
            className: "border-red-500/40 text-red-700",
            icon: XCircle,
          }
        : {
            label: `${count} pending`,
            className: "border-amber-500/40 text-amber-700",
            icon: AlertCircle,
          };

  const Icon = meta.icon;
  return (
    <Badge variant="outline" className={cn("gap-1 text-[10px] font-medium", meta.className)}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

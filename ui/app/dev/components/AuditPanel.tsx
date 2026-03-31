"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { getAdminAudit } from "@/lib/api";
import { ChevronRight, ChevronDown } from "lucide-react";

interface Props {
  token: string;
  onUnauth: () => void;
}

type AuditRow = [string, string, string, string, string]; // ts, session_id, model, event, detail

const PAGE_SIZE = 100;

export default function AuditPanel({ token, onUnauth }: Props) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    setLoading(true);
    setExpanded(new Set());
    getAdminAudit(token, page * PAGE_SIZE, PAGE_SIZE)
      .then((d) => {
        setRows(d.events as AuditRow[]);
        setTotal(d.total);
      })
      .catch((e) => { if (e.message === "UNAUTHORIZED") onUnauth(); })
      .finally(() => setLoading(false));
  }, [token, page, onUnauth]);

  function toggleExpand(i: number) {
    setExpanded((prev) => {
      const s = new Set(prev);
      s.has(i) ? s.delete(i) : s.add(i);
      return s;
    });
  }

  const start = page * PAGE_SIZE + 1;
  const end = Math.min((page + 1) * PAGE_SIZE, total);

  return (
    <div className="space-y-4">
      {/* Pagination header */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {total > 0 ? `Showing ${start}–${end} of ${total}` : "No audit events"}
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-3 text-xs"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-3 text-xs"
            disabled={end >= total}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="border-b border-border text-[11px] text-muted-foreground uppercase">
                <th className="text-left pb-2 pr-4">Timestamp</th>
                <th className="text-left pb-2 pr-4">Session</th>
                <th className="text-left pb-2 pr-4">Model</th>
                <th className="text-left pb-2 pr-4">Event</th>
                <th className="text-left pb-2">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {rows.map(([ts, sessionId, model, event, detail], i) => {
                const truncated = detail.length > 60 ? detail.slice(0, 60) + "…" : detail;
                const needsExpand = detail.length > 60;
                return (
                  <>
                    <tr key={i} className="hover:bg-surface/40">
                      <td className="py-2 pr-4 text-muted-foreground whitespace-nowrap">{ts}</td>
                      <td className="py-2 pr-4">
                        <span title={sessionId}>{sessionId.slice(0, 8)}…</span>
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">{model || "—"}</td>
                      <td className="py-2 pr-4">
                        <span className="text-accent">{event}</span>
                      </td>
                      <td className="py-2">
                        <span className="text-muted-foreground">
                          {needsExpand && !expanded.has(i) ? truncated : detail}
                        </span>
                        {needsExpand && (
                          <button
                            onClick={() => toggleExpand(i)}
                            className="ml-1 text-muted-foreground hover:text-foreground inline-flex items-center"
                          >
                            {expanded.has(i)
                              ? <ChevronDown className="h-3 w-3" />
                              : <ChevronRight className="h-3 w-3" />}
                          </button>
                        )}
                      </td>
                    </tr>
                  </>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && !loading && (
            <p className="text-center text-muted-foreground text-sm py-8">No audit events yet.</p>
          )}
        </div>
      )}
    </div>
  );
}

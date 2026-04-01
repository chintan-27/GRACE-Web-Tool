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
    <div className="space-y-4 animate-fade-in">
      {/* Pagination header */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-foreground-muted">
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
        <p className="text-sm text-foreground-muted py-8 text-center">Loading…</p>
      ) : (
        <div className="bg-surface border border-border rounded-xl shadow-medical-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-mono">
              <thead>
                <tr className="border-b border-border bg-surface-elevated/50">
                  <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wider text-foreground-muted font-sans">Timestamp</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wider text-foreground-muted font-sans">Session</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wider text-foreground-muted font-sans">Model</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wider text-foreground-muted font-sans">Event</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wider text-foreground-muted font-sans">Detail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([ts, sessionId, model, event, detail], i) => {
                  const truncated = detail.length > 60 ? detail.slice(0, 60) + "…" : detail;
                  const needsExpand = detail.length > 60;
                  return (
                    <tr key={i} className="border-b border-border/50 hover:bg-surface-elevated/40 transition-colors">
                      <td className="py-2.5 px-4 text-xs text-foreground-muted whitespace-nowrap">{ts}</td>
                      <td className="py-2.5 px-4 text-xs">
                        <span title={sessionId} className="text-foreground-secondary">{sessionId.slice(0, 8)}</span>
                      </td>
                      <td className="py-2.5 px-4 text-xs text-foreground-muted">{model || "—"}</td>
                      <td className="py-2.5 px-4">
                        <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium bg-accent/15 text-accent border border-accent/25">
                          {event}
                        </span>
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-foreground-muted">
                            {needsExpand && !expanded.has(i) ? truncated : detail}
                          </span>
                          {needsExpand && (
                            <button
                              onClick={() => toggleExpand(i)}
                              className="text-foreground-muted hover:text-foreground transition-colors shrink-0"
                            >
                              {expanded.has(i)
                                ? <ChevronDown className="h-3.5 w-3.5" />
                                : <ChevronRight className="h-3.5 w-3.5" />}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 && !loading && (
              <p className="text-center text-foreground-muted text-sm py-12">No audit events yet.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

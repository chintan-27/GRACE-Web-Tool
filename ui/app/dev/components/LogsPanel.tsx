"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { adminListSessions, adminGetLogs, SessionMeta } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ChevronRight, ChevronDown, Search, RefreshCw, FileText } from "lucide-react";

interface ParsedLine {
  ts: string;
  level: string;
  message: string;
  extra: Record<string, unknown> | null;
}

type LevelFilter = "ALL" | "INFO" | "ERROR" | "EVENT";
const LEVELS: LevelFilter[] = ["ALL", "INFO", "ERROR", "EVENT"];

const LEVEL_BADGE: Record<string, string> = {
  INFO:  "bg-blue-500/15 text-blue-400 border border-blue-500/30",
  ERROR: "bg-red-500/15 text-red-400 border border-red-500/30",
  EVENT: "bg-amber-500/15 text-amber-400 border border-amber-500/30",
  RAW:   "bg-zinc-500/10 text-zinc-400 border border-zinc-500/20",
};

const ROW_ACCENT: Record<string, string> = {
  ERROR: "border-l-2 border-l-red-500/50 bg-red-500/5",
  EVENT: "border-l-2 border-l-amber-500/40",
};

function parseLogs(raw: string): ParsedLine[] {
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        const obj = JSON.parse(line);
        return {
          ts: obj.ts ?? "",
          level: (obj.level ?? "RAW").toUpperCase(),
          message: obj.message ?? line,
          extra: obj.extra ?? null,
        };
      } catch {
        return { ts: "", level: "RAW", message: line, extra: null };
      }
    });
}

function formatTs(ts: string) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return ts;
  }
}

function relativeTime(epoch: number): string {
  const diff = Date.now() - epoch * 1000;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

interface Props {
  token: string;
  onUnauth: () => void;
}

export default function LogsPanel({ token, onUnauth }: Props) {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [logs, setLogs] = useState<ParsedLine[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("ALL");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const logContainerRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSessions = useCallback(() => {
    adminListSessions(token)
      .then((d) => setSessions(d.sessions))
      .catch((e) => { if (e.message === "UNAUTHORIZED") onUnauth(); })
      .finally(() => setLoadingSessions(false));
  }, [token, onUnauth]);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const fetchLogs = useCallback((sessionId: string, initial: boolean) => {
    if (initial) { setLoadingLogs(true); setExpanded(new Set()); }
    adminGetLogs(token, sessionId)
      .then((raw) => {
        const el = logContainerRef.current;
        const scrollTop = el?.scrollTop ?? 0;
        setLogs(parseLogs(raw).reverse());
        if (!initial && el) requestAnimationFrame(() => { el.scrollTop = scrollTop; });
      })
      .catch((e) => {
        if (e.message === "UNAUTHORIZED") onUnauth();
        else if (initial) setLogs([{ ts: "", level: "ERROR", message: e.message, extra: null }]);
      })
      .finally(() => { if (initial) setLoadingLogs(false); });
  }, [token, onUnauth]);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (!selected) { setLogs([]); return; }
    fetchLogs(selected, true);
    pollRef.current = setInterval(() => fetchLogs(selected, false), 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [selected, fetchLogs]);

  const filtered = logs.filter((l) => {
    if (levelFilter !== "ALL" && l.level !== levelFilter) return false;
    if (search && !l.message.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const errorCount = logs.filter((l) => l.level === "ERROR").length;

  function toggleExpand(i: number) {
    setExpanded((prev) => {
      const s = new Set(prev);
      s.has(i) ? s.delete(i) : s.add(i);
      return s;
    });
  }

  return (
    <div className="flex gap-4 h-[75vh] animate-fade-in">
      {/* Session sidebar */}
      <div className="w-64 shrink-0 flex flex-col bg-surface border border-border rounded-xl shadow-medical-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-surface-elevated/50">
          <span className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
            Sessions
            {!loadingSessions && (
              <span className="ml-1.5 font-normal normal-case tracking-normal text-foreground-secondary">
                {sessions.length}
              </span>
            )}
          </span>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 hover:bg-surface-elevated" onClick={fetchSessions}>
            <RefreshCw className="h-3 w-3 text-foreground-muted" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sessions.length === 0 && !loadingSessions && (
            <p className="text-xs text-foreground-muted text-center py-8">No sessions found</p>
          )}
          {sessions.map((s) => (
            <button
              key={s.session_id}
              onClick={() => setSelected(s.session_id)}
              className={`w-full text-left px-4 py-3 border-b border-border/30 transition-colors ${
                selected === s.session_id
                  ? "bg-accent/10 border-l-2 border-l-accent"
                  : "hover:bg-surface-elevated/50 border-l-2 border-l-transparent"
              }`}
            >
              <div className="flex items-center gap-2">
                <FileText className={`h-3 w-3 shrink-0 ${selected === s.session_id ? "text-accent" : "text-foreground-muted"}`} />
                <span className={`font-mono text-xs truncate ${selected === s.session_id ? "text-foreground" : "text-foreground-secondary"}`}>
                  {s.session_id.slice(0, 12)}
                </span>
              </div>
              <div className="text-[10px] text-foreground-muted mt-0.5 pl-5">
                {relativeTime(s.created)}
                {!s.has_logs && <span className="ml-1 opacity-40">(no logs)</span>}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Log viewer */}
      <div className="flex-1 min-w-0 flex flex-col gap-3">
        {selected ? (
          <>
            {/* Toolbar */}
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-foreground-muted" />
                <Input
                  placeholder="Filter logs…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 text-xs pl-9 bg-surface border-border"
                />
              </div>
              <div className="flex items-center gap-0.5 bg-surface-elevated border border-border rounded-lg p-0.5">
                {LEVELS.map((l) => (
                  <button
                    key={l}
                    className={`px-3 py-1 rounded-md text-[11px] font-medium transition-colors ${
                      levelFilter === l
                        ? "bg-surface text-foreground shadow-sm border border-border/80"
                        : "text-foreground-muted hover:text-foreground"
                    }`}
                    onClick={() => setLevelFilter(l)}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3 ml-auto text-[11px] text-foreground-muted">
                {errorCount > 0 && (
                  <span className="text-red-400 font-medium">{errorCount} error{errorCount !== 1 ? "s" : ""}</span>
                )}
                <span>{filtered.length} / {logs.length} lines</span>
              </div>
            </div>

            {/* Log lines */}
            <div className="flex-1 bg-surface border border-border rounded-xl shadow-medical-lg overflow-hidden flex flex-col">
              <div ref={logContainerRef} className="flex-1 overflow-y-auto font-mono text-xs">
                {loadingLogs ? (
                  <div className="flex items-center justify-center h-full text-foreground-muted text-sm">
                    Loading logs…
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-foreground-muted text-sm">
                    {logs.length === 0 ? "No log entries yet" : "No matching lines"}
                  </div>
                ) : (
                  <div className="divide-y divide-border/20">
                    {filtered.map((line, i) => (
                      <div key={i}>
                        <div
                          className={`flex items-start gap-3 px-4 py-2 hover:bg-surface-elevated/40 transition-colors ${ROW_ACCENT[line.level] ?? ""}`}
                        >
                          <span className="text-[11px] text-foreground-muted whitespace-nowrap w-16 shrink-0 pt-px tabular-nums">
                            {formatTs(line.ts)}
                          </span>
                          <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold shrink-0 mt-px uppercase tracking-wide ${LEVEL_BADGE[line.level] ?? LEVEL_BADGE.RAW}`}>
                            {line.level}
                          </span>
                          <span className="break-words flex-1 leading-relaxed text-foreground-secondary">{line.message}</span>
                          {line.extra && (
                            <button
                              onClick={() => toggleExpand(i)}
                              className="text-foreground-muted hover:text-foreground shrink-0 pt-px"
                            >
                              {expanded.has(i)
                                ? <ChevronDown className="h-3.5 w-3.5" />
                                : <ChevronRight className="h-3.5 w-3.5" />}
                            </button>
                          )}
                        </div>
                        {expanded.has(i) && line.extra && (
                          <div className="px-4 pb-3 pl-[7.5rem]">
                            <pre className="bg-surface-elevated border border-border/50 rounded-lg p-3 text-[11px] overflow-x-auto text-foreground-muted leading-relaxed">
                              {JSON.stringify(line.extra, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 bg-surface border border-border rounded-xl shadow-medical-lg flex items-center justify-center">
            <div className="text-center">
              <div className="p-4 rounded-full bg-surface-elevated mx-auto w-fit mb-3">
                <FileText className="h-7 w-7 text-foreground-muted" />
              </div>
              <p className="text-sm text-foreground-secondary">Select a session to view logs</p>
              <p className="text-xs text-foreground-muted mt-1">{sessions.length} session{sessions.length !== 1 ? "s" : ""} available</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

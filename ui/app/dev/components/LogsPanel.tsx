"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { adminListSessions, adminGetLogs, SessionMeta } from "@/lib/api";
import { Card } from "@/components/ui/card";
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

const LEVEL_COLORS: Record<string, string> = {
  INFO:  "bg-blue-500/15 text-blue-400 border border-blue-500/20",
  ERROR: "bg-red-500/15 text-red-400 border border-red-500/20",
  EVENT: "bg-amber-500/15 text-amber-400 border border-amber-500/20",
  RAW:   "bg-zinc-500/10 text-zinc-400 border border-zinc-500/20",
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
  const [autoScroll, setAutoScroll] = useState(true);
  const logEndRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch sessions
  const fetchSessions = useCallback(() => {
    adminListSessions(token)
      .then((d) => setSessions(d.sessions))
      .catch((e) => { if (e.message === "UNAUTHORIZED") onUnauth(); })
      .finally(() => setLoadingSessions(false));
  }, [token, onUnauth]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Fetch logs for selected session + poll every 3s for live tailing
  const fetchLogs = useCallback((sessionId: string, initial: boolean) => {
    if (initial) {
      setLoadingLogs(true);
      setExpanded(new Set());
    }
    adminGetLogs(token, sessionId)
      .then((raw) => setLogs(parseLogs(raw)))
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
    // Poll for new logs every 3 seconds
    pollRef.current = setInterval(() => fetchLogs(selected, false), 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [selected, fetchLogs]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  // Detect manual scroll to disable auto-scroll
  function handleScroll() {
    const el = logContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }

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

  function scrollToBottom() {
    setAutoScroll(true);
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <div className="flex gap-4 h-[75vh]">
      {/* Session sidebar */}
      <Card className="w-72 shrink-0 flex flex-col overflow-hidden">
        <div className="px-3 py-3 border-b border-border flex items-center justify-between">
          <span className="text-xs font-medium text-foreground">
            Sessions
            <span className="ml-1.5 text-muted-foreground font-normal">
              {loadingSessions ? "…" : sessions.length}
            </span>
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={fetchSessions}
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sessions.length === 0 && !loadingSessions && (
            <p className="text-xs text-muted-foreground text-center py-8">No sessions found</p>
          )}
          {sessions.map((s) => (
            <button
              key={s.session_id}
              onClick={() => setSelected(s.session_id)}
              className={`w-full text-left px-3 py-2.5 border-b border-border/30 transition-colors ${
                selected === s.session_id
                  ? "bg-accent/10 border-l-2 border-l-accent"
                  : "hover:bg-muted/50 border-l-2 border-l-transparent"
              }`}
            >
              <div className="flex items-center gap-2">
                <FileText className={`h-3 w-3 shrink-0 ${selected === s.session_id ? "text-accent" : "text-muted-foreground"}`} />
                <span className="font-mono text-xs truncate">{s.session_id.slice(0, 12)}</span>
              </div>
              <div className="text-[10px] text-muted-foreground mt-1 pl-5">
                {relativeTime(s.created)}
                {!s.has_logs && <span className="ml-1 opacity-50">(no logs)</span>}
              </div>
            </button>
          ))}
        </div>
      </Card>

      {/* Log viewer */}
      <div className="flex-1 min-w-0 flex flex-col">
        {selected ? (
          <>
            {/* Toolbar */}
            <div className="flex items-center gap-2 mb-3">
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Filter logs…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 text-xs pl-8"
                />
              </div>
              <div className="flex gap-0.5 bg-muted/50 rounded-md p-0.5">
                {LEVELS.map((l) => (
                  <button
                    key={l}
                    className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                      levelFilter === l
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => setLevelFilter(l)}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3 ml-auto text-[11px] text-muted-foreground">
                {errorCount > 0 && (
                  <span className="text-red-400 font-medium">{errorCount} error{errorCount !== 1 ? "s" : ""}</span>
                )}
                <span>{filtered.length} / {logs.length} lines</span>
              </div>
            </div>

            {/* Log lines */}
            <Card className="flex-1 overflow-hidden flex flex-col">
              <div
                ref={logContainerRef}
                onScroll={handleScroll}
                className="flex-1 overflow-y-auto font-mono text-xs"
              >
                {loadingLogs ? (
                  <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                    Loading logs…
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                    {logs.length === 0 ? "No log entries yet" : "No matching lines"}
                  </div>
                ) : (
                  <div className="divide-y divide-border/30">
                    {filtered.map((line, i) => (
                      <div key={i}>
                        <div className="flex items-start gap-3 px-3 py-1.5 hover:bg-muted/30 transition-colors">
                          <span className="text-[11px] text-muted-foreground whitespace-nowrap w-16 shrink-0 pt-0.5 tabular-nums">
                            {formatTs(line.ts)}
                          </span>
                          <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium shrink-0 ${LEVEL_COLORS[line.level] ?? LEVEL_COLORS.RAW}`}>
                            {line.level}
                          </span>
                          <span className="break-all flex-1 leading-relaxed">{line.message}</span>
                          {line.extra && (
                            <button
                              onClick={() => toggleExpand(i)}
                              className="text-muted-foreground hover:text-foreground shrink-0 pt-0.5"
                            >
                              {expanded.has(i)
                                ? <ChevronDown className="h-3.5 w-3.5" />
                                : <ChevronRight className="h-3.5 w-3.5" />}
                            </button>
                          )}
                        </div>
                        {expanded.has(i) && line.extra && (
                          <div className="mx-3 mb-2 ml-[7.5rem]">
                            <pre className="bg-muted/50 border border-border/50 rounded-md p-3 text-[11px] overflow-x-auto text-muted-foreground leading-relaxed">
                              {JSON.stringify(line.extra, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    ))}
                    <div ref={logEndRef} />
                  </div>
                )}
              </div>

              {/* Scroll-to-bottom button */}
              {!autoScroll && filtered.length > 0 && (
                <div className="border-t border-border px-3 py-1.5 flex justify-center">
                  <button
                    onClick={scrollToBottom}
                    className="text-[11px] text-accent hover:underline"
                  >
                    Scroll to latest
                  </button>
                </div>
              )}
            </Card>
          </>
        ) : (
          <Card className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <FileText className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Select a session to view logs</p>
              <p className="text-xs text-muted-foreground/60 mt-1">{sessions.length} session{sessions.length !== 1 ? "s" : ""} available</p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

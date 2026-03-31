"use client";

import { useEffect, useState } from "react";
import { adminListSessions, adminGetLogs, SessionMeta } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ChevronRight, ChevronDown } from "lucide-react";

interface ParsedLine {
  ts: string;
  level: string;
  message: string;
  extra: Record<string, unknown> | null;
}

type LevelFilter = "ALL" | "INFO" | "ERROR" | "EVENT";
const LEVELS: LevelFilter[] = ["ALL", "INFO", "ERROR", "EVENT"];

const LEVEL_COLOR: Record<string, string> = {
  INFO:  "bg-blue-500/15 text-blue-400",
  ERROR: "bg-destructive/15 text-destructive",
  EVENT: "bg-accent/15 text-accent",
  RAW:   "bg-muted text-muted-foreground",
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
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, { hour12: false });
  } catch {
    return ts;
  }
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
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("ALL");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    adminListSessions(token)
      .then((d) => setSessions(d.sessions))
      .catch((e) => { if (e.message === "UNAUTHORIZED") onUnauth(); });
  }, [token, onUnauth]);

  useEffect(() => {
    if (!selected) { setLogs([]); return; }
    setLoadingLogs(true);
    setExpanded(new Set());
    adminGetLogs(token, selected)
      .then((raw) => setLogs(parseLogs(raw)))
      .catch((e) => {
        if (e.message === "UNAUTHORIZED") onUnauth();
        else setLogs([{ ts: "", level: "ERROR", message: e.message, extra: null }]);
      })
      .finally(() => setLoadingLogs(false));
  }, [selected, token, onUnauth]);

  const filtered = logs.filter((l) => {
    if (levelFilter !== "ALL" && l.level !== levelFilter) return false;
    if (search && !l.message.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  function toggleExpand(i: number) {
    setExpanded((prev) => {
      const s = new Set(prev);
      s.has(i) ? s.delete(i) : s.add(i);
      return s;
    });
  }

  return (
    <div className="flex gap-4 h-[70vh]">
      {/* Session list */}
      <div className="w-64 shrink-0 flex flex-col">
        <p className="text-[11px] uppercase text-muted-foreground mb-2">
          Sessions ({sessions.length})
        </p>
        <div className="flex-1 overflow-y-auto space-y-0.5">
          {sessions.map((s) => (
            <button
              key={s.session_id}
              onClick={() => setSelected(s.session_id)}
              className={`w-full text-left px-3 py-2 rounded text-xs transition-colors ${
                selected === s.session_id
                  ? "bg-accent text-background font-medium"
                  : "hover:bg-surface text-foreground"
              }`}
            >
              <div className="font-mono truncate">{s.session_id.slice(0, 16)}…</div>
              <div className="text-[10px] opacity-60 mt-0.5">
                {new Date(s.created * 1000).toLocaleString()}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Log viewer */}
      <div className="flex-1 min-w-0 flex flex-col">
        {selected ? (
          <>
            {/* Toolbar */}
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <Input
                placeholder="Search messages…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-7 text-xs w-52"
              />
              <div className="flex gap-1">
                {LEVELS.map((l) => (
                  <Button
                    key={l}
                    size="sm"
                    variant={levelFilter === l ? "default" : "outline"}
                    className="h-7 px-2 text-[11px]"
                    onClick={() => setLevelFilter(l)}
                  >
                    {l}
                  </Button>
                ))}
              </div>
              <span className="text-[11px] text-muted-foreground ml-auto">
                {filtered.length} / {logs.length} lines
              </span>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-y-auto font-mono text-xs">
              {loadingLogs ? (
                <p className="text-muted-foreground">Loading…</p>
              ) : filtered.length === 0 ? (
                <p className="text-muted-foreground">No matching log lines.</p>
              ) : (
                <table className="w-full">
                  <tbody>
                    {filtered.map((line, i) => (
                      <>
                        <tr key={i} className="hover:bg-surface/40 border-b border-border/40">
                          <td className="py-1 pr-3 text-[11px] text-muted-foreground whitespace-nowrap w-20">
                            {formatTs(line.ts)}
                          </td>
                          <td className="py-1 pr-3 w-16">
                            <span className={`inline-flex items-center rounded px-1 py-0.5 text-[10px] font-medium ${LEVEL_COLOR[line.level] ?? LEVEL_COLOR.RAW}`}>
                              {line.level}
                            </span>
                          </td>
                          <td className="py-1 pr-2 break-all">{line.message}</td>
                          <td className="py-1 w-6">
                            {line.extra && (
                              <button
                                onClick={() => toggleExpand(i)}
                                className="text-muted-foreground hover:text-foreground"
                              >
                                {expanded.has(i)
                                  ? <ChevronDown className="h-3 w-3" />
                                  : <ChevronRight className="h-3 w-3" />}
                              </button>
                            )}
                          </td>
                        </tr>
                        {expanded.has(i) && line.extra && (
                          <tr key={`${i}-extra`}>
                            <td colSpan={4} className="pb-2 pt-0">
                              <pre className="bg-surface rounded p-2 text-[11px] overflow-x-auto text-muted-foreground">
                                {JSON.stringify(line.extra, null, 2)}
                              </pre>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Select a session to view logs
          </div>
        )}
      </div>
    </div>
  );
}

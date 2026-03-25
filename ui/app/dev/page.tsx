"use client";

import { useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://10.15.224.253:8100";

interface Session {
  session_id: string;
  has_logs: boolean;
  created: number;
}

export default function LogsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [logs, setLogs] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/logs`)
      .then((res) => res.json())
      .then((data) => setSessions(data.sessions))
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!selectedSession) {
      setLogs("");
      return;
    }

    fetch(`${API_BASE}/logs/${selectedSession}`)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.text();
      })
      .then(setLogs)
      .catch((err) => setLogs(`Error: ${err.message}`));
  }, [selectedSession]);

  const formatDate = (ts: number) => {
    return new Date(ts * 1000).toLocaleString();
  };

  return (
    <div className="min-h-screen bg-black text-white p-6 font-mono text-sm">
      <h1 className="text-xl font-bold mb-6">Session Logs</h1>

      {error && <div className="text-red-400 mb-4">Error: {error}</div>}

      <div className="flex gap-6">
        {/* Session list */}
        <div className="w-80 shrink-0">
          <div className="text-neutral-400 text-xs uppercase mb-2">Sessions ({sessions.length})</div>
          <div className="space-y-1 max-h-[80vh] overflow-y-auto">
            {sessions.map((s) => (
              <button
                key={s.session_id}
                onClick={() => setSelectedSession(s.session_id)}
                className={`w-full text-left px-3 py-2 rounded text-xs ${
                  selectedSession === s.session_id
                    ? "bg-amber-600 text-white"
                    : "bg-neutral-900 hover:bg-neutral-800"
                }`}
              >
                <div className="truncate">{s.session_id}</div>
                <div className="text-neutral-400 text-[10px]">{formatDate(s.created)}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Logs panel */}
        <div className="flex-1 min-w-0">
          {selectedSession ? (
            <>
              <div className="text-neutral-400 text-xs uppercase mb-2">
                Logs: {selectedSession}
              </div>
              <pre className="whitespace-pre-wrap break-words bg-neutral-900 p-4 rounded max-h-[80vh] overflow-y-auto">
                {logs || "Loading..."}
              </pre>
            </>
          ) : (
            <div className="text-neutral-500">Select a session to view logs</div>
          )}
        </div>
      </div>
    </div>
  );
}

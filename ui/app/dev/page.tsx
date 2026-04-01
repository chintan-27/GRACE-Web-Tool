"use client";

import { useEffect, useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { getHealth, getAdminJobs, HealthResponse, AdminJobsResponse } from "@/lib/api";
import LoginGate from "./components/LoginGate";
import HealthPanel from "./components/HealthPanel";
import JobsPanel from "./components/JobsPanel";
import LogsPanel from "./components/LogsPanel";
import AuditPanel from "./components/AuditPanel";
import { LogOut, RefreshCw } from "lucide-react";

function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [jobsData, setJobsData] = useState<AdminJobsResponse | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Restore token from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem("admin_token");
    if (stored && !isTokenExpired(stored)) {
      setToken(stored);
    } else {
      localStorage.removeItem("admin_token");
    }
  }, []);

  function handleUnauth() {
    localStorage.removeItem("admin_token");
    setToken(null);
  }

  async function fetchData(t: string) {
    try {
      const [h, j] = await Promise.all([getHealth(), getAdminJobs(t)]);
      setHealth(h);
      setJobsData(j);
      setLastUpdated(new Date());
    } catch (e: unknown) {
      if (e instanceof Error && e.message === "UNAUTHORIZED") handleUnauth();
    }
  }

  async function manualRefresh() {
    if (!token) return;
    setRefreshing(true);
    await fetchData(token);
    setRefreshing(false);
  }

  // Poll every 5 seconds while authenticated
  useEffect(() => {
    if (!token) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    fetchData(token);
    intervalRef.current = setInterval(() => fetchData(token), 5000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (!token) {
    return <LoginGate onLogin={setToken} />;
  }

  const runningCount = jobsData?.jobs.filter(j => j.status === "running").length ?? 0;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8 pb-6 border-b border-border">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Admin Dashboard</h1>
            <p className="text-sm text-foreground-muted mt-1">
              {jobsData ? (
                <>
                  {runningCount > 0 && (
                    <span className="inline-flex items-center gap-1.5 mr-3">
                      <span className="h-2 w-2 rounded-full bg-accent animate-pulse" />
                      <span className="text-accent font-medium">{runningCount} running</span>
                    </span>
                  )}
                  <span>{jobsData.jobs.length} active job{jobsData.jobs.length !== 1 ? "s" : ""}</span>
                </>
              ) : "Loading…"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              variant="outline"
              className="h-9 gap-2 text-xs border-border hover:bg-surface-elevated"
              onClick={manualRefresh}
              disabled={refreshing}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-9 gap-2 text-xs text-foreground-muted hover:text-foreground"
              onClick={handleUnauth}
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="overview">
          <TabsList className="mb-6">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="jobs">
              Live Jobs
              {jobsData && jobsData.jobs.length > 0 && (
                <span className="ml-1.5 rounded-full bg-accent text-background text-[10px] font-bold px-1.5 py-0.5 leading-none">
                  {jobsData.jobs.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
            <TabsTrigger value="audit">Audit</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <HealthPanel
              health={health}
              queueDepths={jobsData?.queue_depths ?? null}
              jobs={jobsData?.jobs ?? []}
              lastUpdated={lastUpdated}
            />
          </TabsContent>

          <TabsContent value="jobs">
            <JobsPanel
              jobs={jobsData?.jobs ?? []}
              onRefresh={() => token && fetchData(token)}
            />
          </TabsContent>

          <TabsContent value="logs">
            <LogsPanel token={token} onUnauth={handleUnauth} />
          </TabsContent>

          <TabsContent value="audit">
            <AuditPanel token={token} onUnauth={handleUnauth} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

import { useState, type FormEvent, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchLocalKeys,
  fetchLocalApps,
  getLocalToken,
  setLocalToken,
  clearLocalToken,
  LocalApiError,
  type LocalKeyStat,
} from "../localApi";
import { toLocalISODate, shiftLocalDate, formatDayLabel, formatShare } from "../utils";
import RefreshStatus from "./RefreshStatus";
import KeyboardHeatmap from "./KeyboardHeatmap";
import AppsBreakdown from "./AppsBreakdown";

// Same small arrow-button treatment as DayView's day switcher (not
// imported from there -- it's a one-off style object, not worth sharing
// across a file boundary for this).
function dayArrowButtonStyle(disabled: boolean): CSSProperties {
  return {
    background: "var(--surface-1)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    width: 26,
    height: 26,
    color: disabled ? "var(--text-muted)" : "var(--text-secondary)",
    fontSize: 14,
    lineHeight: 1,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.4 : 1,
  };
}

type ViewMode = "list" | "keyboard" | "apps";

const MODE_LABELS: Record<ViewMode, string> = {
  list: "List",
  keyboard: "Keyboard",
  apps: "By app",
};

// Per-key stats never sync to the backend (see ROADMAP.md's "Privacy
// decision" section), so this view is fundamentally different from every
// other tab: it talks directly to agent.py's local-only API instead of
// the Go backend, and only ever shows data for whichever device the
// browser itself happens to be running on.
export default function KeysView() {
  const [tokenInput, setTokenInput] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [appFilter, setAppFilter] = useState<string | null>(null);
  // Day filter, shared across all three modes (added 2026-09-02, widened
  // from "By app"-only the same day once it turned out List/Keyboard
  // wanted it too -- one switcher, since "which app did I use most today"
  // and "which key did I press most today" are the same kind of question
  // against the same local_date column, just a different GROUP BY on the
  // agent side). null means "All time," the same all-time sum every mode
  // always showed before day filtering existed, kept as the default so
  // nothing changes for anyone who doesn't touch the switcher. See
  // fetchLocalApps's own note on why this needed a schema change
  // (key_counts never recorded a date before now) and why data from
  // before that change can't be attributed to any single day.
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const todayIso = toLocalISODate(new Date());
  // The query key below has to change whenever the actual code changes --
  // not just whether one is set -- or React Query treats "connect with
  // code A" and "connect with code B" as the same query and happily
  // serves back A's cached (still-fresh) result instead of fetching with
  // B. Keying on the token string itself is what forces a real refetch.
  // appFilter/selectedDate have to be in the key too, for the same reason
  // -- switching apps or days needs a real refetch, not a stale cached
  // result for the previous filter.
  const [token, setToken] = useState<string | null>(getLocalToken());

  const keysQuery = useQuery({
    queryKey: ["local-keys", token, appFilter, selectedDate],
    // 100 (the local server's max) rather than 25 -- the keyboard view
    // needs full coverage, not just the top few, or most of the layout
    // would render as "never pressed" even for keys you use often.
    queryFn: () => fetchLocalKeys(100, appFilter, selectedDate),
    enabled: !!token && viewMode !== "apps",
    retry: false,
  });

  // Separate query (and separate agent.py endpoint, /local/apps) from
  // keysQuery above -- a per-app total isn't a filter or a grouping of
  // the same key rows, it's summed straight from key_counts on the
  // agent's side. Only enabled while that mode is actually showing, so
  // switching to List/Keyboard doesn't keep re-fetching it in the
  // background for nothing.
  const appsQuery = useQuery({
    queryKey: ["local-apps", token, selectedDate],
    queryFn: () => fetchLocalApps(selectedDate),
    enabled: !!token && viewMode === "apps",
    retry: false,
  });

  function handleConnect(e: FormEvent) {
    e.preventDefault();
    if (!tokenInput.trim()) return;
    setLocalToken(tokenInput);
    setToken(tokenInput.trim());
    setTokenInput("");
  }

  function handleForget() {
    clearLocalToken();
    setToken(null);
  }

  if (!token) {
    return (
      <div style={{ maxWidth: 440 }}>
        <p style={{ color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.6, margin: "0 0 12px" }}>
          Per-key stats never leave your computer, so this tab talks
          directly to the KeyCount agent running on <em>this</em> machine
          -- not the backend. Get this device's access code by running:
        </p>
        <pre
          style={{
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "10px 12px",
            fontSize: 13,
            color: "var(--text-primary)",
            margin: "0 0 16px",
          }}
        >
          python3 agent.py --show-local-token
        </pre>
        <form onSubmit={handleConnect} style={{ display: "flex", gap: 8 }}>
          <input
            type="password"
            autoComplete="off"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="Paste the code"
            style={{
              flex: 1,
              background: "var(--plane)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "8px 10px",
              color: "var(--text-primary)",
              fontSize: 13,
            }}
          />
          <button
            type="submit"
            style={{
              background: "var(--accent)",
              border: "none",
              borderRadius: 6,
              padding: "8px 14px",
              color: "#ffffff",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Connect
          </button>
        </form>
      </div>
    );
  }

  // Everything below reads from whichever of the two queries is actually
  // showing -- same idea as RefreshStatus already using "the active
  // query" rather than being hardwired to one. React Query's types make
  // this a union (LocalKeysResponse vs LocalAppsResponse), which is fine
  // for the handful of fields (device_name, dataUpdatedAt, isFetching,
  // refetch) every branch below reads off it in common; the two data
  // shapes are only ever destructured separately, inside their own
  // viewMode branch.
  const activeQuery = viewMode === "apps" ? appsQuery : keysQuery;
  const error = (activeQuery.error ?? null) as LocalApiError | null;

  const title = activeQuery.data
    ? viewMode === "apps"
      ? `Keystrokes by app on ${activeQuery.data.device_name}`
      : `Top keys on ${activeQuery.data.device_name}`
    : viewMode === "apps"
      ? "Keystrokes by app (this device)"
      : "Top keys (this device)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <h2 style={{ fontSize: 15, color: "var(--text-secondary)", fontWeight: 600, margin: 0 }}>
            {title}
          </h2>
          <div style={{ display: "flex", gap: 6 }}>
            {(["list", "keyboard", "apps"] as ViewMode[]).map((mode) => {
              const active = viewMode === mode;
              return (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  style={{
                    background: active ? "var(--accent)" : "var(--surface-1)",
                    color: active ? "#ffffff" : "var(--text-secondary)",
                    border: "1px solid " + (active ? "var(--accent)" : "var(--border)"),
                    borderRadius: 6,
                    padding: "5px 12px",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {MODE_LABELS[mode]}
                </button>
              );
            })}
          </div>
          {/* Day switcher, shared by all three modes (added 2026-09-02) --
              same prev/next/reset shape as DayView's day switcher on the
              Today tab, so it reads as the same interaction rather than a
              new one. The very first prev click from "All time"
              (selectedDate === null) lands on Today rather than skipping
              straight to yesterday -- shiftLocalDate(todayIso, -1) would
              do exactly that if applied unconditionally here, since null
              doesn't mean "today," it means "no day picked yet." */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              onClick={() => setSelectedDate((d) => (d === null ? todayIso : shiftLocalDate(d, -1)))}
              aria-label="Previous day"
              style={dayArrowButtonStyle(false)}
            >
              ‹
            </button>
            <span
              data-testid="keys-day-label"
              style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600, minWidth: 84, textAlign: "center" }}
            >
              {selectedDate === null ? "All time" : formatDayLabel(selectedDate, todayIso)}
            </span>
            <button
              onClick={() =>
                setSelectedDate((d) => (d !== null && d < todayIso ? shiftLocalDate(d, 1) : d))
              }
              disabled={selectedDate !== null && selectedDate >= todayIso}
              aria-label="Next day"
              style={dayArrowButtonStyle(selectedDate !== null && selectedDate >= todayIso)}
            >
              ›
            </button>
            {selectedDate !== null && (
              <button
                onClick={() => setSelectedDate(null)}
                style={{
                  background: "none",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: "4px 10px",
                  color: "var(--text-secondary)",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                All time
              </button>
            )}
          </div>
          {/* The per-app filter only makes sense for List/Keyboard (it
              narrows which key rows are shown) -- "By app" already IS the
              per-app breakdown, so filtering it down to one app would just
              leave a single 100% bar. */}
          {viewMode !== "apps" && keysQuery.data && keysQuery.data.apps.length > 1 && (
            <select
              value={appFilter ?? ""}
              onChange={(e) => setAppFilter(e.target.value || null)}
              style={{
                background: "var(--surface-1)",
                color: "var(--text-secondary)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "5px 10px",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              <option value="">All apps</option>
              {keysQuery.data.apps.map((app) => (
                <option key={app} value={app}>
                  {app}
                </option>
              ))}
            </select>
          )}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <RefreshStatus
            data={activeQuery.data}
            dataUpdatedAt={activeQuery.dataUpdatedAt}
            isFetching={activeQuery.isFetching}
            onRefresh={() => activeQuery.refetch()}
          />
          <button
            onClick={handleForget}
            style={{
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "4px 10px",
              color: "var(--text-muted)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Forget code
          </button>
        </div>
      </div>

      {activeQuery.isLoading && <div style={{ color: "var(--text-muted)" }}>Loading...</div>}

      <LocalApiErrorNotice error={error} onForget={handleForget} />

      {viewMode === "apps" ? (
        <>
          {appsQuery.data && appsQuery.data.apps.length === 0 && (
            <div style={{ color: "var(--text-muted)", fontSize: 14 }}>
              {selectedDate === null
                ? "No per-app data yet."
                : `No per-app data for ${formatDayLabel(selectedDate, todayIso)}.`}
            </div>
          )}
          {appsQuery.data && appsQuery.data.apps.length > 0 && (
            <AppsBreakdown apps={appsQuery.data.apps} />
          )}
        </>
      ) : (
        <>
          {keysQuery.data && keysQuery.data.keys.length === 0 && (
            <div style={{ color: "var(--text-muted)", fontSize: 14 }}>
              {selectedDate === null
                ? "No per-key data yet."
                : `No per-key data for ${formatDayLabel(selectedDate, todayIso)}.`}
            </div>
          )}
          {keysQuery.data && keysQuery.data.keys.length > 0 && (
            viewMode === "list" ? (
              <KeysBarList keys={keysQuery.data.keys} />
            ) : (
              <KeyboardHeatmap keys={keysQuery.data.keys} />
            )
          )}
        </>
      )}
    </div>
  );
}

// Shared by List/Keyboard/By app -- all three read from the local agent
// over the same token, so they can all fail the same three ways.
function LocalApiErrorNotice({ error, onForget }: { error: LocalApiError | null; onForget: () => void }) {
  if (error?.kind === "unreachable") {
    return (
      <div style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6 }}>
        Couldn't reach a local KeyCount agent on this device. This tab only
        works while <code>python3 agent.py</code> is running on the same
        computer you're viewing this from -- it won't show another
        device's stats, on purpose.
      </div>
    );
  }
  if (error?.kind === "unauthorized") {
    return (
      <div style={{ color: "#e34948", fontSize: 14, lineHeight: 1.6 }}>
        That code doesn't match this device's agent. Double-check it with{" "}
        <code>python3 agent.py --show-local-token</code>, or{" "}
        <button
          onClick={onForget}
          style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0, fontSize: 14 }}
        >
          enter a new one
        </button>
        .
      </div>
    );
  }
  if (error?.kind === "other") {
    return <div style={{ color: "#e34948" }}>Couldn't load data.</div>;
  }
  return null;
}

// Same ranked-bar-list treatment as AppsBreakdown -- one measure (count)
// across categories (keys), single accent hue throughout.
function KeysBarList({ keys }: { keys: LocalKeyStat[] }) {
  const max = Math.max(...keys.map((k) => k.count), 1);
  // Share of THIS list's own total -- see formatShare's own comment on why
  // that's the right denominator (not some separate all-time figure this
  // component doesn't have). fetchLocalKeys is capped at 100 keys, so on
  // the rare device with more distinct keys ever pressed than that, this
  // total (and therefore every percentage below) is of "the keys shown,"
  // not literally everything -- same caveat that already applies to "top
  // keys" being a top-100 list in the first place, not new to this.
  const total = keys.reduce((sum, k) => sum + k.count, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {keys.map((k) => {
        const pct = Math.max((k.count / max) * 100, 2);
        return (
          <div key={k.key}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 13,
                color: "var(--text-secondary)",
                marginBottom: 4,
              }}
            >
              <span style={{ fontFamily: "ui-monospace, monospace" }}>{k.key}</span>
              <span className="tabular">
                {k.count.toLocaleString()} ({formatShare(k.count, total)})
              </span>
            </div>
            <div style={{ background: "var(--gridline)", borderRadius: 4, height: 10, overflow: "hidden" }}>
              <div
                style={{
                  width: `${pct}%`,
                  height: "100%",
                  background: "var(--accent)",
                  borderRadius: 4,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

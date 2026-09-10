import { useEffect, useRef, useState } from "react";

interface RefreshStatusProps {
  // The query's own data, so this component can tell an actual new sync
  // apart from a fetch that merely completed and handed back the exact
  // same numbers it already had -- see the comment on the effect below.
  data: unknown;
  dataUpdatedAt: number; // ms epoch of the fetch that produced `data`, 0 if nothing has loaded yet
  isFetching: boolean;
  onRefresh: () => void;
}

const NO_NEW_SYNC_DISPLAY_MS = 4_000;

// "How fresh is this" readout, plus a manual "Check for updates" button.
//
// This used to just show react-query's dataUpdatedAt -- the time of the
// last fetch that *completed*, whether or not it came back with anything
// new. That made spamming the button pointless in a misleading way: the
// backend only actually has new numbers roughly once a minute (the
// agent's own sync cycle -- see SYNC_LAG_REFETCH_MS et al.), but the
// label happily jumped forward on every click regardless, so mashing
// "Refresh" *looked* like it was doing something every time even when it
// wasn't. Now the time only moves when the payload itself changes, and a
// manual click that comes back with nothing new says so instead of
// quietly pretending it refreshed.
export default function RefreshStatus({ data, dataUpdatedAt, isFetching, onRefresh }: RefreshStatusProps) {
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [showNoNewSync, setShowNoNewSync] = useState(false);
  // Serialized snapshot of the last data we actually saw, so a fetch that
  // completes with an identical payload can be told apart from one that
  // changed something. undefined (vs. any real serialized value,
  // including "null") means "no fetch has completed yet."
  const prevSerializedRef = useRef<string | undefined>(undefined);
  // Set right before a manual click's onRefresh() fires, read (and
  // cleared) once that fetch settles. This is what keeps "No new sync
  // yet" from firing on every silent 30s auto-refetch tick -- those hit
  // the "nothing changed" case constantly (most ticks land between
  // syncs), and announcing every one would be pure noise. Only a click
  // the person actually made gets called out.
  const manualCheckPendingRef = useRef(false);
  const noNewSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Fires once per completed fetch -- dataUpdatedAt only changes when
  // react-query finishes one, whether triggered by the button or by an
  // interval. Compares the payload against the last one seen to decide
  // whether this was a real sync or a no-op.
  useEffect(() => {
    if (!dataUpdatedAt) {
      manualCheckPendingRef.current = false;
      return;
    }

    const serialized = JSON.stringify(data);
    const isFirstLoad = prevSerializedRef.current === undefined;
    const changed = isFirstLoad || serialized !== prevSerializedRef.current;
    prevSerializedRef.current = serialized;

    if (changed) {
      setLastSyncedAt(dataUpdatedAt);
      setShowNoNewSync(false);
      clearTimeout(noNewSyncTimeoutRef.current);
    } else if (manualCheckPendingRef.current) {
      setShowNoNewSync(true);
      clearTimeout(noNewSyncTimeoutRef.current);
      noNewSyncTimeoutRef.current = setTimeout(() => setShowNoNewSync(false), NO_NEW_SYNC_DISPLAY_MS);
    }

    manualCheckPendingRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on
    // dataUpdatedAt on purpose: that's what marks "a fetch just
    // completed," `data` is read from the closure at that moment.
  }, [dataUpdatedAt]);

  // Don't leave a stray timer trying to setState after this view has
  // been navigated away from.
  useEffect(() => () => clearTimeout(noNewSyncTimeoutRef.current), []);

  function handleClick() {
    manualCheckPendingRef.current = true;
    setShowNoNewSync(false);
    onRefresh();
  }

  const label = isFetching
    ? "Checking..."
    : showNoNewSync
      ? "No new sync yet"
      : lastSyncedAt
        ? `Last sync ${new Date(lastSyncedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`
        : "Not synced yet";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ color: "var(--text-muted)", fontSize: 12 }} className="tabular">
        {label}
      </span>
      <button
        onClick={handleClick}
        disabled={isFetching}
        style={{
          background: "none",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "4px 10px",
          color: "var(--text-secondary)",
          fontSize: 12,
          cursor: isFetching ? "default" : "pointer",
          opacity: isFetching ? 0.6 : 1,
        }}
      >
        Check for updates
      </button>
    </div>
  );
}

// Client for agent.py's local-only "Keys" API -- deliberately separate
// from api.ts (the backend client). Per-key counts never leave the
// machine they were typed on: this always talks to a fixed localhost
// port, never the backend, and the browser making this request has to be
// running on the same computer as the agent for it to work at all.

const LOCAL_TOKEN_KEY = "keycount_local_token";
const LOCAL_API_BASE = "http://localhost:8787";

export function getLocalToken(): string | null {
  return localStorage.getItem(LOCAL_TOKEN_KEY);
}

export function setLocalToken(token: string) {
  localStorage.setItem(LOCAL_TOKEN_KEY, token.trim());
}

export function clearLocalToken() {
  localStorage.removeItem(LOCAL_TOKEN_KEY);
}

export interface LocalKeyStat {
  key: string;
  count: number;
}

export interface LocalKeysResponse {
  device_name: string;
  // Every app the agent has ever seen focus while a key was pressed, most-
  // active first -- always the FULL list regardless of which `app` filter
  // (if any) was passed to fetchLocalKeys, so this can populate a filter
  // dropdown without a second request.
  apps: string[];
  keys: LocalKeyStat[];
}

export interface LocalAppStat {
  app_name: string;
  keystrokes: number;
}

export interface LocalAppsResponse {
  device_name: string;
  apps: LocalAppStat[]; // most-active first, see agent.py's Store.app_totals()
}

export type LocalApiErrorKind = "unreachable" | "unauthorized" | "other";

export class LocalApiError extends Error {
  kind: LocalApiErrorKind;
  constructor(kind: LocalApiErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

// Shared by both endpoints below -- same token header, same "agent isn't
// reachable on this device" vs. "wrong code" vs. "something else went
// wrong" mapping either way.
async function localGet(path: string): Promise<unknown> {
  const token = getLocalToken();
  if (!token) {
    throw new LocalApiError("unauthorized", "No local access code saved yet.");
  }

  let res: Response;
  try {
    res = await fetch(`${LOCAL_API_BASE}${path}`, {
      headers: { "X-Local-Token": token },
    });
  } catch {
    // Most common case by far: no agent.py running on this machine (or it
    // is, but on a different computer than the one viewing the dashboard).
    throw new LocalApiError(
      "unreachable",
      "Couldn't reach a local KeyCount agent on this device.",
    );
  }

  if (res.status === 401) {
    throw new LocalApiError("unauthorized", "That code doesn't match this device's agent.");
  }
  if (!res.ok) {
    throw new LocalApiError("other", `Local agent returned ${res.status}.`);
  }
  return res.json();
}

// `app`, when set, filters to keys pressed while that app had focus
// (sampled per-keypress by the agent, not once a minute -- see
// agent.py's Agent._sample_app). Omitted or null means every app
// combined, same as before this filter existed.
//
// `date` ("YYYY-MM-DD", added 2026-09-02), when set, narrows to that
// local calendar day -- same local_date column and the same
// pre-migration 'unknown' caveat fetchLocalApps's own note describes.
// Combines independently with `app` (e.g. top keys in Editor today).
export function fetchLocalKeys(
  top = 25,
  app: string | null = null,
  date: string | null = null,
): Promise<LocalKeysResponse> {
  const qs = new URLSearchParams({ top: String(top) });
  if (app) qs.set("app", app);
  if (date) qs.set("date", date);
  return localGet(`/local/keys?${qs.toString()}`) as Promise<LocalKeysResponse>;
}

// Total keystrokes per app -- the local, per-keypress-accurate counterpart
// to the backend's "By app" breakdown (fetchAppsBreakdown in api.ts, still
// hidden -- see the "By app" note in web/README.md for why that one can't
// be trusted). This one sums agent.py's key_counts table, which has
// tagged every keypress with the actual foreground app at the moment it
// was pressed since 2026-08-31, so it doesn't have the once-a-minute
// blind spot the backend version does. Trade-off: clicks aren't tracked
// per-app locally (key_counts is keystrokes only), so unlike the backend
// version this is keystrokes-only -- there's no per-app click count to
// show even if that hidden feature comes back.
//
// `date` ("YYYY-MM-DD", added 2026-09-02), when given, scopes the sum to
// just that local calendar day instead of all time -- agent.py's
// key_counts gained a local_date column for exactly this. Keystrokes
// recorded before that column existed are tagged 'unknown' on the agent
// side and so never match a specific-day filter; they still count fully
// when date is omitted (all time).
export function fetchLocalApps(date: string | null = null): Promise<LocalAppsResponse> {
  const qs = date ? `?${new URLSearchParams({ date }).toString()}` : "";
  return localGet(`/local/apps${qs}`) as Promise<LocalAppsResponse>;
}

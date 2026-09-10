import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchSettings, updatePublicProfile } from "../api";

// Public-profile opt-in toggle (2026-09-02). Off by default on the backend
// (see settings.go) -- this is the only UI for turning it on, and the only
// UI for finding out your own shareable URL once it's on.
export default function SettingsView() {
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: fetchSettings,
  });

  const toggleMutation = useMutation({
    mutationFn: (next: boolean) => updatePublicProfile(next),
    onSuccess: (data) => {
      queryClient.setQueryData(["settings"], data);
    },
  });

  const settings = settingsQuery.data;
  const profileUrl = settings ? `${window.location.origin}/u/${encodeURIComponent(settings.username)}` : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 480 }}>
      <h2 style={{ fontSize: 15, color: "var(--text-secondary)", fontWeight: 600, margin: 0 }}>
        Public profile
      </h2>

      {settingsQuery.isLoading && <div style={{ color: "var(--text-muted)" }}>Loading...</div>}
      {settingsQuery.isError && <div style={{ color: "#e34948" }}>Couldn't load settings.</div>}

      {settings && (
        <div
          style={{
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={settings.public_profile}
              disabled={toggleMutation.isPending}
              onChange={(e) => toggleMutation.mutate(e.target.checked)}
            />
            <span style={{ fontSize: 14, color: "var(--text-primary)" }}>
              Make my profile public
            </span>
          </label>
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
            Anyone with the link can see your total keystrokes and streaks --
            nothing else, and no sign-in required to view it. Your app-by-app
            or per-key breakdown is never shown here.
          </p>

          {settings.public_profile && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "var(--plane)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "8px 12px",
              }}
            >
              <code style={{ fontSize: 13, color: "var(--text-secondary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {profileUrl}
              </code>
              <button
                onClick={() => navigator.clipboard?.writeText(profileUrl)}
                style={{
                  background: "none",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: "4px 10px",
                  color: "var(--text-secondary)",
                  fontSize: 12,
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                Copy
              </button>
            </div>
          )}

          {toggleMutation.isError && (
            <div style={{ color: "#e34948", fontSize: 13 }}>Couldn't update this -- try again.</div>
          )}
        </div>
      )}
    </div>
  );
}

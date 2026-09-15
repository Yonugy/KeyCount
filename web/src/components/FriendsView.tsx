import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchFriends,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  removeFriend,
  ApiError,
  type FriendEntry,
} from "../api";

// Request/accept friendships (2026-09-11, direct request) -- the last
// piece of the design doc's "multi-user + leaderboards" milestone, see
// backend/friends.go's own note. This tab owns all of search/add,
// incoming/outgoing requests, and the current friends list; the
// Leaderboards tab only gets a thin Global/Friends toggle, it doesn't
// duplicate any of this management UI.
//
// One query (["friends"]) backs all three lists, and every mutation
// below just invalidates it rather than hand-updating each list in
// place -- this tab is never going to see enough traffic for an extra
// round trip per action to matter, and invalidate-on-success is a lot
// less code to get wrong than reproducing the backend's request/accept/
// decline logic three times over on the client.
export default function FriendsView() {
  const queryClient = useQueryClient();
  const [usernameInput, setUsernameInput] = useState("");
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestSuccess, setRequestSuccess] = useState<string | null>(null);

  const friendsQuery = useQuery({
    queryKey: ["friends"],
    queryFn: fetchFriends,
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["friends"] });
  }

  const sendMutation = useMutation({
    mutationFn: (username: string) => sendFriendRequest(username),
    onSuccess: () => {
      setRequestError(null);
      setRequestSuccess(`Friend request sent to ${usernameInput}.`);
      setUsernameInput("");
      invalidate();
    },
    onError: (err) => {
      setRequestSuccess(null);
      setRequestError(err instanceof ApiError ? err.message : "Couldn't send that request -- try again.");
    },
  });

  const acceptMutation = useMutation({
    mutationFn: (username: string) => acceptFriendRequest(username),
    onSuccess: invalidate,
  });

  const declineMutation = useMutation({
    mutationFn: (username: string) => declineFriendRequest(username),
    onSuccess: invalidate,
  });

  const removeMutation = useMutation({
    mutationFn: (username: string) => removeFriend(username),
    onSuccess: invalidate,
  });

  function handleSendRequest(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = usernameInput.trim();
    if (!trimmed) return;
    setRequestError(null);
    setRequestSuccess(null);
    sendMutation.mutate(trimmed);
  }

  const data = friendsQuery.data;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28, maxWidth: 560 }}>
      <section>
        <h2 style={{ fontSize: 15, color: "var(--text-secondary)", fontWeight: 600, margin: "0 0 12px" }}>
          Add a friend
        </h2>
        <form onSubmit={handleSendRequest} style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            placeholder="Username"
            value={usernameInput}
            onChange={(e) => setUsernameInput(e.target.value)}
            style={inputStyle}
          />
          <button type="submit" disabled={sendMutation.isPending || !usernameInput.trim()} style={buttonStyle}>
            {sendMutation.isPending ? "..." : "Send request"}
          </button>
        </form>
        {requestError && <p style={{ margin: "8px 0 0", fontSize: 13, color: "#e34948" }}>{requestError}</p>}
        {requestSuccess && <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--success)" }}>{requestSuccess}</p>}
      </section>

      {friendsQuery.isLoading && <div style={{ color: "var(--text-muted)" }}>Loading...</div>}
      {friendsQuery.isError && <div style={{ color: "#e34948" }}>Couldn't load your friends.</div>}

      {data && data.incoming_requests.length > 0 && (
        <FriendListSection
          title="Requests waiting on you"
          entries={data.incoming_requests}
          renderActions={(entry) => (
            <>
              <SmallButton
                label="Accept"
                accent
                disabled={acceptMutation.isPending}
                onClick={() => acceptMutation.mutate(entry.username)}
              />
              <SmallButton
                label="Decline"
                disabled={declineMutation.isPending}
                onClick={() => declineMutation.mutate(entry.username)}
              />
            </>
          )}
        />
      )}

      {data && data.outgoing_requests.length > 0 && (
        <FriendListSection
          title="Requests you sent"
          entries={data.outgoing_requests}
          renderActions={(entry) => (
            <SmallButton
              label="Cancel"
              disabled={declineMutation.isPending}
              onClick={() => declineMutation.mutate(entry.username)}
            />
          )}
        />
      )}

      {data && (
        <FriendListSection
          title="Friends"
          entries={data.friends}
          emptyMessage="No friends yet -- send a request above to get started."
          renderActions={(entry) => (
            <SmallButton
              label="Remove"
              disabled={removeMutation.isPending}
              onClick={() => removeMutation.mutate(entry.username)}
            />
          )}
        />
      )}
    </div>
  );
}

interface FriendListSectionProps {
  title: string;
  entries: FriendEntry[];
  emptyMessage?: string;
  renderActions: (entry: FriendEntry) => React.ReactNode;
}

function FriendListSection({ title, entries, emptyMessage, renderActions }: FriendListSectionProps) {
  return (
    <section>
      <h2 style={{ fontSize: 15, color: "var(--text-secondary)", fontWeight: 600, margin: "0 0 12px" }}>
        {title}
      </h2>
      {entries.length === 0 && emptyMessage && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>{emptyMessage}</p>
      )}
      {entries.length > 0 && (
        <div
          style={{
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
          {entries.map((entry) => (
            <div
              key={entry.username}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 16px",
                fontSize: 14,
                borderBottom: "1px solid var(--gridline)",
              }}
            >
              <span style={{ color: "var(--text-primary)" }}>
                {entry.public_profile ? (
                  <a
                    href={`/u/${encodeURIComponent(entry.username)}`}
                    style={{ color: "inherit", textDecoration: "none" }}
                    onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                    onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                  >
                    {entry.username}
                  </a>
                ) : (
                  entry.username
                )}
              </span>
              <div style={{ display: "flex", gap: 6 }}>{renderActions(entry)}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

interface SmallButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  accent?: boolean;
}

function SmallButton({ label, onClick, disabled, accent }: SmallButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: accent ? "var(--accent)" : "none",
        border: "1px solid " + (accent ? "var(--accent)" : "var(--border)"),
        borderRadius: 6,
        padding: "5px 10px",
        color: accent ? "#ffffff" : "var(--text-secondary)",
        fontSize: 12,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {label}
    </button>
  );
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: "var(--plane)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "10px 12px",
  color: "var(--text-primary)",
  fontSize: 14,
  outline: "none",
};

const buttonStyle: React.CSSProperties = {
  background: "var(--accent)",
  border: "none",
  borderRadius: 6,
  padding: "10px 14px",
  color: "#ffffff",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

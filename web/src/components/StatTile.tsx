interface StatTileProps {
  label: string;
  value: string;
  accent?: boolean;
}

// Stat tile contract (dataviz skill): label (sentence case, no trailing
// colon), value in proportional figures (not tabular -- this is a hero-ish
// figure, not a table column).
export default function StatTile({ label, value, accent }: StatTileProps) {
  return (
    <div
      style={{
        background: "var(--surface-1)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "18px 20px",
        minWidth: 140,
        flex: "1 1 140px",
      }}
    >
      <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 6 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 32,
          fontWeight: 600,
          color: accent ? "var(--accent)" : "var(--text-primary)",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
    </div>
  );
}

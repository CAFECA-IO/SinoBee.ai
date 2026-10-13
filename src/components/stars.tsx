export function Stars({ value, count, size = "text-sm" }: { value: number; count?: number; size?: string }) {
  const full = Math.round(value);
  return (
    <span className={`inline-flex items-center gap-1 ${size}`} title={`${value.toFixed(2)} / 5`}>
      <span className="tracking-tight text-[#f5b83d]">
        {"★".repeat(full)}
        <span className="text-line">{"★".repeat(5 - full)}</span>
      </span>
      {count !== undefined && <span className="text-xs text-muted">({count})</span>}
    </span>
  );
}

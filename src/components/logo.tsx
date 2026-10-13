export function Logo({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" className={className} aria-hidden>
      <defs>
        <linearGradient id="sb-logo" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2fb3a0" />
          <stop offset="1" stopColor="#7fe8b6" />
        </linearGradient>
      </defs>
      <ellipse cx="12" cy="14" rx="5" ry="6" fill="url(#sb-logo)" />
      <path d="M7.5 12h9M7.5 15.5h9" stroke="var(--bg)" />
      <path d="M9 8c-3-4-7-2-6 1s5 2 6 1M15 8c3-4 7-2 6 1s-5 2-6 1" stroke="var(--accent)" />
    </svg>
  );
}

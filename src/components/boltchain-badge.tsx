import { certUrl, formatCode } from "@/lib/boltchain/certificates";

/** Boltchain logo mark: a lightning bolt inside a hexagon */
function Bolt({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M12 2.5 20.2 7.2v9.6L12 21.5 3.8 16.8V7.2z" />
      <path d="M13.2 6.5 8.8 13h3.4l-1.4 4.5L15.4 11H12z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** "BOLTCHAIN · XXXX-XXXX-XXXX-XXXX ↗" — links to the public certificate page on the Boltchain explorer */
export function BoltchainBadge({ code, title, className = "" }: { code: string; title: string; className?: string }) {
  return (
    <a
      href={certUrl(code)}
      target="_blank"
      rel="noopener"
      title={title}
      data-boltchain={code}
      className={`inline-flex items-center gap-1.5 rounded-full border border-accent/50 bg-accent-soft py-0.5 pl-1.5 pr-2.5 text-xs font-semibold text-accent transition hover:border-accent hover:bg-accent hover:text-accent-ink ${className}`}
    >
      <Bolt />
      <span className="tracking-wider">BOLTCHAIN</span>
      <span className="font-mono font-normal opacity-80">{formatCode(code)}</span>
      <svg viewBox="0 0 24 24" className="h-3 w-3" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M9 6h9v9M18 6 6 18" /></svg>
    </a>
  );
}

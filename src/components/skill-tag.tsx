import type { SkillTag } from "@/lib/skills/official";

/**
 * Small SVG marks for a skill: 官方 / 已驗證 / 社群, 已審核 / 待審核 and the Boltchain certificate.
 * Only the icon is shown; the text appears on hover / keyboard focus (data-tip) and is read by screen readers.
 */
export type MarkKind = SkillTag | "approved" | "pending" | "boltchain";
export type Mark = { kind: MarkKind; label: string };

const COLOR: Record<MarkKind, string> = {
  official: "bg-accent-soft text-accent",
  verified: "bg-accent-soft text-ok",
  community: "bg-panel-2 text-muted",
  approved: "bg-accent-soft text-ok",
  pending: "bg-warn-soft text-warn",
  boltchain: "bg-accent-soft text-accent",
};

const PATHS: Record<MarkKind, React.ReactNode> = {
  // Greek temple: official
  official: (
    <>
      <path d="M3 9.2 12 4l9 5.2z" />
      <path d="M4.5 11.5v6M9.5 11.5v6M14.5 11.5v6M19.5 11.5v6" />
      <path d="M3.5 17.8h17M2.5 20.5h19" />
    </>
  ),
  // rosette with a check: verified publisher + signed version
  verified: (
    <>
      <circle cx="12" cy="9" r="5.6" />
      <path d="m9.6 9 1.7 1.7 3.1-3.3" />
      <path d="M9 13.8 7.6 20.5l3-1.3 1.4 2.3 1.4-2.3 3 1.3L15 13.8" />
    </>
  ),
  // three people, head and shoulders: community
  community: (
    <>
      <circle cx="12" cy="8.2" r="2.8" />
      <path d="M6.8 19.5c0-3.2 2.3-5.4 5.2-5.4s5.2 2.2 5.2 5.4z" />
      <circle cx="5.6" cy="10" r="2.1" />
      <path d="M1.8 18.5c.2-2.5 1.7-4 3.8-4 .7 0 1.3.2 1.9.5" />
      <circle cx="18.4" cy="10" r="2.1" />
      <path d="M22.2 18.5c-.2-2.5-1.7-4-3.8-4-.7 0-1.3.2-1.9.5" />
    </>
  ),
  // shield with a check: approved by the Hub review
  approved: (
    <>
      <path d="M12 3 5 5.8v5.7c0 4.2 2.9 7.7 7 9.5 4.1-1.8 7-5.3 7-9.5V5.8z" />
      <path d="m8.8 12 2.2 2.2 4.2-4.5" />
    </>
  ),
  // envelope under a magnifying glass: waiting for review
  pending: (
    <>
      <rect x="2.5" y="4.5" width="14" height="10" rx="1.5" />
      <path d="m3.2 5.5 6.3 4.8 6.3-4.8" />
      <circle cx="16.5" cy="15.5" r="3.7" fill="var(--warn-soft)" />
      <path d="m19.2 18.2 2.6 2.6" />
    </>
  ),
  // lightning bolt in a hexagon: Boltchain certificate
  boltchain: (
    <>
      <path d="M12 2.8 19.9 7.4v9.2L12 21.2 4.1 16.6V7.4z" />
      <path d="M13 6.8 9 13h3.2l-1.2 4.2 4-6.2H12z" fill="currentColor" stroke="none" />
    </>
  ),
};

export function MarkIcon({ kind, className = "h-4 w-4" }: { kind: MarkKind; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {PATHS[kind]}
    </svg>
  );
}

/** one round icon; `tip` positions the hover text (tip-end keeps it inside the card's right edge). md marks are focusable; sm marks sit inside a card link. */
export function SkillMark({ kind, label, size = "sm", tip = "" }: Mark & { size?: "sm" | "md"; tip?: string }) {
  const box = size === "md" ? "h-8 w-8" : "h-7 w-7";
  const icon = size === "md" ? "h-[18px] w-[18px]" : "h-4 w-4";
  return (
    <span role="img" aria-label={label} data-tip={label} data-mark={kind} tabIndex={size === "md" ? 0 : undefined}
      className={`inline-flex flex-none items-center justify-center rounded-full ${box} ${COLOR[kind]} ${tip}`}>
      <MarkIcon kind={kind} className={icon} />
    </span>
  );
}

export function SkillMarks({ marks, size, tip, className = "" }: { marks: Mark[]; size?: "sm" | "md"; tip?: string; className?: string }) {
  return (
    <span className={`flex flex-none items-center gap-1 ${className}`}>
      {marks.map((m) => <SkillMark key={m.kind} {...m} size={size} tip={tip} />)}
    </span>
  );
}

/**
 * The marks a skill shows, in a fixed order: tag, review state, Boltchain.
 * `version` is the version being shown (the card: the latest listed version).
 */
export function skillMarks(
  tag: SkillTag,
  version: { status: string; anchorCode: string | null } | null | undefined,
  label: (key: MarkKind) => string,
): Mark[] {
  const marks: Mark[] = [{ kind: tag, label: label(tag) }];
  if (version?.status === "APPROVED") marks.push({ kind: "approved", label: label("approved") });
  else if (version?.status === "PENDING_REVIEW") marks.push({ kind: "pending", label: label("pending") });
  if (version?.anchorCode) marks.push({ kind: "boltchain", label: label("boltchain") });
  return marks;
}

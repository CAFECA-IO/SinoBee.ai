/** Skill icon (colored, green): a robot head over an open book. Fixed colors read on light and dark backgrounds. */
export function SkillIcon({ className = "h-[26px] w-[26px]" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M1.8 10.4h20.4v10.4h-8.7l-1.5 1-1.5-1H1.8z" fill="#0e7c63" />
      <path d="M3.3 9.2c3-.7 5.9-.2 8.7 1.4v9.7c-2.8-1.5-5.7-2-8.7-1.4z" fill="#e3f7ef" />
      <path d="M20.7 9.2c-3-.7-5.9-.2-8.7 1.4v9.7c2.8-1.5 5.7-2 8.7-1.4z" fill="#d2f0e5" />
      <path d="M5 15.4c1.8-.3 3.5 0 5.2.7M5 17.6c1.8-.3 3.5 0 5.2.7M19 15.4c-1.8-.3-3.5 0-5.2.7M19 17.6c-1.8-.3-3.5 0-5.2.7" stroke="#9ad8c3" strokeWidth="1" strokeLinecap="round" fill="none" />
      <path d="M12 3.6V2" stroke="#16a37f" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="12" cy="1.6" r="1.2" fill="#16a37f" />
      <rect x="5.6" y="3.6" width="12.8" height="9" rx="4.3" fill="#16a37f" />
      <circle cx="9.4" cy="7.6" r="1.3" fill="#fff" />
      <circle cx="14.6" cy="7.6" r="1.3" fill="#fff" />
      <path d="M9.9 10c1.4.9 2.8.9 4.2 0" stroke="#fff" strokeWidth="1.1" strokeLinecap="round" fill="none" />
    </svg>
  );
}

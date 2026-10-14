"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";

export function RateSkill({ skillId, mine, url }: { skillId: string; mine: number; url?: string }) {
  const [v, setV] = useState(mine);
  const [hover, setHover] = useState(0);
  const router = useRouter();
  return (
    <div className="flex gap-1 text-2xl" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          aria-label={`${n}`}
          onMouseEnter={() => setHover(n)}
          onClick={async () => {
            setV(n);
            await fetch(url ?? `/api/skills/${skillId}/rate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stars: n }) });
            router.refresh();
          }}
          className={(hover || v) >= n ? "text-[#f5b83d]" : "text-line"}
        >
          ★
        </button>
      ))}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { CARD_BRAND_NAMES, type CardBrand } from "@/lib/card-brand";

/**
 * A card network's mark, 38×24 (the 85.6 × 54 mm proportions of a real card). Uses the network's official artwork from `public/cards/<brand>.svg` when the site has
 * it (download the acceptance marks from the networks' brand centres; they are trademarks and are not drawn here);
 * otherwise a neutral card with the network's name. Unknown networks show a plain card.
 */
export function CardBrandMark({ brand, className = "" }: { brand: CardBrand | null | undefined; className?: string }) {
  // the official artwork is shown only once it has loaded (a missing file keeps the name badge, no broken image)
  const [art, setArt] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  useEffect(() => {
    setArt(false);
    const el = img.current;
    if (el?.complete && el.naturalWidth > 0) setArt(true); // loaded before hydration
  }, [brand]);
  const box = `relative inline-grid h-6 w-[38px] flex-none place-items-center overflow-hidden rounded-md border border-line bg-white ${className}`;
  if (!brand)
    return (
      <span className={box} role="img" aria-label="card">
        <svg viewBox="0 0 38 24" className="h-full w-full" aria-hidden="true">
          <path d="M0 8h38" stroke="#94a3b8" strokeWidth="2.5" />
          <path d="M5 16h9" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </span>
    );
  return (
    <span className={box} role="img" aria-label={CARD_BRAND_NAMES[brand]}>
      {!art && <span className="px-0.5 text-center text-[8px] font-extrabold uppercase leading-none tracking-tight text-slate-800" aria-hidden="true">{CARD_BRAND_NAMES[brand]}</span>}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={img} src={`/cards/${brand}.svg`} alt="" aria-hidden="true" width={38} height={24} className={art ? "absolute inset-0 h-full w-full object-contain p-0.5" : "hidden"} onLoad={() => setArt(true)} onError={() => setArt(false)} />
    </span>
  );
}

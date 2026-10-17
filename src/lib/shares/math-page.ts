const KATEX = "https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/";
const MATH_TEXT = /\$\$[\s\S]+?\$\$|\\\(|\\\[|(?<![\w$])\$(?![\s$\d])[^$\n<]{1,200}?(?<!\s)\$(?!\d)|class=["'][^"']*\b(?:math|formula|equation|latex)\b/i;

/** A page that writes formulas ($…$, \(…\), formula boxes) without bringing a math renderer gets KaTeX (same as in SinoBee) */
export function withMath(page: string, origin: string): string | null {
  const body = page.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ");
  if (!MATH_TEXT.test(body) || /katex|mathjax|mathml|temml|asciimath/i.test(page)) return null;
  const tags = `<link rel="stylesheet" href="${KATEX}katex.min.css"><script src="${KATEX}katex.min.js"></script>` +
    `<script src="${origin}/vendor/sb-math.js"></script><script>addEventListener('DOMContentLoaded',function(){sbMath.render(document.body)})</script>`;
  const i = page.toLowerCase().lastIndexOf("</head>");
  return i >= 0 ? page.slice(0, i) + tags + page.slice(i) : tags + page;
}

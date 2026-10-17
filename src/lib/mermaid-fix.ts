/**
 * Models often write mermaid labels with parentheses, slashes or CJK text unquoted, which the mermaid lexers
 * reject (quadrantChart axes and quadrants, flowchart node and edge text). When a chart fails, these labels are
 * quoted and it is drawn again. Same rules as SinoBee's chat view (sinobee/server/static/index.html).
 */
const MMD_SHAPES: [string, string][] = [['\\[\\[', '\\]\\]'], ['\\(\\(', '\\)\\)'], ['\\(\\[', '\\]\\)'], ['\\[\\(', '\\)\\]'], ['\\{\\{', '\\}\\}'], ['\\[', '\\]'], ['\\(', '\\)'], ['\\{', '\\}']];
export function mmdFix(src: string): string {
  const q = (t: string) => { t = t.trim(); return /^".*"$/.test(t) ? t : '"' + t.replace(/"/g, "'") + '"'; };
  const lines = src.replace(/\r/g, '').split('\n'), kind = (lines.find(l => l.trim() && !l.trim().startsWith('%%')) || '').trim().split(/\s/)[0];
  return lines.map((l) => {
    let m: RegExpExecArray | null;
    if (kind === 'quadrantChart') {
      if ((m = /^(\s*)(x-axis|y-axis)\s+(.+)$/.exec(l))) return m[1] + m[2] + ' ' + m[3].split('-->').map(q).join(' --> ');
      if ((m = /^(\s*)(quadrant-[1-4])\s+(.+)$/.exec(l))) return m[1] + m[2] + ' ' + q(m[3]);
      if ((m = /^(\s*)([^"\s][^:]*?)\s*:\s*(\[[^\]]*\].*)$/.exec(l))) return m[1] + q(m[2]) + ': ' + m[3];
      return l;
    }
    if (/^(flowchart|graph)$/.test(kind)) {
      for (const [o, c] of MMD_SHAPES) l = l.replace(new RegExp(`(^|[\\s;&>|])([\\w\\u00c0-\\uffff][\\w\\u00c0-\\uffff-]*)${o}([^"\\n]*?)${c}(?=\\s*(?:$|;|&|-->|---|-\\.|==|~~~|--|:::))`, 'g'),
        (all: string, pre: string, id: string, t: string) => /^\s*$/.test(t) ? all : pre + id + o.replace(/\\/g, '') + q(t) + c.replace(/\\/g, ''));
      l = l.replace(/\|([^|"\n]+)\|/g, (all: string, t: string) => '|' + q(t) + '|');
    }
    return l;
  }).join('\n');
}

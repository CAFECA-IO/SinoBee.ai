import type { SkillFiles } from "./bundle";

export type Finding = { file: string; rule: string; severity: "warning" | "dangerous"; excerpt: string };

/**
 * Hub-side static scan (SinoBee also re-scans locally). Heuristic — a human review is still required
 * before a version becomes "reviewed".
 */
const RULES: { rule: string; severity: Finding["severity"]; re: RegExp }[] = [
  { rule: "prompt-injection", severity: "dangerous", re: /ignore (all )?(previous|prior|above) (instructions|prompts)|disregard (the )?(system|previous) (prompt|instructions)|忽略(之前|先前|以上)的?(所有)?(指令|指示)/i },
  { rule: "hidden-exfiltration", severity: "dangerous", re: /(send|upload|post|exfiltrate)[^\n]{0,60}(api[_ -]?key|secrets?\.json|\.ssh|id_rsa|credentials)/i },
  { rule: "pipe-to-shell", severity: "warning", re: /(curl|wget)[^\n|]{0,200}\|\s*(sudo\s+)?(ba|z)?sh\b/i },
  { rule: "destructive-command", severity: "dangerous", re: /rm\s+-rf\s+(\/|~|\$HOME)(\s|$)|mkfs\.|dd\s+if=.*of=\/dev\/|:\(\)\s*\{\s*:\|:&\s*\};:/ },
  { rule: "aws-key", severity: "dangerous", re: /AKIA[0-9A-Z]{16}/ },
  { rule: "private-key", severity: "dangerous", re: /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/ },
  { rule: "api-token", severity: "warning", re: /\b(sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|AIza[0-9A-Za-z_-]{35})\b/ },
  { rule: "invisible-characters", severity: "warning", re: /[​-‏‪-‮⁠-⁤﻿](?!$)/ },
  { rule: "obfuscated-exec", severity: "warning", re: /(eval|exec)\s*\(\s*(base64|atob|bytes\.fromhex|codecs\.decode)/i },
];

const TEXT_EXT = /\.(md|txt|py|sh|bash|zsh|js|mjs|cjs|ts|json|ya?ml|toml|ini|cfg|ps1|bat|rb|pl|php|html|css|csv)$/i;

export function scanSkill(files: SkillFiles): { verdict: "CLEAN" | "WARNING" | "DANGEROUS"; findings: Finding[] } {
  const findings: Finding[] = [];
  for (const [file, bytes] of files) {
    if (!TEXT_EXT.test(file) && file !== "SKILL.md") continue;
    const text = bytes.toString("utf8");
    for (const r of RULES) {
      const m = r.re.exec(text);
      if (m) {
        const i = Math.max(0, m.index - 30);
        findings.push({ file, rule: r.rule, severity: r.severity, excerpt: text.slice(i, m.index + m[0].length + 30).replace(/\s+/g, " ").slice(0, 160) });
      }
    }
  }
  const verdict = findings.some((f) => f.severity === "dangerous") ? "DANGEROUS" : findings.length ? "WARNING" : "CLEAN";
  return { verdict, findings };
}

/** Realistic evaluation reports (the skill youtube-analysis on its suite) for tests and page previews. */
export const QUESTIONS = [
  ["正確性", "採用影片中講者說的 250 kg", "det", true, "execution", "output"],
  ["正確性", "摘要與時間軸都能在逐字稿找到，沒有捏造", "judge", false, "execution", "output"],
  ["正確性", "引用講者的數字與逐字稿一致", "judge", false, "execution", "output"],
  ["正確性", "沒有捏造的引述", "judge", true, "execution", "output"],
  ["正確性", "查核判定附來源連結", "det", false, "execution", "exec"],
  ["完整性", "產出報告", "det", false, "execution", "output"],
  ["完整性", "查核表把「影片說的」與「查核結果」分開", "judge", false, "thinking", "plan"],
  ["完整性", "產出封面", "det", false, "execution", "output"],
  ["完整性", "附影片時間碼對照", "det", false, "skill", "output"],
  ["可讀性", "成果檢查（語言、圖片、版面）", "det", false, "execution", "output"],
  ["可讀性", "非專業讀者讀得懂", "judge", false, "execution", "output"],
  ["可讀性", "沒有格式錯誤", "det", false, "execution", "output"],
  ["流程健康", "任務正常完成", "det", false, "execution", "exec"],
  ["流程健康", "tokens 不超過 2M", "det", false, "execution", "exec"],
  ["流程健康", "模型呼叫重送不超過 2 次", "det", false, "execution", "exec"],
  ["流程健康", "失敗的步驟不超過 2 步", "det", false, "execution", "exec"],
  ["流程健康", "讀取的來源都被報告引用", "det", false, "thinking", "plan"],
].map(([category, label, kind, critical, owner, stage]) => ({ category, label, kind, critical, owner, stage })) as {
  category: string; label: string; kind: "det" | "judge"; critical: boolean; owner: "skill" | "thinking" | "execution"; stage: "plan" | "exec" | "review" | "output";
}[];
export const WEIGHTS = { 正確性: 40, 完整性: 25, 可讀性: 15, 流程健康: 20 };

const EVIDENCE: Record<number, [string, string]> = {
  0: ["第 3 節標示「需更正」，附 2 個來源", "報告寫 313 公斤（取自舊文章）"],
  2: ["3/3 票：數字都與逐字稿一致", "2/3 票否：「2027 年交車」，逐字稿與來源都寫 2028"],
  3: ["3/3 票：4 句引述皆可在逐字稿找到", "3/3 票否：引述「這是物理學的勝利」不在逐字稿"],
  8: ["5/5 項附時間碼", "0/5 項有時間碼；技能範本沒有這個欄位"],
  10: ["3/3 票", "3/3 票否：大量未解釋的術語（Isp、bar）"],
  16: ["4 個讀取都有引用", "4 個讀取中 1 個未引用"],
};

export type Combo = { thinking: string; execution: string; fails: number[][]; T: number[]; usd: number[]; tokens: number; crea?: [number, number] };
export const COMBOS: Record<string, Combo> = {
  opusSonnet: { thinking: "anthropic/claude-opus-5-5", execution: "anthropic/claude-sonnet-4-5", fails: [[8], [10], [8]], T: [268, 251, 280], usd: [1.84, 1.79, 1.9], tokens: 2_010_000, crea: [37, 48] },
  proPro: { thinking: "gemini/gemini-pro-latest", execution: "gemini/gemini-pro-latest", fails: [[8], [2, 8], [8, 11]], T: [231, 240, 222], usd: [0.97, 1.01, 0.94], tokens: 1_400_000, crea: [26, 48] },
  opusFlash: { thinking: "anthropic/claude-opus-5-5", execution: "gemini/gemini-flash-latest", fails: [[2, 8, 16], [8, 10], [2, 8]], T: [214, 205, 221], usd: [0.71, 0.69, 0.74], tokens: 1_180_000, crea: [33, 48] },
  proFlash: { thinking: "gemini/gemini-pro-latest", execution: "gemini/gemini-flash-latest", fails: [[2, 6, 8, 16], [4, 8], [2, 8, 10, 15]], T: [176, 169, 181], usd: [0.42, 0.4, 0.45], tokens: 1_050_000, crea: [18, 48] },
  flashFlash: { thinking: "gemini/gemini-flash-latest", execution: "gemini/gemini-flash-latest", fails: [[2, 4, 8, 10], [1, 2, 6, 8, 10, 13], [2, 4, 8, 15]], T: [118, 124, 131], usd: [0.19, 0.18, 0.21], tokens: 880_000, crea: [8, 32] },
  proGemma: { thinking: "gemini/gemini-pro-latest", execution: "ollama/gemma4:e4b", fails: [[0, 3, 8, 10], [0, 2, 3, 8], [0, 3, 8, 13]], T: [412, 398, 431], usd: [0.11, 0.11, 0.12], tokens: 880_000 },
  sonnetHaiku: { thinking: "anthropic/claude-sonnet-4-5", execution: "anthropic/claude-haiku-4-5", fails: [[8, 10]], T: [162], usd: [0.38], tokens: 900_000 },
};

const STEPS = [48, 61, 72, 58, 66, 70, 84, 92, 31, 96, 88, 104, 110, 41];
const REPORT = `# Roadster 冷氣推進器能讓車飛起來嗎？

![封面](cover.png)

**結論：大致正確。** 影片 5 項主張中 1 項需更正、2 項未經證實。

| 影片說的 | 查核結果 | 來源 |
|---|---|---|
| 冷氣推進 250 kg | 需更正 | [SpaceX](https://www.spacex.com) |
| 0–100 km/h 1.1 秒 | 未經證實 | [Tesla](https://www.tesla.com/roadster) |
| 預計 2027 年交車 | 仍待觀察 | [Electrek](https://electrek.co) |
`;

export function payload(c: Combo, o: Record<string, unknown> = {}) {
  const kind = c.thinking === c.execution && o.kind === "model" ? "model" : "skill";
  return {
    kind, subject: "youtube-analysis", subject_version: "1.1", title: "技能評鑑：youtube-analysis",
    summary: "用 youtube-analysis 技能分析 Roadster 影片並查核。", suite: "bench-youtube", suite_hash: "3f9ac21e".repeat(8),
    input_hash: "7b1e09d0".repeat(8), thinking: c.thinking, execution: c.execution, judge: "gemini/gemini-pro-latest",
    judge2: "anthropic/claude-sonnet-4-5", judge2_agree: [15, 16], judge_check: { total: 4, correct: 4 }, threshold: 70,
    client_version: "0.9.4", tested_at: 1792500000, tested_until: 1792501800, runs: c.fails.map((_, i) => `r${i + 1}`),
    creativity: c.crea ? { wins: c.crea[0], total: c.crea[1], judge: "gemini/gemini-pro-latest", combos: 5 } : null,
    tasks: [{
      id: "youtube-roadster", title: "查核 Roadster 冷氣推進器影片並寫成報告",
      prompt: "/youtube-analysis 分析這支影片 https://www.youtube.com/watch?v=qt5p-_tE8d0 ，針對 Roadster Rocket 的技術說法做分析與查核，用繁體中文寫報告。",
      questions: QUESTIONS, weights: WEIGHTS,
      trials: c.fails.map((f, i) => ({
        trial: i + 1, run: `r${i + 1}`, status: "done", started: 1792500000 + i * 600, duration_s: c.T[i], cost_usd: c.usd[i],
        input_tokens: Math.round(c.tokens * 0.95), output_tokens: Math.round(c.tokens * 0.05), steps: 14, tool_calls: 22,
        roles: c.thinking === c.execution ? { execution: { input_tokens: c.tokens * 0.95, output_tokens: c.tokens * 0.05, cost_usd: c.usd[i] } }
          : { thinking: { input_tokens: 150_000, output_tokens: 15_000, cost_usd: c.usd[i] * 0.3 }, execution: { input_tokens: c.tokens * 0.95 - 150_000, output_tokens: c.tokens * 0.05 - 15_000, cost_usd: c.usd[i] * 0.7 } },
        steps_trace: STEPS.map((t, k) => ({ step: k + 1, tokens: t * 1000, wall_s: 12 + (k % 4) * 3, retries: k === 8 ? 1 : 0, failed: k === 8, produced: k >= 10 })),
        grades: QUESTIONS.map((q, k) => {
          const ok = !f.includes(k);
          const ev = EVIDENCE[k];
          return { ok, detail: ev ? ev[ok ? 0 : 1] : ok ? "通過" : "未通過", ...(q.kind === "judge" ? { votes: [ok ? 3 : 0, 3], evidence: ok ? "「250 公斤」" : "" } : {}) };
        }),
        answer: "報告寫在 reports/youtube/qt5p-_tE8d0/report.md。",
        outputs: [{ path: "reports/youtube/qt5p-_tE8d0/report.md", kind: "text", bytes: REPORT.length, ...(i === 0 ? { text: REPORT } : {}) }, { path: "reports/youtube/qt5p-_tE8d0/cover.png", kind: "image", bytes: 412_000 }],
      })),
    }],
    ...o,
  };
}

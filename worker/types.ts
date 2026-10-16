import type { Task, SkillVersion, Skill, User } from "../src/generated/prisma/client";

export type TaskWithRefs = Task & {
  user: User;
  skillVersion: (SkillVersion & { skill: Skill & { publisher: User } }) | null;
};

/** Cumulative usage of the task's SinoBee session (all runs, including continuations) */
/** tokenCostUsd is SinoBee's own estimate; billing recomputes it from the task's price snapshot (src/lib/pricing.ts) */
export type Usage = { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number; tokenCostUsd: number };

export type RunContext = {
  /** true when this run continues a task that was paused for funding */
  continuation: boolean;
  log: (message: string, data?: object) => Promise<void>;
  /** called periodically; return "stop" to halt the run (budget exhausted) */
  onUsage: (u: Usage, elapsedSeconds: number) => Promise<"continue" | "stop">;
};

export type RunResult = {
  outcome: "completed" | "stopped" | "failed";
  usage: Usage;
  elapsedSeconds: number;
  /** gzip tarball of the task workspace (outputs) */
  archive: Buffer | null;
  summary: string;
  error?: string;
  /** parsed outputs/evaluation.json for EVALUATION tasks */
  evaluation?: unknown;
};

export interface Executor {
  run(task: TaskWithRefs, ctx: RunContext): Promise<RunResult>;
  /** remove the user's container + volume (retention cleanup) */
  removeUserContainer(userId: string): Promise<void>;
}

export const taskSession = (taskId: string) => `task-${taskId}`;

/** Instructions wrapped around the user's prompt */
export function buildPrompt(task: TaskWithRefs, workdir: string, continuation: boolean): string {
  const skill = task.skillVersion ? task.skillVersion.skill.name : null;
  const lines: string[] = [];
  if (continuation) {
    lines.push(
      "The previous run of this commissioned task was paused because its budget ran out. The requester added funds.",
      "Continue from where you left off (check the files already in the working directory first). Do not redo finished work.",
      "",
    );
  }
  lines.push(
    `You are running a commissioned task on SinoBee.ai inside an isolated container. Working directory: ${workdir}`,
    "Rules:",
    `- Put every deliverable in ${workdir}/outputs/ (create it). Only that folder is delivered to the requester.`,
    `- When finished, write ${workdir}/outputs/SUMMARY.md: what you did, what is in outputs/, and any limitations.`,
    "- Work autonomously; nobody can answer questions during the run. Make reasonable assumptions and state them in SUMMARY.md.",
  );
  if (skill) lines.push(`- Use the skill /${skill} for this task.`);
  if (task.kind === "EVALUATION") {
    lines.push(
      "",
      "This is an EVALUATION commission. Evaluate the subject described below with the given method and criteria.",
      `Method: ${task.evalMethod}`,
      task.evalCriteria ? `Criteria / test cases:\n${task.evalCriteria}` : "",
      skill ? `Subject: the skill "${skill}" (version ${task.skillVersion!.version}) running on model ${task.model}.` : `Subject: the model ${task.model}.`,
      `Write ${workdir}/outputs/evaluation.json with exactly this shape:`,
      '{"score": <0-100 number>, "verdict": "<one line>", "summary": "<markdown>", "metrics": {"<metric>": <number>, ...},',
      ' "cases": [{"name": "...", "passed": true|false, "score": <0-100>, "notes": "..."}], "process": "<markdown: step by step what you did>"}',
      "Be strict and reproducible: record inputs, steps and observations so others can audit the result.",
    );
  }
  lines.push("", "=== Task from the requester ===", task.prompt);
  return lines.join("\n");
}

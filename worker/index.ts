/**
 * SinoBee.ai task worker
 *  - claims QUEUED commissioned tasks (FOR UPDATE SKIP LOCKED, safe with several workers)
 *  - runs each in the requester's own docker container (DockerExecutor) or simulated (MockExecutor)
 *  - meters cost while running: 1.5 × (tokens + VM time + S3), stops when the budget is used up
 *  - uploads results, applies retention, notifies the requester through CAFECA
 *  - storage keeper: moves every stored object (results included) to Boltchain right away, notarizes
 *    tool/share hashes, renews and cancels deals (STORAGE_KEEPER=0 turns it off on extra workers)
 *  - cleanup: expired results, idle containers (7 days for non-subscribers), stale runs, unanswered funding requests
 *
 * Run: npm run worker
 */
import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import { config } from "../src/lib/config";
import { chargeTwd, s3CostUsd, tokenCostUsd, vmCostUsd, type UsdPrices } from "../src/lib/pricing";
import { deleteObject, putObject } from "../src/lib/storage";
import { notify } from "../src/lib/notify";
import { addDays, containerExpiry, resultsRetentionDays } from "../src/lib/retention";
import { fmtTwd } from "../src/lib/money";
import { reconcilePayments } from "../src/lib/payments";
import { sweepHolds } from "../src/lib/llm/quota";
import { purgeNonces } from "../src/lib/device-sign";
import { DockerExecutor, containerName, crowdContainerName, volumeName } from "./docker-executor";
import { enterReview } from "../src/lib/crowd/review";
import { screeningTick } from "../src/lib/crowd/screening";
import { snapshotAllLegal } from "../src/lib/legal-versions";
import { MockExecutor } from "./mock-executor";
import { keeperTick } from "../src/lib/boltchain/keeper";
import { loadSettings } from "../src/lib/settings/store";
import { crowdTick, settleTask } from "../src/lib/crowd/lifecycle";
import { mirrorEvent } from "../src/lib/crowd/agent";
import type { Executor, TaskWithRefs, Usage } from "./types";

const WORKER_ID = `${process.env.HOSTNAME ?? "worker"}-${randomUUID().slice(0, 8)}`;
// chosen after the settings are loaded (runner.mode is a setting)
let executor: Executor;
const running = new Set<string>();
let stopping = false;

const log = (...a: unknown[]) => console.log(new Date().toISOString(), `[worker ${WORKER_ID}]`, ...a);

async function event(taskId: string, type: string, message: string, data?: object) {
  await db.taskEvent.create({ data: { taskId, type, message, data: data ?? undefined } });
  // crowdfunded tasks: the agent reports milestones as comments under the task
  await mirrorEvent(taskId, type, message);
}

/** Results of crowdfunded tasks are kept for every backer (crowd.resultsDays); others by the requester's plan */
async function retentionFor(task: { userId: string; crowdfund: boolean }) {
  return task.crowdfund ? Math.max(config.crowd.resultsDays, await resultsRetentionDays(task.userId)) : resultsRetentionDays(task.userId);
}

/**
 * Claim up to n queued tasks. Each claim is a conditional update (status must still be QUEUED),
 * so several workers can poll the same database safely — on PostgreSQL and on SQLite.
 */
async function claim(n: number): Promise<string[]> {
  if (n <= 0) return [];
  const candidates = await db.task.findMany({ where: { status: "QUEUED" }, orderBy: { createdAt: "asc" }, take: n * 3, select: { id: true, startedAt: true } });
  const claimed: string[] = [];
  for (const c of candidates) {
    if (claimed.length >= n) break;
    const now = new Date();
    const r = await db.task.updateMany({
      where: { id: c.id, status: "QUEUED" },
      data: { status: "RUNNING", workerId: WORKER_ID, heartbeatAt: now, startedAt: c.startedAt ?? now },
    });
    if (r.count === 1) claimed.push(c.id);
  }
  return claimed;
}

/** Token cost from the task's price snapshot (published prices); legacy tasks keep SinoBee's own figure */
function costs(task: { usdTwdRate: unknown; priceBuffer: unknown; modelPriceUsd: unknown }, u: Usage, vmSeconds: number, s3Usd: number) {
  const vmUsd = vmCostUsd(vmSeconds);
  const snap = task.modelPriceUsd as UsdPrices | null;
  const tokenUsd = snap ? tokenCostUsd(snap, u) : u.tokenCostUsd;
  const buffer = task.priceBuffer == null ? null : Number(String(task.priceBuffer));
  const charge = chargeTwd({ tokenUsd, vmUsd, s3Usd }, Number(String(task.usdTwdRate)), buffer);
  return { vmUsd, tokenUsd, charge };
}

async function runTask(id: string) {
  const task = (await db.task.findUniqueOrThrow({
    where: { id },
    include: { user: true, skillVersion: { include: { skill: { include: { publisher: true } } } } },
  })) as TaskWithRefs;
  const budget = Number(task.budget.toString());
  const prevVmSeconds = task.vmSeconds;
  const prevS3 = Number(task.s3CostUsd.toString());
  const continuation = prevVmSeconds > 0;
  // crowdfunded tasks get their own container (removed after settlement); others run in the requester's
  if (!task.crowdfund)
    await db.userContainer.upsert({
      where: { userId: task.userId },
      create: { userId: task.userId, containerName: containerName(task.userId), volumeName: volumeName(task.userId), status: "running", expiresAt: null },
      update: { status: "running", lastActiveAt: new Date(), expiresAt: null },
    });
  await db.task.update({ where: { id }, data: { containerName: task.crowdfund ? crowdContainerName(task.id) : containerName(task.userId) } });
  await event(id, "run.started", task.reworkNotes ? `Rework ${task.reworks} started with the backers' feedback` : continuation ? "Run resumed after top-up" : "Run started", { worker: WORKER_ID, mode: config.runner.mode });

  const persistUsage = async (u: Usage, vmSeconds: number, s3Usd: number, extra: object = {}) => {
    const { vmUsd, tokenUsd, charge } = costs(task, u, vmSeconds, s3Usd);
    await db.task.update({
      where: { id },
      data: {
        inputTokens: BigInt(u.inputTokens),
        outputTokens: BigInt(u.outputTokens),
        cacheReadTokens: BigInt(Math.round(u.cacheReadTokens ?? 0)),
        cacheWriteTokens: BigInt(Math.round(u.cacheWriteTokens ?? 0)),
        tokenCostUsd: tokenUsd.toFixed(8),
        vmSeconds,
        vmCostUsd: vmUsd.toFixed(8),
        s3CostUsd: s3Usd.toFixed(8),
        // never bill more than the funded budget (overshoot between meter readings is absorbed by the platform)
        charged: Math.min(charge, budget).toFixed(6),
        heartbeatAt: new Date(),
        ...extra,
      },
    });
    return charge;
  };

  // crowdfunded tasks: report when half and 80 % of the budget are used (once each)
  const reported = new Set((await db.taskEvent.findMany({ where: { taskId: id, type: { in: ["budget.50", "budget.80"] } }, select: { type: true } })).map((e) => e.type));
  const budgetMarks = async (charge: number) => {
    if (!task.crowdfund || budget <= 0) return;
    for (const mark of [50, 80]) {
      const type = `budget.${mark}`;
      if (charge / budget >= mark / 100 && !reported.has(type)) {
        reported.add(type);
        await event(id, type, `已使用 ${mark}% 預算（${fmtTwd(charge)} / ${fmtTwd(budget)} TWD）。${mark}% of the budget used.`);
      }
    }
  };

  let result;
  try {
    result = await executor.run(task, {
      continuation,
      log: (m, d) => event(id, "log", m, d),
      progress: (p) => event(id, "progress", progressText(p), p),
      onUsage: async (u, elapsed) => {
        const charge = await persistUsage(u, prevVmSeconds + elapsed, prevS3);
        await budgetMarks(charge);
        return charge >= budget ? "stop" : "continue";
      },
    });
  } catch (e) {
    log("executor error", id, e);
    result = { outcome: "failed" as const, usage: { inputTokens: Number(task.inputTokens), outputTokens: Number(task.outputTokens), cacheReadTokens: Number(task.cacheReadTokens), cacheWriteTokens: Number(task.cacheWriteTokens), tokenCostUsd: Number(task.tokenCostUsd) }, elapsedSeconds: 0, archive: null, summary: "", error: String(e) };
  }

  // upload results and bill S3 for the retention window
  const retentionDays = await retentionFor(task);
  const now = new Date();
  const expires = addDays(now, retentionDays);
  let s3Usd = prevS3;
  if (result.archive && result.archive.length > 0) {
    const key = `results/${task.id}/${now.getTime()}.tar.gz`;
    await putObject(key, result.archive, "application/gzip");
    s3Usd += s3CostUsd(result.archive.length, retentionDays, 1, 3);
    await db.artifact.create({
      data: {
        taskId: id,
        key,
        filename: `sinobee-task-${id}${result.outcome === "stopped" ? "-partial" : ""}.tar.gz`,
        sizeBytes: BigInt(result.archive.length),
        sha256: createHash("sha256").update(result.archive).digest("hex"),
        partial: result.outcome !== "completed",
        expiresAt: expires,
      },
    });
  }
  const vmSeconds = prevVmSeconds + result.elapsedSeconds;
  const charge = await persistUsage(result.usage, vmSeconds, s3Usd, { summary: result.summary.slice(0, 20000) || null });
  const chargedStr = fmtTwd(Math.min(charge, budget));

  if (result.outcome === "stopped") {
    await db.task.update({ where: { id }, data: { status: "NEEDS_FUNDING", fundingRequestedAt: now, resultsExpireAt: expires, workerId: null } });
    await event(id, "funding.requested", `Budget used up (${chargedStr} / ${fmtTwd(budget)} TWD). Partial results saved.`);
    await notify(task.userId, {
      type: "task.needs_funding",
      title: `預算已用完 Budget used up: ${task.title}`,
      body: `任務尚未完成，已整理目前成果。請補充經費繼續執行，或結案並下載目前成果（${retentionDays} 天內）。\nThe task is not finished yet. Partial results are ready. Add funds to continue, or close the task and download the results within ${retentionDays} days.`,
      link: `/tasks/${id}`,
      data: { taskId: id, charged: chargedStr, budget: fmtTwd(budget), actions: ["top_up", "close"] },
    });
  } else if (result.outcome === "completed" && task.crowdfund) {
    // crowdfunded: the backers review the result against the acceptance criteria before it counts as completed
    await event(id, "completed", `Run finished. Charged ${chargedStr} TWD.`);
    await enterReview(id, result.acceptance);
  } else if (result.outcome === "completed") {
    let reportOk = true;
    if (task.kind === "EVALUATION") reportOk = await saveEvaluation(task, result.evaluation, result.summary);
    await db.task.update({
      where: { id },
      data: {
        status: reportOk ? "COMPLETED" : "FAILED",
        error: reportOk ? null : "the agent did not produce a valid outputs/evaluation.json",
        finishedAt: now,
        resultsExpireAt: expires,
        workerId: null,
      },
    });
    await event(id, reportOk ? "completed" : "failed", reportOk ? `Completed. Charged ${chargedStr} TWD.` : "Evaluation report missing or invalid");
    await notify(task.userId, {
      type: reportOk ? "task.completed" : "task.failed",
      title: `${reportOk ? "任務完成 Task completed" : "任務失敗 Task failed"}: ${task.title}`,
      body: `請於 ${expires.toISOString().slice(0, 16).replace("T", " ")} UTC 前下載成果，逾期將無法下載。\nDownload the results before ${expires.toISOString().slice(0, 16).replace("T", " ")} UTC; they cannot be downloaded afterwards. Charged ${chargedStr} TWD.`,
      link: `/tasks/${id}`,
    });
  } else {
    await db.task.update({ where: { id }, data: { status: "FAILED", error: (result.error ?? "").slice(0, 4000), finishedAt: now, resultsExpireAt: expires, workerId: null } });
    await event(id, "failed", "Run failed", { error: (result.error ?? "").slice(0, 2000) });
    await notify(task.userId, {
      type: "task.failed",
      title: `任務失敗 Task failed: ${task.title}`,
      body: `執行失敗，已收取 ${chargedStr} TWD。可下載的部分成果保留至 ${expires.toISOString().slice(0, 10)}。\nThe run failed. Charged ${chargedStr} TWD.`,
      link: `/tasks/${id}`,
    });
  }

  if (!task.crowdfund)
    await db.userContainer.update({
      where: { userId: task.userId },
      data: { status: "idle", lastActiveAt: new Date(), expiresAt: await containerExpiry(task.userId) },
    });
  if (task.crowdfund) await settleTask(id).catch((e) => log("settle error", id, e));
}

function progressText(p: { done: number; total: number; note?: string; current?: string }) {
  return `進度 Progress ${p.done}/${p.total}${p.current ? ` · ${p.current}` : ""}${p.note ? `\n${p.note}` : ""}`;
}

async function saveEvaluation(task: TaskWithRefs, ev: unknown, summary: string): Promise<boolean> {
  const e = ev as { score?: unknown; verdict?: unknown; summary?: unknown; metrics?: unknown; cases?: unknown; process?: unknown } | undefined;
  if (!e || typeof e.score !== "number" || e.score < 0 || e.score > 100) return false;
  const events = await db.taskEvent.findMany({ where: { taskId: task.id }, orderBy: { createdAt: "asc" } });
  const transcript = events.map((x) => `- ${x.createdAt.toISOString()} ${x.message}`).join("\n");
  await db.evaluationReport.upsert({
    where: { taskId: task.id },
    create: {
      taskId: task.id,
      requesterId: task.userId,
      skillVersionId: task.skillVersionId,
      model: task.model,
      method: task.evalMethod ?? "rubric",
      methodDetail: task.evalCriteria ?? "",
      process: `${typeof e.process === "string" ? e.process : ""}\n\n#### Execution log\n${transcript}`.trim(),
      result: { score: e.score, verdict: e.verdict ?? null, summary: e.summary ?? summary, metrics: e.metrics ?? {}, cases: e.cases ?? [] },
      score: e.score,
    },
    update: {},
  });
  return true;
}

async function cleanup() {
  const now = new Date();
  // 1. results past their download window
  // deletion is paused unless RETENTION_DELETE=1: expired results are only marked (downloads are refused), so a
  // later subscription can bring them back
  const expired = config.retention.deleteExpired ? await db.artifact.findMany({ where: { deletedAt: null, expiresAt: { lt: now } }, take: 200 }) : [];
  for (const a of expired) {
    await deleteObject(a.key).catch((e) => log("delete failed", a.key, e));
    await db.artifact.update({ where: { id: a.id }, data: { deletedAt: now } });
  }
  // 2. funding requests nobody answered → close with partial results
  // (a crowdfunded task with an open top-up round waits for the round instead)
  const stale = await db.task.findMany({ where: { status: "NEEDS_FUNDING", topupGoalTwd: null, fundingRequestedAt: { lt: addDays(now, -config.retention.freeDays) } } });
  for (const t of stale) {
    await db.task.update({ where: { id: t.id }, data: { status: "COMPLETED", finishedAt: now, fundingRequestedAt: null } });
    await event(t.id, "closed", "Closed automatically: no top-up within the retention window");
    if (t.crowdfund) await settleTask(t.id).catch((e) => log("settle error", t.id, e));
  }
  // 3. idle containers past retention (re-check subscriptions first)
  const idle = await db.userContainer.findMany({ where: { expiresAt: { lt: now }, status: { not: "running" } } });
  for (const c of idle) {
    const active = await db.task.count({ where: { userId: c.userId, status: { in: ["QUEUED", "RUNNING", "NEEDS_FUNDING"] } } });
    if (active) continue;
    const exp = await containerExpiry(c.userId, c.lastActiveAt);
    if (exp > now) {
      await db.userContainer.update({ where: { userId: c.userId }, data: { expiresAt: exp } });
      continue;
    }
    if (!config.retention.deleteExpired) continue; // paused: keep the container
    await executor.removeUserContainer(c.userId);
    await db.userContainer.delete({ where: { userId: c.userId } });
    log("removed container", c.containerName);
  }
  // 3b. crowdfunded tasks that are over (settled, or never funded): remove their own container
  const overCrowd = await db.task.findMany({
    where: { crowdfund: true, containerName: { startsWith: "sb-c-" }, status: { in: ["COMPLETED", "FAILED", "CANCELLED", "UNFUNDED"] }, OR: [{ settledAt: { not: null } }, { fundedAt: null }] },
    select: { id: true },
    take: 50,
  });
  for (const t of overCrowd) {
    await executor.removeTaskContainer(t.id);
    await db.task.update({ where: { id: t.id }, data: { containerName: null } });
  }
  // 4. runs whose worker died → requeue (continues in the same session)
  const dead = await db.task.updateMany({
    where: { status: "RUNNING", heartbeatAt: { lt: new Date(now.getTime() - 10 * 60_000) }, NOT: { workerId: WORKER_ID } },
    data: { status: "QUEUED", workerId: null },
  });
  if (dead.count) log("requeued stale tasks", dead.count);
}

/** Boltchain storage runs beside the task loop so slow chain transactions never delay tasks */
async function keeperLoop() {
  if (!config.boltchain.enabled || process.env.STORAGE_KEEPER === "0") return;
  log("storage keeper on (Boltchain)");
  while (!stopping) {
    await keeperTick().catch((e) => log("storage keeper error", e));
    await new Promise((r) => setTimeout(r, 30_000));
  }
}

async function loop() {
  void keeperLoop();
  log(`started (mode=${config.runner.mode}, concurrency=${config.runner.concurrency})`);
  let lastCleanup = 0;
  let lastReconcile = 0;
  let lastCrowd = 0;
  let lastScreen = 0;
  while (!stopping) {
    try {
      const ids = await claim(config.runner.concurrency - running.size);
      for (const id of ids) {
        running.add(id);
        log("running", id);
        runTask(id)
          .catch(async (e) => {
            log("task crashed", id, e);
            await db.task.update({ where: { id }, data: { status: "FAILED", error: String(e).slice(0, 2000), workerId: null } }).catch(() => {});
          })
          .finally(() => running.delete(id));
      }
      // keep heartbeats fresh for long runs between meter readings
      if (running.size) await db.task.updateMany({ where: { id: { in: [...running] } }, data: { heartbeatAt: new Date() } });
      if (Date.now() - lastReconcile > 3 * 60_000) {
        lastReconcile = Date.now();
        const r = await reconcilePayments().catch((e) => (log("reconcile error", e), null));
        if (r?.settled) log("payments settled by reconciliation", r.settled);
        const swept = await sweepHolds().catch((e) => (log("hold sweep error", e), 0));
        if (swept) log("expired model holds settled", swept);
        await purgeNonces().catch(() => undefined);
      }
      if (Date.now() - lastCrowd > 60_000) {
        lastCrowd = Date.now();
        const c = await crowdTick().catch((e) => (log("crowdfunding error", e), null));
        if (c && (c.ended || c.settled)) log("crowdfunding", c);
      }
      // submitted proposals are screened right away
      if (Date.now() - lastScreen > 10_000) {
        lastScreen = Date.now();
        const n = await screeningTick().catch((e) => (log("screening error", e), 0));
        if (n) log("proposals screened", n);
      }
      if (Date.now() - lastCleanup > 10 * 60_000) {
        lastCleanup = Date.now();
        await cleanup();
        // record and notarize any legal text that changed (settings, checklist, deploys)
        await snapshotAllLegal().catch((e) => log("legal snapshot error", e));
      }
    } catch (e) {
      log("loop error", e);
    }
    await new Promise((r) => setTimeout(r, config.runner.pollSeconds * 1000));
  }
}

for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    stopping = true;
    log("stopping; running tasks will be requeued by another worker if interrupted");
    setTimeout(() => process.exit(0), 2000);
  });

async function main() {
  await loadSettings();
  executor = config.runner.mode === "mock" ? new MockExecutor() : new DockerExecutor();
  if (process.argv.includes("--cleanup-once")) await cleanup().then(() => process.exit(0));
  else await loop();
}
void main();

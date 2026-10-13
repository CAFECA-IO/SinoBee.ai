/**
 * SinoBee.ai task worker
 *  - claims QUEUED commissioned tasks (FOR UPDATE SKIP LOCKED, safe with several workers)
 *  - runs each in the requester's own docker container (DockerExecutor) or simulated (MockExecutor)
 *  - meters cost while running: 1.5 × (tokens + VM time + S3), stops when the budget is used up
 *  - uploads results, applies retention, notifies the requester through CAFECA
 *  - cleanup: expired results, idle containers (7 days for non-subscribers), stale runs, unanswered funding requests
 *
 * Run: npm run worker
 */
import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import { config } from "../src/lib/config";
import { chargeTwdc, s3CostUsd, vmCostUsd } from "../src/lib/pricing";
import { deleteObject, putObject } from "../src/lib/storage";
import { notify } from "../src/lib/notify";
import { addDays, containerExpiry, resultsRetentionDays } from "../src/lib/retention";
import { fmtTwdc } from "../src/lib/money";
import { DockerExecutor, containerName, volumeName } from "./docker-executor";
import { MockExecutor } from "./mock-executor";
import type { Executor, TaskWithRefs, Usage } from "./types";

const WORKER_ID = `${process.env.HOSTNAME ?? "worker"}-${randomUUID().slice(0, 8)}`;
const executor: Executor = config.runner.mode === "mock" ? new MockExecutor() : new DockerExecutor();
const running = new Set<string>();
let stopping = false;

const log = (...a: unknown[]) => console.log(new Date().toISOString(), `[worker ${WORKER_ID}]`, ...a);

async function event(taskId: string, type: string, message: string, data?: object) {
  await db.taskEvent.create({ data: { taskId, type, message, data: data ?? undefined } });
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

function costs(task: { usdTwdRate: unknown; budget: unknown }, tokenUsd: number, vmSeconds: number, s3Usd: number) {
  const vmUsd = vmCostUsd(vmSeconds);
  const charge = chargeTwdc({ tokenUsd, vmUsd, s3Usd }, Number(String(task.usdTwdRate)));
  return { vmUsd, charge };
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
  await db.userContainer.upsert({
    where: { userId: task.userId },
    create: { userId: task.userId, containerName: containerName(task.userId), volumeName: volumeName(task.userId), status: "running", expiresAt: null },
    update: { status: "running", lastActiveAt: new Date(), expiresAt: null },
  });
  await db.task.update({ where: { id }, data: { containerName: containerName(task.userId) } });
  await event(id, "run.started", continuation ? "Run resumed after top-up" : "Run started", { worker: WORKER_ID, mode: config.runner.mode });

  const persistUsage = async (u: Usage, vmSeconds: number, s3Usd: number, extra: object = {}) => {
    const { vmUsd, charge } = costs(task, u.tokenCostUsd, vmSeconds, s3Usd);
    await db.task.update({
      where: { id },
      data: {
        inputTokens: BigInt(u.inputTokens),
        outputTokens: BigInt(u.outputTokens),
        tokenCostUsd: u.tokenCostUsd.toFixed(8),
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

  let result;
  try {
    result = await executor.run(task, {
      continuation,
      log: (m, d) => event(id, "log", m, d),
      onUsage: async (u, elapsed) => {
        const charge = await persistUsage(u, prevVmSeconds + elapsed, prevS3);
        return charge >= budget ? "stop" : "continue";
      },
    });
  } catch (e) {
    log("executor error", id, e);
    result = { outcome: "failed" as const, usage: { inputTokens: Number(task.inputTokens), outputTokens: Number(task.outputTokens), tokenCostUsd: Number(task.tokenCostUsd) }, elapsedSeconds: 0, archive: null, summary: "", error: String(e) };
  }

  // upload results and bill S3 for the retention window
  const retentionDays = await resultsRetentionDays(task.userId);
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
  const chargedStr = fmtTwdc(Math.min(charge, budget));

  if (result.outcome === "stopped") {
    await db.task.update({ where: { id }, data: { status: "NEEDS_FUNDING", fundingRequestedAt: now, resultsExpireAt: expires, workerId: null } });
    await event(id, "funding.requested", `Budget used up (${chargedStr} / ${fmtTwdc(budget)} TWDC). Partial results saved.`);
    await notify(task.userId, {
      type: "task.needs_funding",
      title: `預算已用完 Budget used up: ${task.title}`,
      body: `任務尚未完成，已整理目前成果。請補充經費繼續執行，或結案並下載目前成果（${retentionDays} 天內）。\nThe task is not finished yet. Partial results are ready. Add funds to continue, or close the task and download the results within ${retentionDays} days.`,
      link: `/tasks/${id}`,
      data: { taskId: id, charged: chargedStr, budget: fmtTwdc(budget), actions: ["top_up", "close"] },
    });
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
    await event(id, reportOk ? "completed" : "failed", reportOk ? `Completed. Charged ${chargedStr} TWDC.` : "Evaluation report missing or invalid");
    await notify(task.userId, {
      type: reportOk ? "task.completed" : "task.failed",
      title: `${reportOk ? "任務完成 Task completed" : "任務失敗 Task failed"}: ${task.title}`,
      body: `請於 ${expires.toISOString().slice(0, 16).replace("T", " ")} UTC 前下載成果，逾期將無法下載。\nDownload the results before ${expires.toISOString().slice(0, 16).replace("T", " ")} UTC; they cannot be downloaded afterwards. Charged ${chargedStr} TWDC.`,
      link: `/tasks/${id}`,
    });
  } else {
    await db.task.update({ where: { id }, data: { status: "FAILED", error: (result.error ?? "").slice(0, 4000), finishedAt: now, resultsExpireAt: expires, workerId: null } });
    await event(id, "failed", "Run failed", { error: (result.error ?? "").slice(0, 2000) });
    await notify(task.userId, {
      type: "task.failed",
      title: `任務失敗 Task failed: ${task.title}`,
      body: `執行失敗，已收取 ${chargedStr} TWDC。可下載的部分成果保留至 ${expires.toISOString().slice(0, 10)}。\nThe run failed. Charged ${chargedStr} TWDC.`,
      link: `/tasks/${id}`,
    });
  }

  await db.userContainer.update({
    where: { userId: task.userId },
    data: { status: "idle", lastActiveAt: new Date(), expiresAt: await containerExpiry(task.userId) },
  });
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
  const expired = await db.artifact.findMany({ where: { deletedAt: null, expiresAt: { lt: now } }, take: 200 });
  for (const a of expired) {
    await deleteObject(a.key).catch((e) => log("delete failed", a.key, e));
    await db.artifact.update({ where: { id: a.id }, data: { deletedAt: now } });
  }
  // 2. funding requests nobody answered → close with partial results
  const stale = await db.task.findMany({ where: { status: "NEEDS_FUNDING", fundingRequestedAt: { lt: addDays(now, -config.retention.freeDays) } } });
  for (const t of stale) {
    await db.task.update({ where: { id: t.id }, data: { status: "COMPLETED", finishedAt: now, fundingRequestedAt: null } });
    await event(t.id, "closed", "Closed automatically: no top-up within the retention window");
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
    await executor.removeUserContainer(c.userId);
    await db.userContainer.delete({ where: { userId: c.userId } });
    log("removed container", c.containerName);
  }
  // 4. runs whose worker died → requeue (continues in the same session)
  const dead = await db.task.updateMany({
    where: { status: "RUNNING", heartbeatAt: { lt: new Date(now.getTime() - 10 * 60_000) }, NOT: { workerId: WORKER_ID } },
    data: { status: "QUEUED", workerId: null },
  });
  if (dead.count) log("requeued stale tasks", dead.count);
}

async function loop() {
  log(`started (mode=${config.runner.mode}, concurrency=${config.runner.concurrency})`);
  let lastCleanup = 0;
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
      if (Date.now() - lastCleanup > 10 * 60_000) {
        lastCleanup = Date.now();
        await cleanup();
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

if (process.argv.includes("--cleanup-once")) cleanup().then(() => process.exit(0));
else loop();

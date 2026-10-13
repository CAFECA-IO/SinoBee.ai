import Docker from "dockerode";
import { PassThrough, Readable } from "node:stream";
import { createGzip } from "node:zlib";
import { config } from "../src/lib/config";
import { getObject } from "../src/lib/storage";
import { buildPrompt, taskSession, type Executor, type RunContext, type RunResult, type TaskWithRefs, type Usage } from "./types";

const HOME = "/home/bee";
const docker = new Docker(); // DOCKER_HOST or /var/run/docker.sock

export const containerName = (userId: string) => `sb-u-${userId}`;
export const volumeName = (userId: string) => `sb-home-${userId}`;

async function streamToBuffer(s: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of s as AsyncIterable<Buffer>) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

/** Run a command in the container, return exit code + combined output (capped) */
async function exec(c: Docker.Container, cmd: string[], opts: { workdir?: string; env?: string[]; maxOutput?: number } = {}) {
  const ex = await c.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true, WorkingDir: opts.workdir, Env: opts.env, User: "bee" });
  const stream = await ex.start({ hijack: true, stdin: false });
  const out = new PassThrough();
  const err = new PassThrough();
  docker.modem.demuxStream(stream, out, err);
  const max = opts.maxOutput ?? 200_000;
  let text = "";
  const add = (b: Buffer) => {
    if (text.length < max) text += b.toString("utf8");
  };
  out.on("data", add);
  err.on("data", add);
  await new Promise<void>((resolve, reject) => {
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
  const info = await ex.inspect();
  return { code: info.ExitCode ?? -1, output: text.slice(0, max) };
}

/** One isolated container (+ home volume) per user, created on demand */
async function ensureContainer(task: TaskWithRefs): Promise<Docker.Container> {
  const name = containerName(task.userId);
  const c = docker.getContainer(name);
  try {
    const info = await c.inspect();
    if (!info.State.Running) await c.start();
    return c;
  } catch (e) {
    if ((e as { statusCode?: number }).statusCode !== 404) throw e;
  }
  const env = [
    "SINOBEE_APPROVAL=auto",
    `SINOBEE_MODEL=${task.model}`,
    `SINOBEE_SERVER_TOKEN=${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
    ...config.runner.passEnv.filter((k) => process.env[k]).map((k) => `${k}=${process.env[k]}`),
  ];
  const created = await docker.createContainer({
    name,
    Image: config.runner.image,
    Env: env,
    Labels: { "ai.sinobee.user": task.userId, "ai.sinobee.managed": "1" },
    HostConfig: {
      Binds: [`${volumeName(task.userId)}:${HOME}/.sinobee`],
      NanoCpus: Math.round(config.runner.cpus * 1e9),
      Memory: config.runner.memoryMb * 1024 * 1024,
      ShmSize: 1024 * 1024 * 1024,
      PidsLimit: 1024,
      SecurityOpt: ["no-new-privileges"],
      RestartPolicy: { Name: "unless-stopped" },
      ...(config.runner.network ? { NetworkMode: config.runner.network } : {}),
    },
  });
  await created.start();
  // wait for the agent runtime to come up
  for (let i = 0; i < 30; i++) {
    const r = await exec(created, ["sh", "-c", "command -v sinobee >/dev/null && echo ok"]).catch(() => ({ code: 1, output: "" }));
    if (r.code === 0) break;
    await new Promise((res) => setTimeout(res, 2000));
  }
  return created;
}

async function installSkill(c: Docker.Container, task: TaskWithRefs, ctx: RunContext) {
  const sv = task.skillVersion!;
  const bundle = await getObject(sv.bundleKey);
  const dest = `/tmp/sb-skill-${task.id}`;
  await exec(c, ["mkdir", "-p", dest]);
  // putArchive accepts gzip tarballs and extracts them into `path`
  await c.putArchive(Readable.from(bundle), { path: dest });
  const r = await exec(c, ["sinobee", "skills", "install", `${dest}/${sv.skill.name}`, "--trust", "local", "--force"]);
  await ctx.log(`Installed skill ${sv.skill.publisher.publisher}/${sv.skill.name}@${sv.version} (exit ${r.code})`);
}

async function readUsage(c: Docker.Container, session: string): Promise<Usage> {
  const py = [
    "import sqlite3, json, os",
    "p = os.path.expanduser('~/.sinobee/sinobee.db')",
    "r = (0, 0, 0.0)",
    "if os.path.exists(p):",
    "    db = sqlite3.connect(p)",
    "    r = db.execute('SELECT COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(cost_usd),0) FROM usage WHERE session_id=?', (" + JSON.stringify(session) + ",)).fetchone()",
    "print(json.dumps(r))",
  ].join("\n");
  const r = await exec(c, ["python3", "-c", py]);
  const last = r.output.trim().split("\n").pop() ?? "[0,0,0]";
  const [i, o, cost] = JSON.parse(last) as [number, number, number];
  return { inputTokens: i, outputTokens: o, tokenCostUsd: cost };
}

export class DockerExecutor implements Executor {
  async run(task: TaskWithRefs, ctx: RunContext): Promise<RunResult> {
    const c = await ensureContainer(task);
    const session = taskSession(task.id);
    const workdir = `${HOME}/workspace/tasks/${task.id}`;
    await exec(c, ["mkdir", "-p", `${workdir}/outputs`]);
    if (task.skillVersion && !ctx.continuation) await installSkill(c, task, ctx);

    const prompt = buildPrompt(task, workdir, ctx.continuation);
    await ctx.log(ctx.continuation ? "Continuing the task in the user's container" : "Starting SinoBee in the user's container", { container: containerName(task.userId) });

    const started = Date.now();
    let stopped = false;
    const run = exec(c, ["sinobee", "run", "-q", "--approval", "auto", "-m", task.model, "-s", session, prompt], { workdir });

    // metering loop: read cumulative usage, let the caller decide whether to continue
    let usage: Usage = { inputTokens: 0, outputTokens: 0, tokenCostUsd: 0 };
    let done = false;
    run.finally(() => (done = true)).catch(() => {});
    const maxMs = config.runner.maxTaskHours * 3600_000;
    while (!done) {
      await new Promise((r) => setTimeout(r, 15_000));
      if (done) break;
      usage = await readUsage(c, session).catch(() => usage);
      const elapsed = Math.round((Date.now() - started) / 1000);
      const decision = await ctx.onUsage(usage, elapsed);
      if (decision === "stop" || Date.now() - started > maxMs) {
        stopped = true;
        await ctx.log(decision === "stop" ? "Budget exhausted — stopping the agent" : "Maximum run time reached — stopping the agent");
        await exec(c, ["pkill", "-INT", "-f", `-s ${session}`]).catch(() => {});
        await new Promise((r) => setTimeout(r, 10_000));
        await exec(c, ["pkill", "-KILL", "-f", `-s ${session}`]).catch(() => {});
        break;
      }
    }
    const result = await run.catch((e) => ({ code: -1, output: String(e) }));
    usage = await readUsage(c, session).catch(() => usage);
    const elapsedSeconds = Math.round((Date.now() - started) / 1000);

    // collect outputs (SUMMARY.md, evaluation.json, and the whole outputs/ folder)
    const summary = (await exec(c, ["sh", "-c", `cat ${workdir}/outputs/SUMMARY.md 2>/dev/null | head -c 20000`])).output || result.output.slice(-4000);
    let evaluation: unknown;
    if (task.kind === "EVALUATION") {
      const ev = await exec(c, ["sh", "-c", `cat ${workdir}/outputs/evaluation.json 2>/dev/null`]);
      try {
        evaluation = JSON.parse(ev.output);
      } catch {
        evaluation = undefined;
      }
    }
    let archive: Buffer | null = null;
    try {
      const tarStream = await c.getArchive({ path: `${workdir}/outputs` });
      archive = await streamToBuffer(tarStream.pipe(createGzip()));
    } catch (e) {
      await ctx.log("Could not collect outputs: " + String(e));
    }

    const outcome: RunResult["outcome"] = stopped ? "stopped" : result.code === 0 ? "completed" : "failed";
    return { outcome, usage, elapsedSeconds, archive, summary, evaluation, error: outcome === "failed" ? result.output.slice(-2000) : undefined };
  }

  async removeUserContainer(userId: string) {
    const c = docker.getContainer(containerName(userId));
    await c.remove({ force: true }).catch(() => {});
    await docker.getVolume(volumeName(userId)).remove().catch(() => {});
  }
}

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import Docker from "dockerode";
import { config, taskServices } from "../config";
import { HttpError } from "../errors";
import { macKey } from "../settings/box";
import { ensureDockerNetwork } from "../docker-net";

/**
 * 線上使用: every signed-in user gets their own SinoBee container (Web UI + virtual desktop), reached through the
 * agent gateway (scripts/agent-gateway.ts) on its own origin (AGENT_ORIGIN), because SinoBee's Web UI expects to be
 * served from the root of an origin.
 *
 *  - container `sb-u-<userId>`, created on demand from the SinoBee image (runner.image), with the user's own volumes
 *    for ~/.sinobee and ~/workspace; ports published on 127.0.0.1 only (random host ports), so only the gateway on
 *    this machine reaches it; on the services network so it can use Ollama / MiniMax H3
 *  - the container's server token stays between the gateway and the container; the browser never sees it
 *  - no platform API keys go into it: the user signs in to SinoBee.ai inside SinoBee (subscription models) or uses
 *    local models
 *  - the site hands the browser to the gateway with a short-lived signed ticket; the gateway then keeps its own
 *    signed cookie
 */

const docker = new Docker(); // DOCKER_HOST or /var/run/docker.sock
const HOME = "/home/bee";
const API_PORT = "10024/tcp";
const VNC_PORT = "6080/tcp";

export const personalContainer = (userId: string) => `sb-u-${userId}`;
export const agentOrigin = () => (process.env.AGENT_ORIGIN || "http://localhost:10025").replace(/\/+$/, "");

export type PersonalAgent = { name: string; api: string; vnc: string; token: string };

const envOf = (list: string[] | undefined, key: string) => list?.find((e) => e.startsWith(`${key}=`))?.slice(key.length + 1) ?? "";

async function describe(c: Docker.Container): Promise<PersonalAgent | null> {
  const info = await c.inspect();
  if (!info.State.Running) return null;
  const port = (p: string) => info.NetworkSettings.Ports?.[p]?.[0]?.HostPort;
  const api = port(API_PORT);
  const vnc = port(VNC_PORT);
  if (!api) return null;
  return { name: info.Name.replace(/^\//, ""), api: `http://127.0.0.1:${api}`, vnc: vnc ? `http://127.0.0.1:${vnc}` : "", token: envOf(info.Config.Env, "SINOBEE_SERVER_TOKEN") };
}

/** The user's running container, or null (does not start anything) */
export async function findPersonalAgent(userId: string): Promise<PersonalAgent | null> {
  try {
    return await describe(docker.getContainer(personalContainer(userId)));
  } catch (e) {
    if ((e as { statusCode?: number }).statusCode === 404) return null;
    throw e;
  }
}

/** Starts (creating on first use) the user's SinoBee container and waits until its Web UI answers */
export async function ensurePersonalAgent(userId: string): Promise<PersonalAgent> {
  const name = personalContainer(userId);
  const c = docker.getContainer(name);
  let exists = true;
  try {
    const info = await c.inspect();
    if (!info.State.Running) await c.start();
  } catch (e) {
    if ((e as { statusCode?: number }).statusCode !== 404) throw e;
    exists = false;
  }
  if (!exists) {
    const image = config.runner.image;
    try {
      await docker.getImage(image).inspect();
    } catch {
      throw new HttpError(503, `the SinoBee image (${image}) is not on this server yet: an admin builds it with npm run swarm -- --build`);
    }
    const { ollama, comfyui } = taskServices();
    await ensureDockerNetwork(docker, config.runner.network);
    const created = await docker.createContainer({
      name,
      Image: image,
      Env: [
        `SINOBEE_SERVER_TOKEN=${randomBytes(24).toString("base64url")}`,
        // the desktop view goes through the gateway as well
        `SINOBEE_VNC_URL=${agentOrigin()}/__vnc/vnc.html?autoconnect=1&resize=scale&reconnect=1&path=__vnc/websockify`,
        ...(ollama ? [`SINOBEE_OLLAMA_URL=${ollama}`, `OLLAMA_HOST=${ollama}`] : []),
        ...(comfyui ? [`COMFYUI_URL=${comfyui}`] : []),
      ],
      Labels: { "ai.sinobee.managed": "1", "ai.sinobee.personal": userId },
      ExposedPorts: { [API_PORT]: {}, [VNC_PORT]: {} },
      HostConfig: {
        Binds: [`sb-uhome-${userId}:${HOME}/.sinobee`, `sb-uwork-${userId}:${HOME}/workspace`],
        PortBindings: { [API_PORT]: [{ HostIp: "127.0.0.1", HostPort: "" }], [VNC_PORT]: [{ HostIp: "127.0.0.1", HostPort: "" }] },
        NanoCpus: Math.round(config.runner.cpus * 1e9),
        Memory: config.runner.memoryMb * 1024 * 1024,
        ShmSize: 1024 * 1024 * 1024,
        PidsLimit: 1024,
        SecurityOpt: ["no-new-privileges"],
        RestartPolicy: { Name: "unless-stopped" },
        ...(config.runner.network ? { NetworkMode: config.runner.network } : {}),
      },
    });
    try {
      await created.start();
    } catch (e) {
      await created.remove({ force: true }).catch(() => undefined);
      throw e;
    }
  }
  for (let i = 0; i < 60; i++) {
    const a = await describe(c).catch(() => null);
    if (a) {
      const ok = await fetch(`${a.api}/api/status?token=${encodeURIComponent(a.token)}`, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok).catch(() => false);
      if (ok) return a;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new HttpError(504, "your SinoBee did not start in time; try again in a minute");
}

/** Stops the user's container (its volumes stay); used for idle containers */
export async function stopPersonalAgent(userId: string) {
  await docker.getContainer(personalContainer(userId)).stop({ t: 20 }).catch(() => undefined);
}

// ---------------- tickets and gateway cookies ----------------

const mac = (data: string) => createHmac("sha256", macKey("agent-gateway")).update(data).digest("base64url");

/** `<kind>.<userId>.<expires>.<mac>` */
export function signAgentToken(kind: "ticket" | "session", userId: string, ttlSeconds: number): string {
  const body = `${kind}.${userId}.${Math.floor(Date.now() / 1000) + ttlSeconds}`;
  return `${body}.${mac(body)}`;
}

export function verifyAgentToken(kind: "ticket" | "session", token: string | undefined | null): string | null {
  const parts = (token ?? "").split(".");
  if (parts.length !== 4 || parts[0] !== kind || !/^[a-z0-9]{8,40}$/i.test(parts[1])) return null;
  const body = parts.slice(0, 3).join(".");
  const a = Buffer.from(mac(body));
  const b = Buffer.from(parts[3]);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Number(parts[2]) < Date.now() / 1000) return null;
  return parts[1];
}

/** Where the site sends a signed-in user: the gateway's entry with a one-minute ticket */
export const enterUrl = (userId: string) => `${agentOrigin()}/__sb/enter?ticket=${encodeURIComponent(signAgentToken("ticket", userId, 60))}`;

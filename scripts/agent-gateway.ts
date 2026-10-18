/**
 * Agent gateway (npm run agent-gateway; started by npm run swarm): serves each signed-in user's own SinoBee container
 * on AGENT_ORIGIN (default http://localhost:10025, in production e.g. https://agent.sinobee.ai behind the reverse proxy).
 *
 *   GET /__sb/enter?ticket=…   the site's signed one-minute ticket → the gateway's own cookie, then /
 *   /__vnc/*                    the container's noVNC (virtual desktop), HTTP and WebSocket
 *   everything else             the container's SinoBee Web UI / API / WebSocket, with its server token added here
 *
 * No cookie (or an expired one) → back to the site's /agent page, which asks the user to sign in. Containers idle
 * for AGENT_IDLE_HOURS (default 2) are stopped; their volumes stay.
 */
import "dotenv/config";
import http from "node:http";
import net from "node:net";
import { URL } from "node:url";

const PORT = Number(process.env.AGENT_PORT || 10025);
const COOKIE = "sb_agent";
const SESSION_TTL = 12 * 3600;
const IDLE_MS = Number(process.env.AGENT_IDLE_HOURS || 2) * 3600_000;

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[agent]", ...a);

async function main() {
  const store = await import("../src/lib/settings/store");
  await store.loadSettings();
  const { config } = await import("../src/lib/config");
  const agent = await import("../src/lib/agent/personal");
  const site = config.origin;
  const secure = agent.agentOrigin().startsWith("https://");
  const lastSeen = new Map<string, number>();

  const cookieOf = (req: http.IncomingMessage) =>
    Object.fromEntries((req.headers.cookie ?? "").split(";").map((c) => c.trim().split("=").map(decodeURIComponent) as [string, string]))[COOKIE];
  const userOf = (req: http.IncomingMessage) => agent.verifyAgentToken("session", cookieOf(req));

  // the running container for a user (started again if it was stopped while idle)
  async function target(userId: string) {
    lastSeen.set(userId, Date.now());
    return (await agent.findPersonalAgent(userId)) ?? (await agent.ensurePersonalAgent(userId));
  }

  /** Path + query for the container: /__vnc/* goes to noVNC; the UI's own token parameter is replaced by the real one */
  function route(a: { api: string; vnc: string; token: string }, rawUrl: string) {
    const u = new URL(rawUrl, "http://x");
    if (u.pathname === "/__vnc" || u.pathname.startsWith("/__vnc/")) {
      if (!a.vnc) return null;
      return { base: a.vnc, path: (u.pathname.slice("/__vnc".length) || "/") + u.search };
    }
    u.searchParams.set("token", a.token);
    return { base: a.api, path: u.pathname + u.search };
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://x");
      if (url.pathname === "/__sb/enter") {
        const userId = agent.verifyAgentToken("ticket", url.searchParams.get("ticket"));
        if (!userId) return redirect(res, `${site}/agent`);
        await target(userId);
        res.setHeader("set-cookie", `${COOKIE}=${agent.signAgentToken("session", userId, SESSION_TTL)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL}${secure ? "; Secure" : ""}`);
        return redirect(res, "/");
      }
      if (url.pathname === "/__sb/health") return void res.end("ok");
      const userId = userOf(req);
      if (!userId) return redirect(res, `${site}/agent`);
      const a = await target(userId);
      const r = route(a, req.url ?? "/");
      if (!r) return void res.writeHead(404).end();
      // the gateway's cookie stays here; the container gets its token instead
      const headers: http.OutgoingHttpHeaders = { ...req.headers, host: new URL(r.base).host, "x-sinobee-token": a.token };
      delete headers.cookie;
      const up = http.request(
        `${r.base}${r.path}`,
        { method: req.method, headers },
        (upRes) => {
          res.writeHead(upRes.statusCode ?? 502, upRes.headers);
          upRes.pipe(res);
        },
      );
      up.on("error", (e) => {
        if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
        res.end(`SinoBee is not answering: ${e.message}`);
      });
      req.pipe(up);
    } catch (e) {
      if (!res.headersSent) res.writeHead((e as { status?: number }).status ?? 500, { "content-type": "text/plain; charset=utf-8" });
      res.end((e as Error).message);
    }
  });

  // WebSockets (/ws for the UI, /__vnc/websockify for the desktop): raw TCP after the upgrade request
  server.on("upgrade", async (req, socket, head) => {
    try {
      const userId = userOf(req);
      if (!userId) return socket.destroy();
      const a = await target(userId);
      const r = route(a, req.url ?? "/");
      if (!r) return socket.destroy();
      const base = new URL(r.base);
      const up = net.connect(Number(base.port), base.hostname, () => {
        const headers = { ...req.headers, host: base.host, cookie: undefined } as Record<string, string | string[] | undefined>;
        const lines = [`${req.method} ${r.path} HTTP/1.1`];
        for (const [k, v] of Object.entries(headers)) if (v !== undefined) for (const x of Array.isArray(v) ? v : [v]) lines.push(`${k}: ${x}`);
        up.write(lines.join("\r\n") + "\r\n\r\n");
        if (head.length) up.write(head);
        up.pipe(socket);
        socket.pipe(up);
      });
      const close = () => {
        up.destroy();
        socket.destroy();
      };
      up.on("error", close);
      socket.on("error", close);
      lastSeen.set(userId, Date.now());
    } catch {
      socket.destroy();
    }
  });

  function redirect(res: http.ServerResponse, to: string) {
    res.writeHead(302, { location: to });
    res.end();
  }

  // containers already running when the gateway (re)starts count as just used
  const Docker = (await import("dockerode")).default;
  for (const c of await new Docker().listContainers({ filters: { label: ["ai.sinobee.personal"] } }).catch(() => [])) lastSeen.set(c.Labels["ai.sinobee.personal"], Date.now());

  // stop containers nobody used for a while (volumes stay; the next visit starts them again)
  setInterval(() => {
    for (const [userId, at] of lastSeen)
      if (Date.now() - at > IDLE_MS) {
        lastSeen.delete(userId);
        void agent.stopPersonalAgent(userId).then(() => log(`stopped idle ${agent.personalContainer(userId)}`));
      }
  }, 5 * 60_000).unref();

  server.listen(PORT, () => log(`gateway on :${PORT} → ${agent.agentOrigin()} (site ${site})`));
}

main().catch((e) => {
  console.error("[agent]", e);
  process.exit(1);
});

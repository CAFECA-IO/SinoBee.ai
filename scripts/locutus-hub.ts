/**
 * Locutus hub (npm run locutus-hub; started by npm run swarm when locutus.enabled is on): Borg Locutus nodes link in
 * over WebSocket and supply models to the relay as provider `locutus` (src/lib/locutus/hub.ts).
 *
 *   ws(s)://…/locutus/link   nodes (the reverse proxy forwards this path here, with WebSocket upgrade)
 *   http://127.0.0.1:<port>/openai/*   the relay's upstream (Authorization: Bearer locutus.hubSecret)
 *
 * Listens on LOCUTUS_HUB_HOST (default 127.0.0.1) and locutus.hubPort (default 10026).
 */
import "dotenv/config";
import http from "node:http";

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[locutus]", ...a);

async function main() {
  const store = await import("../src/lib/settings/store");
  await store.loadSettings();
  await store.generateMissing(log);
  const { sv, svBool, svList, svNum } = await import("../src/lib/settings/cache");
  const { config } = await import("../src/lib/config");
  const { LocutusHub, parseNodes } = await import("../src/lib/locutus/hub");
  const hub = new LocutusHub({
    name: new URL(config.origin).host,
    enabled: () => svBool("locutus.enabled"),
    secret: () => sv("locutus.hubSecret"),
    nodes: () => parseNodes(svList("locutus.nodes")),
    blocked: () => new Set(svList("locutus.blocked").map((a) => a.toLowerCase())),
    reload: async () => void (await store.loadSettings({ refreshEveryMs: 0 })),
    log,
  });
  const server = http.createServer(hub.http);
  server.on("upgrade", hub.upgrade);
  const host = process.env.LOCUTUS_HUB_HOST || "127.0.0.1";
  const port = svNum("locutus.hubPort");
  server.listen(port, host, () => log(`hub on ${host}:${port} (nodes link at ${sv("locutus.publicUrl") || `ws://${host}:${port}/link`}; ${svList("locutus.nodes").length} registered)`));
  const stop = () => {
    hub.close();
    server.close();
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

main().catch((e) => {
  console.error("[locutus]", e);
  process.exit(1);
});

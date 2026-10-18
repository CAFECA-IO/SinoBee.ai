import type Docker from "dockerode";

/** Creates a docker network when it does not exist yet (e.g. the services network before the swarm made it) */
export async function ensureDockerNetwork(docker: Docker, name: string | undefined) {
  if (!name || ["bridge", "host", "none", "default"].includes(name)) return;
  try {
    await docker.getNetwork(name).inspect();
  } catch (e) {
    if ((e as { statusCode?: number }).statusCode !== 404) throw e;
    await docker.createNetwork({ Name: name, Labels: { "ai.sinobee.managed": "1" } }).catch((err: { statusCode?: number }) => {
      if (err.statusCode !== 409) throw err; // created meanwhile
    });
  }
}

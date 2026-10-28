/**
 * Runs once when the server starts: loads the settings (and creates missing keys), then prints the owner claim
 * code when the site has no owner yet (see src/lib/roles.ts). If the database is unreachable at start-up, both are
 * retried every 15 s until it comes back, so the site recovers without a restart.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { isDbDown } = await import("./lib/db-health");
  const retry = (label: string, fn: () => Promise<unknown>) => {
    const run = async (): Promise<void> => {
      try {
        await fn();
      } catch (e) {
        if (isDbDown(e)) {
          console.warn(`${label}: database unreachable, retrying in 15 s`);
          setTimeout(() => void run(), 15_000).unref?.();
          return;
        }
        // e.g. the database is not migrated yet; /admin/claim explains how to get a code
        console.warn(`${label}:`, e instanceof Error ? e.message : e);
      }
    };
    return run();
  };
  await retry("settings not loaded (is the database migrated?)", async () => {
    const { loadSettings, generateMissing } = await import("./lib/settings/store");
    await loadSettings();
    await generateMissing();
  });
  await retry("owner claim code not issued", async () => {
    const { issueClaimCode } = await import("./lib/roles");
    await issueClaimCode();
  });
}

/** Runs once when the server starts: prints the owner claim code when the site has no owner yet (see src/lib/roles.ts). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { issueClaimCode } = await import("./lib/roles");
    await issueClaimCode();
  } catch (e) {
    // the database may not be migrated yet; /admin/claim explains how to get a code
    console.warn("owner claim code not issued:", e instanceof Error ? e.message : e);
  }
}

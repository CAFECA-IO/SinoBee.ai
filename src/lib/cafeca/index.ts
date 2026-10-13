import { config } from "@/lib/config";
import { createCafecaVerifier } from "./verify";

const g = globalThis as unknown as { __cafeca?: ReturnType<typeof createCafecaVerifier> };

/** Server-side CAFECA verifier (reads <wallet>/.well-known/cafeca-configuration once). */
export const cafeca = (g.__cafeca ??= createCafecaVerifier({ wallet: config.cafecaWallet, rpcUrl: config.cafecaRpcUrl }));

export { newNonce } from "./verify";
export type { SignInResponse, VerifiedSignIn } from "./verify";

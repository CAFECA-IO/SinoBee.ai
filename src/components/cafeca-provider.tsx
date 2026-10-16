"use client";

import Script from "next/script";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/* Minimal typings for the CAFECA browser SDK (<wallet>/sdk/cafeca-connect.js) */
type Description = { title: string; detail?: string };
type TransportOpts = { transport: "popup" | "relay"; onPending?: (p: { link: string }) => void };
export type CafecaChannel = {
  id: string;
  sendCalls: (calls: { to: string; data: string; value?: string }[], d: Description, o?: TransportOpts) => Promise<{ txHash: string; success: boolean }>;
  signMessage: (m: string, d: Description, o?: TransportOpts) => Promise<{ signature: string }>;
};
type SignInOpts = { nonce: string | (() => Promise<string>); claims?: string[]; statement?: string; channel?: boolean | { ttl: number } };
type CafecaClient = {
  signIn: (o: SignInOpts) => Promise<unknown>;
  redirect: (o: SignInOpts & { redirectUri?: string }) => Promise<void>;
  authLink: (o: SignInOpts & { mode: "post"; responseUri: string }) => Promise<string>;
  channel: (response: unknown) => Promise<CafecaChannel | null>;
  restoreChannel: (id: string) => Promise<CafecaChannel | null>;
};
declare global {
  interface Window {
    CafecaConnect?: {
      create: (o: { wallet: string }) => CafecaClient;
      handleRedirect: () => { response?: unknown; error?: unknown } | null;
    };
  }
}

export type Me = { id: string; account: string; handle: string | null; publisher: string | null; isAdmin: boolean; role?: "USER" | "ADMIN" | "SUPERADMIN"; channelId: string | null } | null;


type Ctx = {
  ready: boolean;
  me: Me;
  channel: CafecaChannel | null;
  transport: "popup" | "relay";
  setTransport: (t: "popup" | "relay") => void;
  pendingLink: string | null;
  login: (mode: "popup" | "redirect") => Promise<void>;
  startQr: () => Promise<{ link: string; stop: () => void }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const C = createContext<Ctx | null>(null);
export const useCafeca = () => {
  const c = useContext(C);
  if (!c) throw new Error("CafecaProvider missing");
  return c;
};

const CLAIMS = ["handle", "kyc_level"];
const CHANNEL_TTL = 30 * 24 * 3600;

const getNonce = () =>
  fetch("/api/auth/nonce", { method: "POST" })
    .then((r) => r.json())
    .then((j) => j.nonce as string);



export function CafecaProvider({ wallet, statement, children }: { wallet: string; statement: string; children: ReactNode }) {
  const [sdk, setSdk] = useState<CafecaClient | null>(null);
  const [me, setMe] = useState<Me>(null);
  const [ready, setReady] = useState(false);
  const [channel, setChannel] = useState<CafecaChannel | null>(null);
  const [transport, setTransport] = useState<"popup" | "relay">("popup");
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  const handled = useRef(false);

  const refresh = useCallback(async () => {
    const m = (await fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json())) as Me;
    setMe(m);
    return void m;
  }, []);

  const finishLogin = useCallback(
    async (client: CafecaClient, response: unknown) => {
      const r = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(response) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "login failed");
      setChannel(await client.channel(response).catch(() => null));
      await refresh();
    },
    [refresh],
  );

  const onSdk = useCallback(async () => {
    if (!window.CafecaConnect || handled.current) return;
    handled.current = true;
    const client = window.CafecaConnect.create({ wallet });
    setSdk(client);
    const back = window.CafecaConnect.handleRedirect();
    if (back?.response) await finishLogin(client, back.response).catch((e) => console.error(e));
    const m = (await fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json())) as Me;
    setMe(m);
    if (m?.channelId) setChannel(await client.restoreChannel(m.channelId).catch(() => null));
    setReady(true);
  }, [wallet, finishLogin]);

  useEffect(() => {
    // SDK may already be on the page (client navigation)
    if (window.CafecaConnect) onSdk();
    else refresh().finally(() => setReady(true));
  }, [onSdk, refresh]);

  const login = useCallback(
    async (mode: "popup" | "redirect") => {
      if (!sdk) throw new Error("CAFECA SDK not loaded");
      const opts = { nonce: getNonce, claims: CLAIMS, statement, channel: { ttl: CHANNEL_TTL } };
      if (mode === "redirect") return sdk.redirect(opts);
      const response = await sdk.signIn(opts);
      await finishLogin(sdk, response);
    },
    [sdk, statement, finishLogin],
  );

  const startQr = useCallback(async () => {
    if (!sdk) throw new Error("CAFECA SDK not loaded");
    const nonce = await getNonce();
    const link = await sdk.authLink({ nonce, mode: "post", responseUri: "/api/auth/callback", claims: CLAIMS, statement, channel: { ttl: CHANNEL_TTL } });
    let stopped = false;
    const timer = setInterval(async () => {
      if (stopped) return;
      const j = await fetch(`/api/auth/poll?nonce=${encodeURIComponent(nonce)}`).then((r) => r.json());
      if (j.pending) return;
      clearInterval(timer);
      stopped = true;
      if (j.response) {
        setChannel(await sdk.channel(j.response).catch(() => null));
        setTransport("relay"); // signed in from the phone: send signing requests there too
      }
      await refresh();
    }, 1500);
    setTimeout(() => clearInterval(timer), 10 * 60_000);
    return { link, stop: () => ((stopped = true), clearInterval(timer)) };
  }, [sdk, statement, refresh]);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setChannel(null);
    setMe(null);
  }, []);


  return (
    <C.Provider value={{ ready, me, channel, transport, setTransport, pendingLink, login, startQr, logout, refresh }}>
      <Script src={`${wallet}/sdk/cafeca-connect.js`} strategy="afterInteractive" onLoad={() => void onSdk()} onReady={() => void onSdk()} />
      {children}
    </C.Provider>
  );
}

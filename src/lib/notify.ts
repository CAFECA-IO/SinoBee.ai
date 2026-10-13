import { db } from "./db";
import { config } from "./config";

export type NotifyInput = {
  type: string;
  title: string;
  body: string;
  /** site-relative link, e.g. /tasks/abc */
  link?: string;
  data?: Record<string, unknown>;
};

/**
 * Notify a user: always stored in the on-site inbox (/notifications), and pushed to the user's CAFECA
 * account when CAFECA_NOTIFY_URL is configured.
 *
 * CAFECA delivery contract (POST JSON, Bearer CAFECA_NOTIFY_TOKEN):
 *   { to: "<CAFECA account address>", site: "<origin>", type, title, body, url, data }
 * The Sign in with CAFECA README does not (yet) publish a notification endpoint, so this is a
 * pluggable webhook; point it at CAFECA's notification API or a relay once available.
 */
export async function notify(userId: string, n: NotifyInput) {
  const row = await db.notification.create({
    data: { userId, type: n.type, title: n.title.slice(0, 200), body: n.body.slice(0, 4000), link: n.link ?? null, data: (n.data ?? undefined) as object | undefined },
    include: { user: { select: { account: true } } },
  });
  if (!config.cafecaNotifyUrl) return row;
  try {
    const r = await fetch(config.cafecaNotifyUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.cafecaNotifyToken ? { authorization: `Bearer ${config.cafecaNotifyToken}` } : {}),
      },
      body: JSON.stringify({
        to: row.user.account,
        site: config.origin,
        type: n.type,
        title: n.title,
        body: n.body,
        url: n.link ? config.origin + n.link : config.origin,
        data: n.data ?? {},
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await db.notification.update({ where: { id: row.id }, data: { cafecaDeliveredAt: new Date() } });
  } catch (e) {
    await db.notification.update({ where: { id: row.id }, data: { cafecaError: String(e instanceof Error ? e.message : e).slice(0, 300) } });
  }
  return row;
}

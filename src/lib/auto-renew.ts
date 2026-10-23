import { db } from "./db";
import { config } from "./config";
import { HttpError } from "./errors";
import { notify } from "./notify";
import { cleanBuyer, createPayment, type Buyer } from "./payments";
import { subscriptionState } from "./subscriptions";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Automatic renewal (2026-10-23), off by default. A user turns it on with a saved card; then, while the last paid
 * period runs and nothing is bought after it:
 *   4 days before the end   notice: the plan and amount that will be charged, and when
 *   3, 2, 1 days before     one charge attempt each until one goes through; every failure is told at once with the
 *                           next attempt's time (so every charge is announced beforehand)
 * A confirmed charge adds the next period right after the current one (no gap: the weekly carry-over survives).
 * Users who leave it off get reminders 7 days and 1 day before the end. The site setting
 * subscription.autoRenewEnabled stops every charge at once.
 */

const DAY = 86400_000;
export const NOTICE_DAYS = 4;
/** attempt n (1-based) is due once the period has this many days or fewer left */
export const ATTEMPT_DAYS = [3, 2, 1] as const;

export type AutoRenewView = { on: boolean; cardId: string | null; last4: string | null; nextChargeAt: string | null };

export async function autoRenewState(userId: string, now = new Date()): Promise<AutoRenewView> {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { autoRenew: true, autoRenewCardId: true } });
  const card = u.autoRenewCardId ? await db.savedCard.findUnique({ where: { id: u.autoRenewCardId } }) : null;
  const st = await subscriptionState(userId, now);
  const next = u.autoRenew && st.current && !st.upcoming.length ? new Date(st.current.endsAt.getTime() - ATTEMPT_DAYS[0] * DAY) : null;
  return { on: u.autoRenew, cardId: card?.status === "active" ? card.id : null, last4: card?.last4 ?? null, nextChargeAt: next && next > now ? next.toISOString() : next ? now.toISOString() : null };
}

/** Turn automatic renewal on (with a saved card and the e-invoice buyer) or off */
export async function setAutoRenew(userId: string, on: boolean, opts: { cardId?: string; buyer?: Buyer } = {}) {
  if (!on) {
    await db.user.update({ where: { id: userId }, data: { autoRenew: false } });
    return autoRenewState(userId);
  }
  const { usableCard } = await import("./crowd/cards");
  if (!opts.cardId) throw new HttpError(400, "choose a saved card for automatic renewal");
  const card = await usableCard(userId, opts.cardId);
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { billing: true } });
  const buyer = opts.buyer ? cleanBuyer(opts.buyer) : (u.billing as Buyer | null);
  if (!buyer) throw new HttpError(400, "buyer name and email are required for the e-invoice");
  await db.user.update({ where: { id: userId }, data: { autoRenew: true, autoRenewCardId: card.id, billing: buyer as Prisma.InputJsonValue } });
  return autoRenewState(userId);
}

const day = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ") + " UTC";

/** One pass over the users whose last period ends soon (the worker runs it every 10 minutes) */
export async function renewTick(now = new Date()) {
  const out = { notices: 0, charged: 0, failed: 0, reminders: 0 };
  // the periods that end within NOTICE_DAYS (or 7 days, for reminders) and have nothing bought after them
  const ending = await db.subscription.findMany({
    where: { cancelledAt: null, startsAt: { lte: now }, endsAt: { gt: now, lte: new Date(now.getTime() + 7 * DAY) } },
    include: { user: { select: { id: true, autoRenew: true, autoRenewCardId: true, billing: true, disabledAt: true } } },
  });
  for (const sub of ending) {
    const st = await subscriptionState(sub.userId, now);
    if (st.current?.id !== sub.id || st.upcoming.length || sub.user.disabledAt) continue;
    const left = sub.endsAt.getTime() - now.getTime();
    if (!sub.user.autoRenew) {
      // renew by hand: remind at 7 days and at 1 day
      const due = left <= DAY ? 2 : 1;
      if (sub.endReminders < due && (await db.subscription.updateMany({ where: { id: sub.id, endReminders: { lt: due } }, data: { endReminders: due } })).count) {
        await notify(sub.userId, {
          type: "subscription.ending",
          title: due === 2 ? "訂閱明天到期 Your subscription ends tomorrow" : "訂閱 7 天後到期 Your subscription ends in 7 days",
          body: `訂閱於 ${day(sub.endsAt)} 到期；到期前續訂才能保留每週結轉的額度，也可以開啟自動續訂。Your subscription ends ${day(sub.endsAt)}. Renew before then to keep the weekly carry-over, or turn on automatic renewal.`,
          link: "/account#subscription",
        });
        out.reminders++;
      }
      continue;
    }
    if (!config.subscription.autoRenewEnabled || left > NOTICE_DAYS * DAY) continue;
    const plan = sub.planId ? await db.plan.findUnique({ where: { id: sub.planId } }) : null;
    const fee = plan ? Number(plan.feeTwd) : 0;
    if (!sub.renewNoticeAt) {
      // the notice comes before the first charge
      if (!(await db.subscription.updateMany({ where: { id: sub.id, renewNoticeAt: null }, data: { renewNoticeAt: now } })).count) continue;
      const ok = !!plan?.active && fee > 0;
      await notify(sub.userId, {
        type: ok ? "subscription.renew.notice" : "subscription.renew.unavailable",
        title: ok ? `即將自動續訂 Automatic renewal coming: ${plan!.name}` : "無法自動續訂 Automatic renewal not possible",
        body: ok
          ? `將於 ${day(new Date(sub.endsAt.getTime() - ATTEMPT_DAYS[0] * DAY))} 起以儲存的卡片扣款 NT$${fee}，續訂 ${plan!.days} 天；可隨時在帳號頁關閉。NT$${fee} will be charged to your saved card from ${day(new Date(sub.endsAt.getTime() - ATTEMPT_DAYS[0] * DAY))} for ${plan!.days} more days; turn it off any time on your account page.`
          : `方案已停售，訂閱將於 ${day(sub.endsAt)} 到期，請改選其他方案。The plan is no longer offered; your subscription ends ${day(sub.endsAt)}. Please choose another plan.`,
        link: "/account#subscription",
      });
      out.notices++;
      continue;
    }
    if (!plan?.active || !(fee > 0)) continue;
    const due = ATTEMPT_DAYS.filter((d) => left <= d * DAY).length; // 0 … 3
    if (due === 0 || sub.renewAttempts >= due) continue;
    // claim the attempt first so two workers never charge twice
    if (!(await db.subscription.updateMany({ where: { id: sub.id, renewAttempts: { lt: due } }, data: { renewAttempts: due } })).count) continue;
    try {
      if (!sub.user.autoRenewCardId) throw new HttpError(400, "no card chosen for automatic renewal");
      const pay = await createPayment({
        userId: sub.userId, purpose: "SUBSCRIPTION", amountTwd: fee, planId: plan.id, buyer: sub.user.billing as Buyer, cardId: sub.user.autoRenewCardId,
        meta: { autoRenew: true, after: sub.endsAt.toISOString() },
      });
      if (pay.status === "CONFIRMED") out.charged++; // the period and its notice come from the payment's grant
    } catch (e) {
      out.failed++;
      const next = due < ATTEMPT_DAYS.length ? new Date(sub.endsAt.getTime() - ATTEMPT_DAYS.at(due)! * DAY) : null;
      await notify(sub.userId, {
        type: "subscription.renew.failed",
        title: "自動續訂扣款失敗 Automatic renewal charge failed",
        body:
          `扣款未成功（${(e as Error).message.slice(0, 200)}）。` +
          (next ? `將於 ${day(next)} 再試一次；也可以先換一張卡。` : `訂閱將於 ${day(sub.endsAt)} 到期，請手動續訂以保留每週結轉的額度。`) +
          ` The charge did not go through. ` +
          (next ? `We will try again at ${day(next)}; you can switch cards before then.` : `Your subscription ends ${day(sub.endsAt)}; renew by hand to keep the weekly carry-over.`),
        link: "/account#subscription",
      });
    }
  }
  return out;
}

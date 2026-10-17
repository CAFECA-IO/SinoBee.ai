"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * Themed replacement for window.confirm: `if (!(await confirmDialog(t("…")))) return;`
 * <ConfirmHost /> (in the locale layout) renders the dialog; Esc or a click outside cancels, Enter confirms.
 */
export type ConfirmOptions = { title?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean };
type Request = ConfirmOptions & { message: string; resolve: (ok: boolean) => void };

let show: ((r: Request) => void) | null = null;

export function confirmDialog(message: string, opts: ConfirmOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    if (!show) return resolve(typeof window !== "undefined" && window.confirm(message));
    show({ ...opts, message, resolve });
  });
}

export function ConfirmHost() {
  const t = useTranslations("confirmDialog");
  const [req, setReq] = useState<Request | null>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const back = useRef<HTMLElement | null>(null);

  useEffect(() => {
    show = (r) =>
      setReq((cur) => {
        cur?.resolve(false); // a newer question replaces an unanswered one
        back.current = document.activeElement as HTMLElement | null;
        return r;
      });
    return () => {
      show = null;
    };
  }, []);

  const close = useCallback(
    (ok: boolean) => {
      req?.resolve(ok);
      setReq(null);
      back.current?.focus?.();
    },
    [req],
  );

  useEffect(() => {
    if (!req) return;
    // a destructive action starts on Cancel, anything else on Confirm
    (req.danger ? cancelRef : okRef).current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(false);
      } else if (e.key === "Tab") {
        // keep focus on the two buttons
        e.preventDefault();
        (document.activeElement === okRef.current ? cancelRef : okRef).current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [req, close]);

  if (!req) return null;
  return (
    <div className="dialog-backdrop fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-4 backdrop-blur-[2px] sm:items-center" onMouseDown={() => close(false)}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        className="dialog-panel card w-full max-w-md space-y-4 p-6 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className={`grid h-10 w-10 flex-none place-items-center rounded-full ${req.danger ? "bg-err-soft text-err" : "bg-accent-soft text-accent"}`} aria-hidden>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {req.danger ? <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /> : <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" />}
            </svg>
          </span>
          <div className="min-w-0 flex-1 space-y-1.5">
            <h2 id="confirm-title" className="text-lg font-semibold">{req.title ?? t("title")}</h2>
            <p id="confirm-message" className="whitespace-pre-line text-sm text-muted">{req.message}</p>
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button ref={cancelRef} type="button" className="btn-ghost justify-center !py-2" onClick={() => close(false)}>{req.cancelLabel ?? t("cancel")}</button>
          <button ref={okRef} type="button" className={`${req.danger ? "btn-danger" : "btn-primary"} justify-center !py-2`} onClick={() => close(true)}>{req.confirmLabel ?? t("ok")}</button>
        </div>
      </div>
    </div>
  );
}

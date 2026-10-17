"use client";

import { useEffect } from "react";

/**
 * Site-wide click feedback and double-click protection (mounted once in the layout).
 *  - every button / button-styled link gets a short "pressed" ring animation (CSS .pressed in globals.css)
 *  - a second click on the same button within LOCK_MS is swallowed before React sees it, so one click = one action
 *  - a form cannot be submitted again within FORM_LOCK_MS (Enter key included)
 * Selection controls (switches, radios, tabs, menus, toggles) animate but are never locked.
 * Opt out with data-repeat on the element or an ancestor.
 */
const PRESSABLE = "button, [role=button], input[type=submit], a.btn, a.btn-primary, a.btn-ghost, a.btn-danger, a.icon-btn";
const NO_LOCK = "[role=switch], [role=radio], [role=tab], [role=option], [role=menuitemradio], [aria-expanded], [aria-pressed], [data-repeat]";
const LOCK_MS = 700;
const FORM_LOCK_MS = 1200;

export function ClickGuard() {
  useEffect(() => {
    const until = new WeakMap<Element, number>();
    const timers = new WeakMap<Element, number>();

    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.(PRESSABLE);
      if (!el || (el as HTMLButtonElement).disabled) return;
      const now = performance.now();
      if (!el.closest(NO_LOCK)) {
        if ((until.get(el) ?? 0) > now) {
          e.preventDefault();
          e.stopImmediatePropagation();
          return;
        }
        until.set(el, now + LOCK_MS);
      }
      // restart the press animation
      el.classList.remove("pressed");
      void (el as HTMLElement).offsetWidth;
      el.classList.add("pressed");
      window.clearTimeout(timers.get(el));
      timers.set(el, window.setTimeout(() => el.classList.remove("pressed"), 450));
    };

    const onSubmit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement;
      if (form.closest("[data-repeat]")) return;
      const now = performance.now();
      if ((until.get(form) ?? 0) > now) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      until.set(form, now + FORM_LOCK_MS);
    };

    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, []);
  return null;
}

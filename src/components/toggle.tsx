"use client";

import { useId, useState, type ReactNode } from "react";

type Props = {
  /** controlled value */
  checked?: boolean;
  /** uncontrolled initial value */
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  /** when set, the value is submitted with the surrounding <form> (only while on) */
  name?: string;
  value?: string;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
};

/** Accessible on/off switch (role="switch") with a smoothly sliding knob. */
export function Toggle({ checked, defaultChecked = false, onChange, name, value = "1", label, description, disabled, className = "" }: Props) {
  const [inner, setInner] = useState(defaultChecked);
  const on = checked ?? inner;
  const id = useId();
  const flip = () => {
    if (disabled) return;
    if (checked === undefined) setInner(!on);
    onChange?.(!on);
  };
  return (
    <div className={`flex gap-3 ${description ? "items-start" : "items-center"} ${className}`}>
      <button
        type="button"
        role="switch"
        id={id}
        aria-checked={on}
        aria-describedby={description ? `${id}-d` : undefined}
        disabled={disabled}
        onClick={flip}
        className={`relative ${description ? "mt-0.5" : ""} inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-300 ease-out motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 ${
          on ? "border-accent bg-accent" : "border-line bg-panel-2"
        }`}
      >
        <span
          aria-hidden
          className={`pointer-events-none inline-block h-[18px] w-[18px] rounded-full shadow-sm ring-1 ring-black/5 transition-transform duration-300 ease-[cubic-bezier(.34,1.4,.64,1)] motion-reduce:transition-none ${
            on ? "translate-x-[22px] bg-accent-ink" : "translate-x-[2px] bg-muted"
          }`}
        />
      </button>
      {name && on && <input type="hidden" name={name} value={value} />}
      {(label || description) && (
        <label htmlFor={id} className="cursor-pointer select-none text-sm">
          {label && <span className="font-medium">{label}</span>}
          {description && (
            <span id={`${id}-d`} className="block text-muted">
              {description}
            </span>
          )}
        </label>
      )}
    </div>
  );
}

"use client";

import clsx from "clsx";

type SwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
};

export function Switch({ checked, onChange, label, description, disabled }: SwitchProps) {
  return (
    <label className={clsx("flex items-start justify-between gap-4 py-3", disabled && "opacity-60")}>
      <span>
        <span className="block text-sm font-medium text-ink-800">{label}</span>
        {description ? <span className="mt-0.5 block text-sm text-ink-500">{description}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          "relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-brand-600" : "bg-ink-200",
        )}
      >
        <span
          aria-hidden="true"
          className={clsx(
            "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-[22px]" : "translate-x-0.5",
          )}
        />
      </button>
    </label>
  );
}

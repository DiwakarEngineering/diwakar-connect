import { forwardRef, type ButtonHTMLAttributes } from "react";
import clsx from "clsx";
import { Spinner } from "./spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
type Size = "sm" | "md" | "lg" | "icon" | "icon-sm";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-card disabled:bg-brand-300",
  secondary: "bg-white text-ink-800 border border-line hover:bg-canvas hover:border-ink-200 shadow-card",
  ghost: "text-ink-700 hover:bg-ink-100",
  subtle: "bg-brand-50 text-brand-700 hover:bg-brand-100",
  danger: "bg-danger-600 text-white hover:bg-danger-700 shadow-card",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-11 px-5 text-base gap-2",
  icon: "h-10 w-10",
  "icon-sm": "h-8 w-8",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, disabled, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(
        "inline-flex shrink-0 items-center justify-center rounded-lg font-medium transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-60",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner className="h-4 w-4" label="" /> : null}
      {children}
    </button>
  );
});

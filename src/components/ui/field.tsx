import {
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import clsx from "clsx";

const control =
  "block w-full rounded-lg border border-line bg-white text-sm text-ink-900 placeholder:text-ink-400 shadow-[inset_0_1px_0_rgba(0,0,0,0.02)] transition-colors hover:border-ink-200 disabled:bg-canvas disabled:text-ink-500 aria-[invalid=true]:border-danger-600";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={clsx(control, "h-10 px-3", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={clsx(control, "px-3 py-2", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={clsx(control, "h-10 pl-3 pr-8", className)} {...rest}>
      {children}
    </select>
  );
});

type ControlProps = { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean };

type FieldProps = {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
  /**
   * A single control (it receives id / aria-describedby / aria-invalid), or a
   * render function when the control is wrapped in other markup.
   */
  children: ReactElement<Partial<ControlProps>> | ((props: ControlProps) => ReactNode);
  optional?: boolean;
};

export function Field({ label, hint, error, className, children, optional }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={clsx("space-y-1.5", className)}>
      <label htmlFor={id} className="flex items-baseline justify-between text-sm font-medium text-ink-800">
        <span>{label}</span>
        {optional ? <span className="text-xs font-normal text-ink-400">Optional</span> : null}
      </label>
      {typeof children === "function"
        ? children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })
        : isValidElement(children)
          ? cloneElement(children, { id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })
          : children}
      {hint ? (
        <p id={hintId} className="text-xs text-ink-500">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs font-medium text-danger-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function FormError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-lg border border-danger-600/20 bg-danger-50 px-3 py-2 text-sm text-danger-700">
      {message}
    </div>
  );
}

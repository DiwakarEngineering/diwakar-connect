"use client";

import { Field, Input } from "@/components/ui/field";
import { newPassword } from "@/lib/validation";

export type PasswordErrors = { password?: string; confirm?: string };

export function validateNewPassword(password: string, confirm: string): PasswordErrors {
  const errors: PasswordErrors = {};
  const parsed = newPassword.safeParse(password);
  if (!parsed.success) errors.password = parsed.error.issues[0]?.message;
  if (password !== confirm) errors.confirm = "Passwords don't match";
  return errors;
}

export function NewPasswordFields({
  password,
  confirm,
  onPassword,
  onConfirm,
  errors,
}: {
  password: string;
  confirm: string;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
  errors: PasswordErrors;
}) {
  return (
    <>
      <Field label="New password" hint="At least 10 characters, with a letter and a number." error={errors.password}>
        <Input type="password" autoComplete="new-password" value={password} onChange={(e) => onPassword(e.target.value)} />
      </Field>
      <Field label="Confirm password" error={errors.confirm}>
        <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => onConfirm(e.target.value)} />
      </Field>
    </>
  );
}

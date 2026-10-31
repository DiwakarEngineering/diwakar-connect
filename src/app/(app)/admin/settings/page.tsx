"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { Enums, Tables } from "@/lib/database.types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { domainList } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/components/providers/session-provider";

type Settings = Tables<"organization_settings">;

export default function AdminSettingsPage() {
  const { session, refreshSettings } = useSession();
  const { push } = useToast();
  const supabase = getSupabaseBrowserClient();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [domains, setDomains] = useState("");
  const [editWindow, setEditWindow] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void supabase
      .from("organization_settings")
      .select("*")
      .eq("id", true)
      .single()
      .then(({ data, error: loadError }) => {
        if (loadError || !data) {
          setError(friendlyError(loadError, "Couldn't load settings."));
          return;
        }
        setSettings(data);
        setDomains(data.allowed_email_domains.join(", "));
        setEditWindow(data.message_edit_window_minutes === null ? "" : String(data.message_edit_window_minutes));
      });
  }, [supabase]);

  if (!settings) return error ? <FormError message={error} /> : <LoadingState label="Loading settings" />;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!settings) return;
    const e: Record<string, string> = {};
    const parsedDomains = domainList.safeParse(domains);
    if (!parsedDomains.success) e.domains = parsedDomains.error.issues[0]?.message ?? "Invalid domains";
    let window: number | null = null;
    if (editWindow.trim()) {
      window = Number(editWindow);
      if (!Number.isInteger(window) || window < 1 || window > 10080) e.editWindow = "Enter whole minutes between 1 and 10080, or leave empty";
    }
    if (!settings.organization_name.trim()) e.name = "Organization name is required";
    if (settings.max_attachment_mb < 1 || settings.max_attachment_mb > 50) e.maxMb = "Between 1 and 50 MB";
    setErrors(e);
    if (Object.keys(e).length > 0 || !parsedDomains.success) return;

    // Guard against locking out existing staff with a too-narrow allowlist.
    const ownDomain = session.email.split("@")[1]?.toLowerCase();
    if (parsedDomains.data.length > 0 && ownDomain && !parsedDomains.data.includes(ownDomain)) {
      setErrors({ domains: `Include your own domain (@${ownDomain}), or leave the list empty.` });
      return;
    }

    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase
      .from("organization_settings")
      .update({
        organization_name: settings.organization_name.trim(),
        allowed_email_domains: parsedDomains.data,
        team_creation: settings.team_creation,
        directory_show_email: settings.directory_show_email,
        directory_show_phone: settings.directory_show_phone,
        directory_show_work_location: settings.directory_show_work_location,
        message_edit_window_minutes: window,
        allow_message_delete: settings.allow_message_delete,
        max_attachment_mb: settings.max_attachment_mb,
        calls_enabled: settings.calls_enabled,
        updated_by: session.userId,
      })
      .eq("id", true);
    setSaving(false);
    if (saveError) return setError(friendlyError(saveError));
    await refreshSettings();
    push({ tone: "success", title: "Organization settings saved", description: "The change is recorded in the audit log." });
  }

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings({ ...settings, [key]: value });

  return (
    <form onSubmit={save} noValidate className="space-y-6">
      <FormError message={error} />
      <section className="rounded-2xl border border-line bg-white p-5 shadow-card">
        <h2 className="text-base font-semibold text-ink-900">Organization & access</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Organization name" error={errors.name}>
            <Input value={settings.organization_name} maxLength={120} onChange={(e) => set("organization_name", e.target.value)} />
          </Field>
          <Field
            label="Allowed email domains"
            error={errors.domains}
            hint="Comma-separated, e.g. diwakarsolar.com. Empty allows any domain. Enforced in the database when accounts are created."
          >
            <Input value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="diwakarsolar.com" />
          </Field>
          <Field label="Who can create teams">
            <Select value={settings.team_creation} onChange={(e) => set("team_creation", e.target.value as Enums<"team_creation_policy">)}>
              <option value="admins">Owners and admins only</option>
              <option value="managers">Managers, admins and owners</option>
              <option value="everyone">Every employee</option>
            </Select>
          </Field>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-white p-5 shadow-card">
        <h2 className="text-base font-semibold text-ink-900">Directory visibility</h2>
        <p className="mt-1 text-sm text-ink-500">Names, titles, departments and availability are always visible to employees. Admins always see everything.</p>
        <div className="mt-2 divide-y divide-line">
          <Switch label="Show email addresses" checked={settings.directory_show_email} onChange={(v) => set("directory_show_email", v)} />
          <Switch label="Show phone numbers" checked={settings.directory_show_phone} onChange={(v) => set("directory_show_phone", v)} />
          <Switch label="Show work locations" checked={settings.directory_show_work_location} onChange={(v) => set("directory_show_work_location", v)} />
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-white p-5 shadow-card">
        <h2 className="text-base font-semibold text-ink-900">Messaging & calls</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Edit window (minutes)" error={errors.editWindow} hint="How long people can edit their messages. Empty = no limit.">
            <Input inputMode="numeric" value={editWindow} onChange={(e) => setEditWindow(e.target.value)} placeholder="No limit" />
          </Field>
          <Field label="Maximum attachment size (MB)" error={errors.maxMb} hint="The storage bucket also caps files at 50 MB.">
            <Input
              type="number"
              min={1}
              max={50}
              value={settings.max_attachment_mb}
              onChange={(e) => set("max_attachment_mb", Number(e.target.value))}
            />
          </Field>
        </div>
        <div className="mt-2 divide-y divide-line">
          <Switch
            label="Allow people to delete their own messages"
            description="Admins can always remove messages for moderation; removals are audited."
            checked={settings.allow_message_delete}
            onChange={(v) => set("allow_message_delete", v)}
          />
          <Switch
            label="Enable audio and video calls"
            description="Requires a configured call provider on the server."
            checked={settings.calls_enabled}
            onChange={(v) => set("calls_enabled", v)}
          />
        </div>
      </section>

      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={saving}>
          Save settings
        </Button>
      </div>
    </form>
  );
}

"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import clsx from "clsx";
import { Camera, Check, ShieldCheck, Trash2 } from "lucide-react";
import type { Enums, Tables, TablesUpdate } from "@/lib/database.types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { ALLOWED_AVATAR_TYPES, AVAILABILITY, MAX_AVATAR_BYTES, ROLE_LABEL } from "@/lib/constants";
import { displayName as displayNameSchema } from "@/lib/validation";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { NewPasswordFields, validateNewPassword, type PasswordErrors } from "@/components/auth/new-password-fields";
import { useSession } from "@/components/providers/session-provider";
import { usePeople } from "@/components/providers/people-provider";
import { BROWSER_NOTIFICATIONS_KEY } from "@/components/providers/activity-provider";
import { useSetAvailability } from "@/components/shell/profile-panel";
import { StatusMessageDialog } from "@/components/shell/status-message-dialog";

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6 rounded-2xl border border-line bg-white p-5 shadow-card md:p-6">
      <h2 id={`${id}-title`} className="text-base font-semibold text-ink-900">
        {title}
      </h2>
      {description ? <p className="mt-1 text-sm text-ink-500">{description}</p> : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function ProfileSection() {
  const { session, setProfile } = useSession();
  const { upsert } = usePeople();
  const { push } = useToast();
  const supabase = getSupabaseBrowserClient();
  const [name, setName] = useState(session.profile.display_name);
  const [details, setDetails] = useState<Pick<Tables<"profile_details">, "phone" | "work_location"> | null>(null);
  const [department, setDepartment] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void supabase
      .from("profile_details")
      .select("phone, work_location")
      .eq("user_id", session.userId)
      .maybeSingle()
      .then(({ data }) => setDetails(data ?? { phone: null, work_location: null }));
    if (session.profile.department_id) {
      void supabase
        .from("departments")
        .select("name")
        .eq("id", session.profile.department_id)
        .maybeSingle()
        .then(({ data }) => setDepartment(data?.name ?? null));
    }
  }, [session.profile.department_id, session.userId, supabase]);

  function applyProfile(p: Tables<"profiles">) {
    setProfile(p);
    upsert(p);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const parsed = displayNameSchema.safeParse(name);
    if (!parsed.success) {
      setNameError(parsed.error.issues[0]?.message ?? "Invalid name");
      return;
    }
    const phone = details?.phone?.trim() || null;
    if (phone && !/^[0-9+()\- ]{3,30}$/.test(phone)) {
      setError("Phone numbers can contain digits, spaces, +, - and brackets.");
      return;
    }
    setNameError(null);
    setError(null);
    setSaving(true);
    const [profileRes, detailsRes] = await Promise.all([
      supabase.from("profiles").update({ display_name: parsed.data }).eq("id", session.userId).select("*").single(),
      supabase
        .from("profile_details")
        .update({ phone, work_location: details?.work_location?.trim() || null })
        .eq("user_id", session.userId),
    ]);
    setSaving(false);
    if (profileRes.error || detailsRes.error) {
      setError(friendlyError(profileRes.error ?? detailsRes.error));
      return;
    }
    if (profileRes.data) applyProfile(profileRes.data);
    push({ tone: "success", title: "Profile saved" });
  }

  async function uploadAvatar(file: File) {
    if (!(ALLOWED_AVATAR_TYPES as readonly string[]).includes(file.type)) {
      push({ tone: "error", title: "Use a JPG, PNG or WebP image" });
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      push({ tone: "error", title: "Images must be smaller than 2 MB" });
      return;
    }
    setUploading(true);
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `${session.userId}/avatar-${Date.now()}.${ext}`;
    const previous = session.profile.avatar_path;
    const { error: uploadError } = await supabase.storage.from("avatars").upload(path, file, { contentType: file.type });
    if (uploadError) {
      setUploading(false);
      push({ tone: "error", title: "Upload failed", description: friendlyError(uploadError) });
      return;
    }
    const { data, error: updateError } = await supabase
      .from("profiles")
      .update({ avatar_path: path })
      .eq("id", session.userId)
      .select("*")
      .single();
    setUploading(false);
    if (updateError || !data) {
      await supabase.storage.from("avatars").remove([path]);
      push({ tone: "error", title: "Couldn't update your photo", description: friendlyError(updateError) });
      return;
    }
    applyProfile(data);
    if (previous) void supabase.storage.from("avatars").remove([previous]);
    push({ tone: "success", title: "Photo updated" });
  }

  async function removeAvatar() {
    const previous = session.profile.avatar_path;
    if (!previous) return;
    const { data, error: updateError } = await supabase
      .from("profiles")
      .update({ avatar_path: null })
      .eq("id", session.userId)
      .select("*")
      .single();
    if (updateError || !data) {
      push({ tone: "error", title: "Couldn't remove your photo", description: friendlyError(updateError) });
      return;
    }
    applyProfile(data);
    void supabase.storage.from("avatars").remove([previous]);
  }

  return (
    <Section id="profile" title="Profile" description="How you appear to colleagues.">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={session.profile.display_name} path={session.profile.avatar_path} userId={session.userId} size="xl" />
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept={ALLOWED_AVATAR_TYPES.join(",")}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadAvatar(f);
              e.target.value = "";
            }}
          />
          <Button size="sm" loading={uploading} onClick={() => fileRef.current?.click()}>
            <Camera className="h-4 w-4" aria-hidden="true" />
            Change photo
          </Button>
          {session.profile.avatar_path ? (
            <Button size="sm" variant="ghost" onClick={() => void removeAvatar()}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Remove
            </Button>
          ) : null}
        </div>
      </div>

      {details === null ? (
        <LoadingState />
      ) : (
        <form onSubmit={save} className="mt-6 grid gap-4 md:grid-cols-2" noValidate>
          <div className="md:col-span-2">
            <FormError message={error} />
          </div>
          <Field label="Display name" error={nameError}>
            <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </Field>
          <Field label="Email" hint="Managed by your sign-in account.">
            <Input value={session.email} readOnly disabled />
          </Field>
          <Field label="Job title" hint="Set by an administrator.">
            <Input value={session.profile.title ?? "Not set"} readOnly disabled />
          </Field>
          <Field label="Department" hint="Set by an administrator.">
            <Input value={department ?? "Not set"} readOnly disabled />
          </Field>
          <Field label="Phone" optional hint="Visible to colleagues only if your organization allows it.">
            <Input
              type="tel"
              autoComplete="tel"
              value={details.phone ?? ""}
              onChange={(e) => setDetails({ ...details, phone: e.target.value })}
              maxLength={30}
            />
          </Field>
          <Field label="Work location" optional hint="e.g. Jaipur office, Bhojusar site">
            <Input value={details.work_location ?? ""} onChange={(e) => setDetails({ ...details, work_location: e.target.value })} maxLength={120} />
          </Field>
          <div className="flex items-center justify-between md:col-span-2">
            <span className="text-xs text-ink-500">Organization role: {ROLE_LABEL[session.role]}</span>
            <Button type="submit" variant="primary" loading={saving}>
              Save profile
            </Button>
          </div>
        </form>
      )}
    </Section>
  );
}

function AvailabilitySection() {
  const { session } = useSession();
  const setAvailability = useSetAvailability();
  const [statusOpen, setStatusOpen] = useState(false);
  return (
    <Section id="status" title="Availability & status">
      <div role="radiogroup" aria-label="Availability" className="grid gap-2 sm:grid-cols-2">
        {(Object.keys(AVAILABILITY) as Enums<"availability">[]).map((value) => {
          const meta = AVAILABILITY[value];
          const selected = session.profile.availability === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => void setAvailability(value)}
              className={clsx(
                "flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left",
                selected ? "border-brand-300 bg-brand-50" : "border-line hover:bg-canvas",
              )}
            >
              <span className={clsx("h-3 w-3 rounded-full", meta.dot)} aria-hidden="true" />
              <span className="flex-1">
                <span className="block text-sm font-medium text-ink-900">{meta.label}</span>
                <span className="block text-xs text-ink-500">{meta.description}</span>
              </span>
              {selected ? <Check className="h-4 w-4 text-brand-600" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-canvas px-4 py-3">
        <span className="min-w-0 truncate text-sm text-ink-700">
          {session.profile.status_message ? `“${session.profile.status_message}”` : "No status message"}
        </span>
        <Button size="sm" onClick={() => setStatusOpen(true)}>
          {session.profile.status_message ? "Change" : "Set message"}
        </Button>
      </div>
      <StatusMessageDialog open={statusOpen} onClose={() => setStatusOpen(false)} />
    </Section>
  );
}

function NotificationsSection() {
  const { session } = useSession();
  const { push } = useToast();
  const supabase = getSupabaseBrowserClient();
  const [prefs, setPrefs] = useState<Tables<"notification_preferences"> | null>(null);
  const [browser, setBrowser] = useState<"unsupported" | "denied" | "off" | "on">("off");

  useEffect(() => {
    void supabase
      .from("notification_preferences")
      .select("*")
      .eq("user_id", session.userId)
      .maybeSingle()
      .then(({ data }) => setPrefs(data));
    if (typeof Notification === "undefined") setBrowser("unsupported");
    else if (Notification.permission === "denied") setBrowser("denied");
    else {
      try {
        setBrowser(Notification.permission === "granted" && localStorage.getItem(BROWSER_NOTIFICATIONS_KEY) === "on" ? "on" : "off");
      } catch {
        setBrowser("off");
      }
    }
  }, [session.userId, supabase]);

  async function toggle(key: "mentions" | "replies" | "team_invites" | "calls", value: boolean) {
    if (!prefs) return;
    const previous = prefs;
    setPrefs({ ...prefs, [key]: value });
    const patch: TablesUpdate<"notification_preferences"> = { [key]: value };
    const { error } = await supabase.from("notification_preferences").update(patch).eq("user_id", session.userId);
    if (error) {
      setPrefs(previous);
      push({ tone: "error", title: "Couldn't save preference", description: friendlyError(error) });
    }
  }

  async function toggleBrowser(on: boolean) {
    if (!on) {
      try {
        localStorage.setItem(BROWSER_NOTIFICATIONS_KEY, "off");
      } catch {
        /* storage unavailable */
      }
      setBrowser("off");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setBrowser(permission === "denied" ? "denied" : "off");
      return;
    }
    try {
      localStorage.setItem(BROWSER_NOTIFICATIONS_KEY, "on");
    } catch {
      /* storage unavailable */
    }
    setBrowser("on");
  }

  return (
    <Section id="notifications" title="Notifications" description="Choose what creates a notification. Unread message counts always appear in Chat and Teams.">
      {prefs === null ? (
        <LoadingState />
      ) : (
        <div className="divide-y divide-line">
          <Switch label="Mentions" description="When someone @mentions you." checked={prefs.mentions} onChange={(v) => void toggle("mentions", v)} />
          <Switch label="Replies" description="When someone replies to your message." checked={prefs.replies} onChange={(v) => void toggle("replies", v)} />
          <Switch label="Team invitations" description="When you're added to a team." checked={prefs.team_invites} onChange={(v) => void toggle("team_invites", v)} />
          <Switch label="Calls" description="When a call starts in one of your chats." checked={prefs.calls} onChange={(v) => void toggle("calls", v)} />
          <Switch
            label="Desktop alerts"
            description={
              browser === "unsupported"
                ? "This browser doesn't support notifications."
                : browser === "denied"
                  ? "Blocked in your browser settings. Allow notifications for this site to turn this on."
                  : "Show a system alert while Diwakar Connect is open in a background tab."
            }
            checked={browser === "on"}
            disabled={browser === "unsupported" || browser === "denied"}
            onChange={(v) => void toggleBrowser(v)}
          />
        </div>
      )}
    </Section>
  );
}

function SecuritySection() {
  const { session, signOut } = useSession();
  const { push } = useToast();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<PasswordErrors & { current?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [signingOutOthers, setSigningOutOthers] = useState(false);

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    const v: PasswordErrors & { current?: string } = validateNewPassword(password, confirm);
    if (!current) v.current = "Enter your current password";
    setErrors(v);
    setError(null);
    if (Object.keys(v).length > 0) return;
    setSaving(true);
    const supabase = getSupabaseBrowserClient();
    // Re-verify the current password before allowing a change.
    const verify = await supabase.auth.signInWithPassword({ email: session.email, password: current });
    if (verify.error) {
      setSaving(false);
      setErrors({ current: "Current password is incorrect" });
      return;
    }
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (updateError) {
      setError(friendlyError(updateError, "Couldn't change your password."));
      return;
    }
    setCurrent("");
    setPassword("");
    setConfirm("");
    push({ tone: "success", title: "Password changed" });
  }

  return (
    <Section id="security" title="Account security">
      <ul className="mb-6 space-y-2 rounded-xl bg-canvas p-4 text-sm text-ink-700">
        <li className="flex gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
          Use a unique password you don&apos;t use anywhere else. A password manager helps.
        </li>
        <li className="flex gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
          Diwakar Solar will never ask for your password by chat, email or phone.
        </li>
        <li className="flex gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
          Sign out on shared or site computers when you&apos;re done.
        </li>
      </ul>
      <form onSubmit={changePassword} noValidate className="grid gap-4 md:max-w-md">
        <FormError message={error} />
        <Field label="Current password" error={errors.current}>
          <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <NewPasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} errors={errors} />
        <div>
          <Button type="submit" variant="primary" loading={saving}>
            Change password
          </Button>
        </div>
      </form>
      <div className="mt-6 flex flex-wrap gap-2 border-t border-line pt-5">
        <Button
          loading={signingOutOthers}
          onClick={async () => {
            setSigningOutOthers(true);
            const { error: e } = await getSupabaseBrowserClient().auth.signOut({ scope: "others" });
            setSigningOutOthers(false);
            push(e ? { tone: "error", title: "Couldn't sign out other devices" } : { tone: "success", title: "Other devices signed out" });
          }}
        >
          Sign out other devices
        </Button>
        <Button variant="danger" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </Section>
  );
}

export default function SettingsPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 md:px-8">
        <h1 className="hidden text-xl font-semibold text-ink-900 md:block">Profile & settings</h1>
        <ProfileSection />
        <AvailabilitySection />
        <NotificationsSection />
        <SecuritySection />
      </div>
    </div>
  );
}

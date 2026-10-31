"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, Pencil, Plus, Trash2 } from "lucide-react";
import type { Tables } from "@/lib/database.types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";

type Department = Tables<"departments">;

export default function AdminDepartmentsPage() {
  const supabase = getSupabaseBrowserClient();
  const { push } = useToast();
  const [rows, setRows] = useState<Department[] | null>(null);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Department | "new" | null>(null);
  const [form, setForm] = useState({ name: "", description: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Department | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data, error: loadError }, { data: people }] = await Promise.all([
      supabase.from("departments").select("*").order("name"),
      supabase.from("profiles").select("department_id").not("department_id", "is", null),
    ]);
    if (loadError) return setError(friendlyError(loadError));
    const c = new Map<string, number>();
    for (const p of people ?? []) if (p.department_id) c.set(p.department_id, (c.get(p.department_id) ?? 0) + 1);
    setCounts(c);
    setError(null);
    setRows(data ?? []);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  function openEditor(d: Department | "new") {
    setEditing(d);
    setForm(d === "new" ? { name: "", description: "" } : { name: d.name, description: d.description ?? "" });
    setFormError(null);
  }

  async function save() {
    const name = form.name.trim();
    if (!name) return setFormError("Name is required");
    setBusy(true);
    const values = { name, description: form.description.trim() || null };
    const { error: saveError } =
      editing === "new"
        ? await supabase.from("departments").insert(values)
        : await supabase.from("departments").update(values).eq("id", (editing as Department).id);
    setBusy(false);
    if (saveError) return setFormError(saveError.code === "23505" ? "A department with that name already exists." : friendlyError(saveError));
    push({ tone: "success", title: editing === "new" ? "Department added" : "Department updated" });
    setEditing(null);
    void load();
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    const { error: deleteError } = await supabase.from("departments").delete().eq("id", deleting.id);
    setBusy(false);
    if (deleteError) return push({ tone: "error", title: "Couldn't delete department", description: friendlyError(deleteError) });
    push({ tone: "success", title: "Department deleted" });
    setDeleting(null);
    void load();
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-500">Departments appear in the directory and can be used to filter people.</p>
        <Button variant="primary" onClick={() => openEditor("new")}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add department
        </Button>
      </div>
      <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-white shadow-card">
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : rows === null ? (
          <SkeletonRows rows={4} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<Building2 className="h-5 w-5" aria-hidden="true" />} title="No departments yet" description="Add departments such as O&M / Service, Projects & Installation, or Accounts & Finance." />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-ink-900">{d.name}</div>
                  <div className="truncate text-xs text-ink-500">
                    {counts.get(d.id) ?? 0} people{d.description ? ` · ${d.description}` : ""}
                  </div>
                </div>
                <Button size="icon-sm" variant="ghost" onClick={() => openEditor(d)} aria-label={`Edit ${d.name}`}>
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button size="icon-sm" variant="ghost" onClick={() => setDeleting(d)} aria-label={`Delete ${d.name}`}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        busy={busy}
        title={editing === "new" ? "Add department" : "Edit department"}
        size="sm"
        footer={
          <>
            <Button onClick={() => setEditing(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void save()}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormError message={formError} />
          <Field label="Name">
            <Input value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Description" optional>
            <Textarea rows={2} maxLength={300} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
        </div>
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        busy={busy}
        title={`Delete ${deleting?.name ?? "department"}?`}
        description={`${counts.get(deleting?.id ?? "") ?? 0} people will no longer have a department. This is recorded in the audit log.`}
        confirmLabel="Delete"
        onConfirm={() => void remove()}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

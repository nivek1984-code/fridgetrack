import { useState } from "react";
import { api, type Member } from "../api";
import { useMe } from "../auth";
import { Badge, ErrorBox, Loading, Modal } from "../components/ui";
import { WEEKDAYS, titleCase } from "../format";
import { useHousehold, useStockMutation } from "../hooks";

const ACTIVITY = ["SEDENTARY", "LIGHT", "MODERATE", "ACTIVE", "VERY_ACTIVE"];
const DIETS = ["OMNIVORE", "VEGETARIAN", "VEGAN", "PESCATARIAN"];

export function Family() {
  const me = useMe();
  const household = useHousehold();
  const [editing, setEditing] = useState<Member | null>(null);
  const [copied, setCopied] = useState(false);
  const save = useStockMutation((v: { groceryDayPreference?: number; runThresholdDays?: number }) => api("/household", { method: "PATCH", body: v }));

  if (household.isLoading) return <Loading />;
  if (household.error) return <ErrorBox error={household.error} />;
  const h = household.data!;
  const isAdmin = me.role === "ADMIN";
  const year = new Date().getFullYear();

  return (
    <div className="space-y-4">
      <h1 className="h1">{h.name}</h1>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card space-y-3 lg:col-span-2">
          <h2 className="h2">Family members</h2>
          <ul className="divide-y divide-stone-100 dark:divide-stone-800">
            {h.users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <div className="flex items-center gap-2 font-medium">{u.name} {u.id === me.id && <Badge tone="green">you</Badge>} {u.role === "ADMIN" && <Badge tone="blue">admin</Badge>}</div>
                  <div className="muted text-xs">
                    {[u.birthYear && `${year - u.birthYear} yrs`, u.activityLevel && titleCase(u.activityLevel), u.dietType !== "OMNIVORE" && titleCase(u.dietType), u.allergies && `allergic to ${u.allergies}`].filter(Boolean).join(" · ") || "No profile details yet"}
                  </div>
                  {u.dietaryGoals && <div className="mt-0.5 text-xs text-stone-600 dark:text-stone-300">🎯 {u.dietaryGoals}</div>}
                </div>
                {(u.id === me.id || isAdmin) && <button className="btn-outline" onClick={() => setEditing(u)}>Edit profile</button>}
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-4">
          <div className="card">
            <h2 className="h2 mb-1">Invite family</h2>
            <p className="muted mb-3">Share this code — they choose “Join with code” when signing up.</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-lg bg-stone-100 px-3 py-2 text-center font-mono text-lg tracking-widest dark:bg-stone-800">{h.inviteCode}</code>
              <button className="btn-outline" onClick={() => { navigator.clipboard?.writeText(h.inviteCode); setCopied(true); }}>{copied ? "Copied" : "Copy"}</button>
            </div>
          </div>
          <div className="card space-y-3">
            <h2 className="h2">Grocery runs</h2>
            <div>
              <label className="label" htmlFor="gd">Usual shopping day</label>
              <select id="gd" className="input" value={h.groceryDayPreference} disabled={!isAdmin || save.isPending} onChange={(e) => save.mutate({ groceryDayPreference: Number(e.target.value) })}>
                {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="rt">Safety buffer (days before something runs out)</label>
              <select id="rt" className="input" value={h.runThresholdDays} disabled={!isAdmin || save.isPending} onChange={(e) => save.mutate({ runThresholdDays: Number(e.target.value) })}>
                {[0, 1, 2, 3].map((d) => <option key={d} value={d}>{d === 0 ? "None" : `${d} day${d > 1 ? "s" : ""}`}</option>)}
              </select>
            </div>
            {!isAdmin && <p className="muted text-xs">Only admins can change these.</p>}
            <ErrorBox error={save.error} />
          </div>
        </div>
      </div>
      {editing && <ProfileModal member={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ProfileModal({ member, onClose }: { member: Member; onClose: () => void }) {
  const [f, setF] = useState({
    name: member.name, birthYear: member.birthYear ?? "", sex: member.sex ?? "", heightCm: member.heightCm ?? "", weightKg: member.weightKg ?? "",
    activityLevel: member.activityLevel ?? "", dietType: member.dietType, dietaryGoals: member.dietaryGoals ?? "", allergies: member.allergies ?? "",
  });
  const num = (v: number | string) => (v === "" ? null : Number(v));
  const save = useStockMutation(() => api(`/users/${member.id}`, {
    method: "PATCH",
    body: {
      name: f.name, birthYear: num(f.birthYear), sex: f.sex || null, heightCm: num(f.heightCm), weightKg: num(f.weightKg),
      activityLevel: f.activityLevel || null, dietType: f.dietType, dietaryGoals: f.dietaryGoals || null, allergies: f.allergies || null,
    },
  }), onClose);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <Modal open onClose={onClose} title={`${member.name}'s profile`}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
        <p className="muted text-xs">Used to estimate daily needs and tailor health advice. Only your household can see it.</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><label className="label" htmlFor="pn">Name</label><input id="pn" className="input" value={f.name} onChange={set("name")} required /></div>
          <div><label className="label" htmlFor="by">Birth year</label><input id="by" className="input" type="number" min={1900} max={2100} value={f.birthYear} onChange={set("birthYear")} /></div>
          <div><label className="label" htmlFor="sx">Sex</label><select id="sx" className="input" value={f.sex} onChange={set("sex")}><option value="">Prefer not to say</option><option value="F">Female</option><option value="M">Male</option><option value="X">Other</option></select></div>
          <div><label className="label" htmlFor="hc">Height (cm)</label><input id="hc" className="input" type="number" value={f.heightCm} onChange={set("heightCm")} /></div>
          <div><label className="label" htmlFor="wk">Weight (kg)</label><input id="wk" className="input" type="number" step="0.1" value={f.weightKg} onChange={set("weightKg")} /></div>
          <div><label className="label" htmlFor="al">Activity</label><select id="al" className="input" value={f.activityLevel} onChange={set("activityLevel")}><option value="">—</option>{ACTIVITY.map((a) => <option key={a} value={a}>{titleCase(a)}</option>)}</select></div>
          <div><label className="label" htmlFor="dt">Diet</label><select id="dt" className="input" value={f.dietType} onChange={set("dietType")}>{DIETS.map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}</select></div>
          <div className="col-span-2"><label className="label" htmlFor="ag">Allergies (comma separated)</label><input id="ag" className="input" placeholder="e.g. nuts, shellfish" value={f.allergies} onChange={set("allergies")} /></div>
          <div className="col-span-2"><label className="label" htmlFor="gl">Goals</label><input id="gl" className="input" placeholder="e.g. more energy for training" value={f.dietaryGoals} onChange={set("dietaryGoals")} /></div>
        </div>
        <ErrorBox error={save.error} />
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={save.isPending}>Save</button></div>
      </form>
    </Modal>
  );
}

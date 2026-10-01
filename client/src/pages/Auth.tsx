import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { ErrorBox } from "../components/ui";

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-4xl" aria-hidden>🥦</div>
          <h1 className="h1 mt-2">FridgeTrack</h1>
          <p className="muted">{title}</p>
        </div>
        <div className="card">{children}</div>
      </div>
    </div>
  );
}

export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await login(email, password); } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <Shell title="Your family's fridge, meals and habits">
      <form onSubmit={submit} className="space-y-3">
        <div><label className="label" htmlFor="email">Email</label><input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <div><label className="label" htmlFor="pw">Password</label><input id="pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
        <ErrorBox error={error} />
        <button className="btn-primary w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      <p className="muted mt-4 text-center">New here? <Link className="font-medium text-emerald-600" to="/register">Create an account</Link></p>
      <div className="mt-4 rounded-lg bg-stone-100 p-3 text-xs text-stone-600 dark:bg-stone-800 dark:text-stone-300">
        <div className="mb-1 font-medium">Demo family (password <code>demo1234</code>)</div>
        <div className="flex flex-wrap gap-1">
          {["alex", "sam", "jordan", "mia"].map((n) => (
            <button key={n} type="button" className="rounded bg-white px-2 py-1 font-mono hover:bg-emerald-50 dark:bg-stone-900" onClick={() => { setEmail(`${n}@demo.family`); setPassword("demo1234"); }}>{n}@demo.family</button>
          ))}
        </div>
      </div>
    </Shell>
  );
}

export function Register() {
  const { register } = useAuth();
  const [mode, setMode] = useState<"create" | "join">("create");
  const [f, setF] = useState({ name: "", email: "", password: "", householdName: "", inviteCode: "" });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await register({ name: f.name, email: f.email, password: f.password, ...(mode === "create" ? { householdName: f.householdName } : { inviteCode: f.inviteCode }) });
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <Shell title="Create your account">
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-stone-100 p-1 text-sm dark:bg-stone-800">
        {(["create", "join"] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} className={`rounded-md py-1.5 font-medium ${mode === m ? "bg-white shadow-sm dark:bg-stone-900" : "text-stone-500"}`}>
            {m === "create" ? "New household" : "Join with code"}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="space-y-3">
        <div><label className="label" htmlFor="name">Your name</label><input id="name" className="input" value={f.name} onChange={set("name")} required /></div>
        <div><label className="label" htmlFor="email">Email</label><input id="email" className="input" type="email" value={f.email} onChange={set("email")} required /></div>
        <div><label className="label" htmlFor="pw">Password (8+ characters)</label><input id="pw" className="input" type="password" minLength={8} value={f.password} onChange={set("password")} required /></div>
        {mode === "create"
          ? <div><label className="label" htmlFor="hh">Household name</label><input id="hh" className="input" placeholder="e.g. The Smiths" value={f.householdName} onChange={set("householdName")} required /></div>
          : <div><label className="label" htmlFor="code">Invite code</label><input id="code" className="input uppercase" placeholder="Ask a family member (Family page)" value={f.inviteCode} onChange={set("inviteCode")} required /></div>}
        <ErrorBox error={error} />
        <button className="btn-primary w-full" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
      </form>
      <p className="muted mt-4 text-center">Already have an account? <Link className="font-medium text-emerald-600" to="/">Sign in</Link></p>
    </Shell>
  );
}

import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth";

const NAV = [
  { to: "/", label: "Home", icon: "🏠", end: true },
  { to: "/fridge", label: "Fridge", icon: "🧊" },
  { to: "/meals", label: "Meals", icon: "🍽️" },
  { to: "/log", label: "My log", icon: "📝" },
  { to: "/shopping", label: "Shopping", icon: "🛒" },
  { to: "/health", label: "Health", icon: "💚" },
  { to: "/family", label: "Family", icon: "👪" },
];

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${isActive ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"}`;

export function Layout() {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-screen md:flex">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-stone-200 bg-white p-4 md:flex dark:border-stone-800 dark:bg-stone-900">
        <div className="mb-6 flex items-center gap-2 px-2 text-lg font-semibold"><span aria-hidden>🥦</span> FridgeTrack</div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.end} className={linkClass}><span aria-hidden>{n.icon}</span>{n.label}</NavLink>)}
        </nav>
        <div className="border-t border-stone-200 pt-3 dark:border-stone-800">
          <div className="px-2 text-sm font-medium">{user?.name}</div>
          <div className="muted px-2 text-xs">{user?.email}</div>
          <button className="btn-ghost mt-2 w-full justify-start" onClick={logout}>Log out</button>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-stone-200 bg-white/90 px-4 py-3 backdrop-blur md:hidden dark:border-stone-800 dark:bg-stone-900/90">
        <div className="flex items-center gap-2 font-semibold"><span aria-hidden>🥦</span> FridgeTrack</div>
        <button className="btn-ghost px-2 text-xs" onClick={logout}>Log out {user?.name}</button>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 pb-24 md:px-8 md:pb-8">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-7 border-t border-stone-200 bg-white md:hidden dark:border-stone-800 dark:bg-stone-900">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}
            className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2 text-[10px] ${isActive ? "text-emerald-600 dark:text-emerald-400" : "text-stone-500"}`}>
            <span className="text-lg leading-none" aria-hidden>{n.icon}</span>{n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

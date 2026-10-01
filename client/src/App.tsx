import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import { Dashboard } from "./pages/Dashboard";
import { Family } from "./pages/Family";
import { Fridge } from "./pages/Fridge";
import { Health } from "./pages/Health";
import { ItemPage } from "./pages/ItemPage";
import { Login, Register } from "./pages/Auth";
import { Meals } from "./pages/Meals";
import { MyLog } from "./pages/MyLog";
import { Shopping } from "./pages/Shopping";

export function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="grid min-h-screen place-items-center"><Spinner /></div>;

  if (!user) {
    return (
      <Routes>
        <Route path="/register" element={<Register />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="fridge" element={<Fridge />} />
        <Route path="items/:id" element={<ItemPage />} />
        <Route path="meals" element={<Meals />} />
        <Route path="log" element={<MyLog />} />
        <Route path="shopping" element={<Shopping />} />
        <Route path="health" element={<Health />} />
        <Route path="health/:userId" element={<Health />} />
        <Route path="family" element={<Family />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

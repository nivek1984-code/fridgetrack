import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";
import { api, ApiError, type User } from "./api";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (body: { name: string; email: string; password: string; householdName?: string; inviteCode?: string }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api<User>("/auth/me");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: Infinity,
  });

  // Drop the previous user's cached data, but keep the ["me"] query itself so its observer stays attached.
  const resetCache = (u: User | null) => {
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
    qc.setQueryData(["me"], u);
  };

  const value: AuthState = {
    user: data ?? null,
    loading: isLoading,
    login: async (email, password) => resetCache(await api<User>("/auth/login", { body: { email, password } })),
    register: async (body) => resetCache(await api<User>("/auth/register", { body })),
    logout: async () => {
      await api("/auth/logout", { method: "POST" });
      resetCache(null);
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/** The signed-in user; only use inside protected routes. */
export function useMe() {
  return useAuth().user!;
}

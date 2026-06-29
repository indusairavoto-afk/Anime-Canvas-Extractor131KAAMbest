import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { apiUrl } from "@/lib/api";

export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  email: string;
  bio: string | null;
  avatarUrl: string;
  emailVerified: boolean;
  createdAt: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (emailOrUsername: string, password: string) => Promise<{ error?: string }>;
  register: (displayName: string, username: string, email: string, password: string) => Promise<{ error?: string; backupCode?: string }>;
  loginWithUser: (user: AuthUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = "na_auth_user";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { setLoading(false); return; }
    let cached: AuthUser | null = null;
    try { cached = JSON.parse(raw); } catch {}
    if (cached) setUser(cached);
    // Verify stored session is still valid with server
    fetch(apiUrl(`/api/auth/me?id=${cached?.id ?? ""}`))
      .then(r => r.ok ? r.json() : null)
      .then((data: AuthUser | null) => {
        if (cancelled) return;
        if (data) {
          setUser(data);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } else {
          setUser(null);
          localStorage.removeItem(STORAGE_KEY);
        }
      })
      .catch(() => { /* keep cached user on network error */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (emailOrUsername: string, password: string) => {
    try {
      const res = await fetch(apiUrl("/api/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailOrUsername, password }),
      });
      const data = await res.json();
      if (!res.ok) return { error: data.error || "Login failed" };
      setUser(data);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return {};
    } catch {
      return { error: "Network error" };
    }
  }, []);

  const register = useCallback(async (displayName: string, username: string, email: string, password: string) => {
    try {
      const res = await fetch(apiUrl("/api/auth/register"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, username, email, password }),
      });
      const data = await res.json();
      if (!res.ok) return { error: data.error || "Registration failed" };
      const { backupCode, ...userData } = data;
      setUser(userData);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(userData));
      return { backupCode };
    } catch {
      return { error: "Network error" };
    }
  }, []);

  const loginWithUser = useCallback((u: AuthUser) => {
    setUser(u);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, loginWithUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

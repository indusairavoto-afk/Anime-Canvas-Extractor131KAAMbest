import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { motion } from "framer-motion";
import { Eye, EyeOff, CheckCircle2, XCircle } from "lucide-react";
import { apiUrl } from "@/lib/api";

export default function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>();
  const [, navigate] = useLocation();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }
    if (password !== confirm) { setError("Passwords don't match"); return; }
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/auth/reset-password"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Reset failed"); return; }
      setDone(true);
      setTimeout(() => navigate("/login"), 2500);
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[calc(100vh-56px)] bg-black flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <span className="font-serif text-3xl tracking-tight text-white uppercase leading-none">
            N<span className="text-white/40">A</span>
          </span>
          <p className="text-white/40 text-sm mt-2 font-mono uppercase tracking-widest">Reset Password</p>
        </div>

        {done ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center gap-4 py-8"
          >
            <CheckCircle2 className="w-12 h-12 text-green-400" />
            <p className="text-white font-medium">Password updated!</p>
            <p className="text-white/40 text-sm">Redirecting to sign in…</p>
          </motion.div>
        ) : (
          <motion.form
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            onSubmit={handleSubmit}
            className="space-y-4"
          >
            <div className="bg-zinc-900/60 border border-white/[0.06] rounded-xl px-4 py-3 mb-2">
              <p className="text-[11px] font-mono text-white/30 uppercase tracking-widest mb-1">Reset token</p>
              <p className="text-white/50 text-xs font-mono break-all">{token}</p>
            </div>

            <div>
              <label className="block text-xs text-white/40 mb-1.5 uppercase tracking-widest font-mono">New Password</label>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Min. 6 characters"
                  required
                  minLength={6}
                  className="w-full bg-zinc-900 border border-white/10 text-white text-sm px-4 py-3 rounded-xl placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors pr-11"
                />
                <button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs text-white/40 mb-1.5 uppercase tracking-widest font-mono">Confirm Password</label>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Repeat password"
                  required
                  className="w-full bg-zinc-900 border border-white/10 text-white text-sm px-4 py-3 rounded-xl placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors pr-11"
                />
                {confirm && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2">
                    {confirm === password
                      ? <CheckCircle2 className="w-4 h-4 text-green-400" />
                      : <XCircle className="w-4 h-4 text-red-400" />}
                  </span>
                )}
              </div>
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-white text-black font-semibold py-3 rounded-xl text-sm hover:bg-white/90 transition-colors disabled:opacity-50"
            >
              {loading ? "Updating…" : "Set New Password"}
            </button>
          </motion.form>
        )}
      </div>
    </div>
  );
}

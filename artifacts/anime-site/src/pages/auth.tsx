import { useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";

export default function AuthPage() {
  const [tab, setTab] = useState<"login" | "register">("login");
  const [, navigate] = useLocation();
  const { login, register } = useAuth();

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [showLoginPw, setShowLoginPw] = useState(false);

  const [regDisplay, setRegDisplay] = useState("");
  const [regUsername, setRegUsername] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regError, setRegError] = useState("");
  const [regLoading, setRegLoading] = useState(false);
  const [showRegPw, setShowRegPw] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError("");
    setLoginLoading(true);
    const { error } = await login(loginEmail.trim(), loginPassword);
    setLoginLoading(false);
    if (error) { setLoginError(error); return; }
    navigate("/");
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setRegError("");
    setRegLoading(true);
    const { error } = await register(regDisplay.trim(), regUsername.trim(), regEmail.trim(), regPassword);
    setRegLoading(false);
    if (error) { setRegError(error); return; }
    navigate(`/u/${regUsername.trim().toLowerCase().replace(/[^a-z0-9_]/g, "")}`);
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <span className="font-serif text-3xl tracking-tight text-white uppercase leading-none">
            N<span className="text-white/40">A</span>
          </span>
        </div>

        {/* Tab switcher */}
        <div className="flex bg-zinc-900 rounded-xl p-1 mb-6">
          {(["login", "register"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all capitalize ${
                tab === t ? "bg-white text-black" : "text-white/40 hover:text-white/70"
              }`}
            >
              {t === "login" ? "Sign In" : "Create Account"}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {tab === "login" ? (
            <motion.form
              key="login"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              onSubmit={handleLogin}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs text-white/40 mb-1.5 uppercase tracking-widest font-mono">Email or Username</label>
                <input
                  type="text"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="w-full bg-zinc-900 border border-white/10 text-white text-sm px-4 py-3 rounded-xl placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs text-white/40 mb-1.5 uppercase tracking-widest font-mono">Password</label>
                <div className="relative">
                  <input
                    type={showLoginPw ? "text" : "password"}
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="w-full bg-zinc-900 border border-white/10 text-white text-sm px-4 py-3 rounded-xl placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors pr-11"
                  />
                  <button type="button" onClick={() => setShowLoginPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors">
                    {showLoginPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {loginError && <p className="text-red-400 text-sm">{loginError}</p>}
              <button
                type="submit"
                disabled={loginLoading}
                className="w-full bg-white text-black font-semibold py-3 rounded-xl text-sm hover:bg-white/90 transition-colors disabled:opacity-50"
              >
                {loginLoading ? "Signing in..." : "Sign In"}
              </button>
              <p className="text-center text-sm text-white/30">
                No account?{" "}
                <button type="button" onClick={() => setTab("register")} className="text-white/70 hover:text-white transition-colors underline">
                  Create one
                </button>
              </p>
            </motion.form>
          ) : (
            <motion.form
              key="register"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              onSubmit={handleRegister}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs text-white/40 mb-1.5 uppercase tracking-widest font-mono">Display Name</label>
                <input
                  type="text"
                  value={regDisplay}
                  onChange={(e) => setRegDisplay(e.target.value)}
                  placeholder="Anime Fan"
                  required
                  className="w-full bg-zinc-900 border border-white/10 text-white text-sm px-4 py-3 rounded-xl placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs text-white/40 mb-1.5 uppercase tracking-widest font-mono">Username</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 text-sm select-none">@</span>
                  <input
                    type="text"
                    value={regUsername}
                    onChange={(e) => setRegUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase())}
                    placeholder="yourhandle"
                    required
                    className="w-full bg-zinc-900 border border-white/10 text-white text-sm pl-8 pr-4 py-3 rounded-xl placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-white/40 mb-1.5 uppercase tracking-widest font-mono">Email</label>
                <input
                  type="email"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="w-full bg-zinc-900 border border-white/10 text-white text-sm px-4 py-3 rounded-xl placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs text-white/40 mb-1.5 uppercase tracking-widest font-mono">Password</label>
                <div className="relative">
                  <input
                    type={showRegPw ? "text" : "password"}
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="Min. 6 characters"
                    required
                    minLength={6}
                    className="w-full bg-zinc-900 border border-white/10 text-white text-sm px-4 py-3 rounded-xl placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors pr-11"
                  />
                  <button type="button" onClick={() => setShowRegPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors">
                    {showRegPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {regError && <p className="text-red-400 text-sm">{regError}</p>}
              <button
                type="submit"
                disabled={regLoading}
                className="w-full bg-white text-black font-semibold py-3 rounded-xl text-sm hover:bg-white/90 transition-colors disabled:opacity-50"
              >
                {regLoading ? "Creating account..." : "Create Account"}
              </button>
              <p className="text-center text-sm text-white/30">
                Already have an account?{" "}
                <button type="button" onClick={() => setTab("login")} className="text-white/70 hover:text-white transition-colors underline">
                  Sign in
                </button>
              </p>
            </motion.form>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

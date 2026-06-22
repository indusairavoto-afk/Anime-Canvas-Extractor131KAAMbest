import { useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Eye, EyeOff, Copy, Check, ArrowLeft } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { apiUrl } from "@/lib/api";

export default function AuthPage() {
  const [tab, setTab] = useState<"login" | "register">("login");
  const [, navigate] = useLocation();
  const { login, register } = useAuth();

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [showLoginPw, setShowLoginPw] = useState(false);

  const [forgotStep, setForgotStep] = useState<"idle" | "form" | "done">("idle");
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [copied, setCopied] = useState(false);

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setForgotError("");
    setForgotLoading(true);
    try {
      const res = await fetch(apiUrl("/api/auth/forgot-password"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setForgotError(data.error ?? "Request failed"); return; }
      setResetToken(data.token);
      setForgotStep("done");
    } catch {
      setForgotError("Network error — please try again");
    } finally {
      setForgotLoading(false);
    }
  }

  function copyLink() {
    const url = `${window.location.origin}/reset/${resetToken}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

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
          {tab === "login" && forgotStep === "idle" ? (
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
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs text-white/40 uppercase tracking-widest font-mono">Password</label>
                  <button
                    type="button"
                    onClick={() => { setForgotStep("form"); setForgotEmail(""); setForgotError(""); }}
                    className="text-[11px] text-white/30 hover:text-white/60 transition-colors font-mono"
                  >
                    Forgot password?
                  </button>
                </div>
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
          ) : tab === "login" && forgotStep === "form" ? (
            <motion.form
              key="forgot-form"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              onSubmit={handleForgot}
              className="space-y-4"
            >
              <button
                type="button"
                onClick={() => setForgotStep("idle")}
                className="flex items-center gap-1.5 text-xs text-white/30 hover:text-white/60 transition-colors font-mono uppercase tracking-widest mb-2"
              >
                <ArrowLeft className="w-3 h-3" /> Back to sign in
              </button>
              <div>
                <label className="block text-xs text-white/40 mb-1.5 uppercase tracking-widest font-mono">Account Email</label>
                <input
                  type="email"
                  value={forgotEmail}
                  onChange={e => setForgotEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoFocus
                  className="w-full bg-zinc-900 border border-white/10 text-white text-sm px-4 py-3 rounded-xl placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors"
                />
              </div>
              {forgotError && <p className="text-red-400 text-sm">{forgotError}</p>}
              <button
                type="submit"
                disabled={forgotLoading}
                className="w-full bg-white text-black font-semibold py-3 rounded-xl text-sm hover:bg-white/90 transition-colors disabled:opacity-50"
              >
                {forgotLoading ? "Generating…" : "Generate Reset Link"}
              </button>
            </motion.form>
          ) : tab === "login" && forgotStep === "done" ? (
            <motion.div
              key="forgot-done"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="space-y-4"
            >
              <button
                type="button"
                onClick={() => setForgotStep("idle")}
                className="flex items-center gap-1.5 text-xs text-white/30 hover:text-white/60 transition-colors font-mono uppercase tracking-widest"
              >
                <ArrowLeft className="w-3 h-3" /> Back to sign in
              </button>
              <div className="bg-zinc-900/60 border border-white/[0.08] rounded-xl p-4 space-y-3">
                <p className="text-xs text-white/40 font-mono uppercase tracking-widest">Your reset passcode</p>
                <p className="font-mono text-white/80 text-sm break-all leading-relaxed tracking-wider border border-white/10 bg-black/40 rounded-lg px-3 py-2">
                  {resetToken}
                </p>
                <p className="text-[11px] text-white/30">This 30-character code is unique to your account. Use it to set a new password — valid for 24 hours.</p>
              </div>
              <button
                type="button"
                onClick={copyLink}
                className="w-full flex items-center justify-center gap-2 border border-white/10 text-white/60 hover:text-white hover:border-white/30 font-medium py-3 rounded-xl text-sm transition-colors"
              >
                {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                {copied ? "Copied!" : "Copy reset link"}
              </button>
              <a
                href={`/reset/${resetToken}`}
                className="block w-full text-center bg-white text-black font-semibold py-3 rounded-xl text-sm hover:bg-white/90 transition-colors"
              >
                Go to reset page →
              </a>
            </motion.div>
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

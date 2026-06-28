import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Eye, EyeOff, Copy, Check, ArrowLeft, AlertCircle, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { apiUrl } from "@/lib/api";
import nexaLogo from "/favicon.png?v=4";

function PasswordStrength({ password }: { password: string }) {
  const strength = useMemo(() => {
    if (!password) return 0;
    let score = 0;
    if (password.length >= 6) score++;
    if (password.length >= 10) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    return score;
  }, [password]);

  if (!password) return null;

  const labels = ["Very weak", "Weak", "Fair", "Good", "Strong"];
  const colors = ["bg-red-500", "bg-orange-500", "bg-yellow-500", "bg-blue-400", "bg-green-500"];
  const textColors = ["text-red-400", "text-orange-400", "text-yellow-400", "text-blue-400", "text-green-400"];

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={`h-0.5 flex-1 rounded-full transition-all duration-300 ${
              i <= strength ? colors[strength - 1] : "bg-white/10"
            }`}
          />
        ))}
      </div>
      <p className={`text-[11px] font-mono ${textColors[strength - 1] ?? "text-white/30"}`}>
        {labels[strength - 1] ?? ""}
      </p>
    </div>
  );
}

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

  const [regDisplay, setRegDisplay] = useState("");
  const [regUsername, setRegUsername] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirm, setRegConfirm] = useState("");
  const [regError, setRegError] = useState("");
  const [regLoading, setRegLoading] = useState(false);
  const [showRegPw, setShowRegPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);

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
    if (regPassword !== regConfirm) {
      setRegError("Passwords do not match");
      return;
    }
    if (regPassword.length < 6) {
      setRegError("Password must be at least 6 characters");
      return;
    }
    setRegLoading(true);
    const { error } = await register(regDisplay.trim(), regUsername.trim(), regEmail.trim(), regPassword);
    setRegLoading(false);
    if (error) { setRegError(error); return; }
    navigate(`/u/${regUsername.trim().toLowerCase().replace(/[^a-z0-9_]/g, "")}`);
  }

  const inputClass =
    "w-full bg-white/5 border border-white/10 text-white text-sm px-4 py-3 rounded-xl placeholder:text-white/20 focus:outline-none focus:border-white/30 focus:bg-white/[0.07] transition-all duration-200";

  return (
    <div className="min-h-screen bg-[#080808] flex items-center justify-center px-4 relative overflow-hidden">
      {/* Ambient background glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-white/[0.02] rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-1/4 w-[300px] h-[300px] bg-indigo-500/5 rounded-full blur-3xl" />
        <div className="absolute top-0 right-1/4 w-[300px] h-[300px] bg-purple-500/5 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-[420px] relative z-10">
        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="text-center mb-8"
        >
          <img src={nexaLogo} alt="Nexa Anime" className="w-12 h-12 mx-auto mb-3 drop-shadow-lg" />
          <h1 className="text-white font-semibold text-lg tracking-wide">Nexa Anime</h1>
          <p className="text-white/30 text-sm mt-1">
            {tab === "login" ? "Welcome back" : "Join the community"}
          </p>
        </motion.div>

        {/* Card */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.08 }}
          className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-6 shadow-2xl backdrop-blur-sm"
        >
          {/* Tab switcher */}
          <div className="flex bg-black/40 rounded-xl p-1 mb-6 border border-white/[0.06]">
            {(["login", "register"] as const).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); setForgotStep("idle"); }}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                  tab === t
                    ? "bg-white text-black shadow-sm"
                    : "text-white/40 hover:text-white/70"
                }`}
              >
                {t === "login" ? "Sign In" : "Create Account"}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            {/* ── LOGIN ── */}
            {tab === "login" && forgotStep === "idle" && (
              <motion.form
                key="login"
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.2 }}
                onSubmit={handleLogin}
                className="space-y-4"
              >
                <div>
                  <label className="block text-[11px] text-white/40 mb-1.5 uppercase tracking-widest font-mono">
                    Email or Username
                  </label>
                  <input
                    type="text"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    autoComplete="username"
                    className={inputClass}
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-[11px] text-white/40 uppercase tracking-widest font-mono">
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => { setForgotStep("form"); setForgotEmail(""); setForgotError(""); }}
                      className="text-[11px] text-white/30 hover:text-white/60 transition-colors"
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
                      autoComplete="current-password"
                      className={`${inputClass} pr-11`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowLoginPw((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                    >
                      {showLoginPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <AnimatePresence>
                  {loginError && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5"
                    >
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      {loginError}
                    </motion.div>
                  )}
                </AnimatePresence>

                <button
                  type="submit"
                  disabled={loginLoading}
                  className="w-full bg-white text-black font-semibold py-3 rounded-xl text-sm hover:bg-white/90 active:scale-[0.99] transition-all duration-150 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loginLoading ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Signing in…</>
                  ) : "Sign In"}
                </button>

                <p className="text-center text-sm text-white/30 pt-1">
                  No account?{" "}
                  <button
                    type="button"
                    onClick={() => setTab("register")}
                    className="text-white/70 hover:text-white transition-colors underline underline-offset-2"
                  >
                    Create one
                  </button>
                </p>
              </motion.form>
            )}

            {/* ── FORGOT FORM ── */}
            {tab === "login" && forgotStep === "form" && (
              <motion.form
                key="forgot-form"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.2 }}
                onSubmit={handleForgot}
                className="space-y-4"
              >
                <button
                  type="button"
                  onClick={() => setForgotStep("idle")}
                  className="flex items-center gap-1.5 text-[11px] text-white/30 hover:text-white/60 transition-colors font-mono uppercase tracking-widest mb-1"
                >
                  <ArrowLeft className="w-3 h-3" /> Back to sign in
                </button>
                <div>
                  <p className="text-white/60 text-sm mb-4">
                    Enter your account email and we'll generate a reset link for you.
                  </p>
                  <label className="block text-[11px] text-white/40 mb-1.5 uppercase tracking-widest font-mono">
                    Account Email
                  </label>
                  <input
                    type="email"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    autoFocus
                    className={inputClass}
                  />
                </div>

                <AnimatePresence>
                  {forgotError && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5"
                    >
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      {forgotError}
                    </motion.div>
                  )}
                </AnimatePresence>

                <button
                  type="submit"
                  disabled={forgotLoading}
                  className="w-full bg-white text-black font-semibold py-3 rounded-xl text-sm hover:bg-white/90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {forgotLoading ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
                  ) : "Generate Reset Link"}
                </button>
              </motion.form>
            )}

            {/* ── FORGOT DONE ── */}
            {tab === "login" && forgotStep === "done" && (
              <motion.div
                key="forgot-done"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.2 }}
                className="space-y-4"
              >
                <button
                  type="button"
                  onClick={() => setForgotStep("idle")}
                  className="flex items-center gap-1.5 text-[11px] text-white/30 hover:text-white/60 transition-colors font-mono uppercase tracking-widest"
                >
                  <ArrowLeft className="w-3 h-3" /> Back to sign in
                </button>

                <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 text-center">
                  <Check className="w-6 h-6 text-green-400 mx-auto mb-2" />
                  <p className="text-green-300 text-sm font-medium">Reset link generated</p>
                </div>

                <div className="bg-black/40 border border-white/[0.08] rounded-xl p-4 space-y-2">
                  <p className="text-[11px] text-white/40 font-mono uppercase tracking-widest">Your reset token</p>
                  <p className="font-mono text-white/70 text-xs break-all leading-relaxed border border-white/10 bg-black/40 rounded-lg px-3 py-2">
                    {resetToken}
                  </p>
                  <p className="text-[11px] text-white/30">Valid for 24 hours. Use it to set a new password.</p>
                </div>

                <button
                  type="button"
                  onClick={copyLink}
                  className="w-full flex items-center justify-center gap-2 border border-white/10 text-white/60 hover:text-white hover:border-white/30 font-medium py-3 rounded-xl text-sm transition-all"
                >
                  {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                  {copied ? "Copied!" : "Copy reset link"}
                </button>
                <a
                  href={`/reset/${resetToken}`}
                  className="block w-full text-center bg-white text-black font-semibold py-3 rounded-xl text-sm hover:bg-white/90 transition-all"
                >
                  Go to reset page →
                </a>
              </motion.div>
            )}

            {/* ── REGISTER ── */}
            {tab === "register" && (
              <motion.form
                key="register"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.2 }}
                onSubmit={handleRegister}
                className="space-y-4"
              >
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-white/40 mb-1.5 uppercase tracking-widest font-mono">
                      Display Name
                    </label>
                    <input
                      type="text"
                      value={regDisplay}
                      onChange={(e) => setRegDisplay(e.target.value)}
                      placeholder="Anime Fan"
                      required
                      autoComplete="name"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-white/40 mb-1.5 uppercase tracking-widest font-mono">
                      Username
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 text-sm select-none">@</span>
                      <input
                        type="text"
                        value={regUsername}
                        onChange={(e) => setRegUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase())}
                        placeholder="handle"
                        required
                        autoComplete="username"
                        className={`${inputClass} pl-7`}
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] text-white/40 mb-1.5 uppercase tracking-widest font-mono">
                    Email
                  </label>
                  <input
                    type="email"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    autoComplete="email"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-white/40 mb-1.5 uppercase tracking-widest font-mono">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      type={showRegPw ? "text" : "password"}
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      placeholder="Min. 6 characters"
                      required
                      minLength={6}
                      autoComplete="new-password"
                      className={`${inputClass} pr-11`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowRegPw((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                    >
                      {showRegPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <PasswordStrength password={regPassword} />
                </div>

                <div>
                  <label className="block text-[11px] text-white/40 mb-1.5 uppercase tracking-widest font-mono">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <input
                      type={showConfirmPw ? "text" : "password"}
                      value={regConfirm}
                      onChange={(e) => setRegConfirm(e.target.value)}
                      placeholder="Repeat password"
                      required
                      autoComplete="new-password"
                      className={`${inputClass} pr-11 ${
                        regConfirm && regConfirm !== regPassword
                          ? "border-red-500/40 focus:border-red-500/60"
                          : regConfirm && regConfirm === regPassword
                          ? "border-green-500/40 focus:border-green-500/60"
                          : ""
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPw((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                    >
                      {showConfirmPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {regConfirm && regConfirm === regPassword && (
                    <p className="text-[11px] text-green-400 mt-1 font-mono flex items-center gap-1">
                      <Check className="w-3 h-3" /> Passwords match
                    </p>
                  )}
                </div>

                <AnimatePresence>
                  {regError && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5"
                    >
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      {regError}
                    </motion.div>
                  )}
                </AnimatePresence>

                <button
                  type="submit"
                  disabled={regLoading}
                  className="w-full bg-white text-black font-semibold py-3 rounded-xl text-sm hover:bg-white/90 active:scale-[0.99] transition-all duration-150 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {regLoading ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Creating account…</>
                  ) : "Create Account"}
                </button>

                <p className="text-center text-sm text-white/30 pt-1">
                  Already have an account?{" "}
                  <button
                    type="button"
                    onClick={() => setTab("login")}
                    className="text-white/70 hover:text-white transition-colors underline underline-offset-2"
                  >
                    Sign in
                  </button>
                </p>
              </motion.form>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Footer */}
        <p className="text-center text-[11px] text-white/20 mt-6">
          By continuing, you agree to Nexa Anime's terms of service
        </p>
      </div>
    </div>
  );
}

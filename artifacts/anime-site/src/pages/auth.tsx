import { useState, useMemo, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Eye, EyeOff, Check, ArrowLeft, AlertCircle, Loader2, Zap, RefreshCw, ShieldAlert } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { apiUrl } from "@/lib/api";
import nexaLogo from "/favicon.png";
import { BackupCodeModal } from "@/components/BackupCodeModal";

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
          <div key={i} className={`h-0.5 flex-1 rounded-full transition-all duration-300 ${i <= strength ? colors[strength - 1] : "bg-white/10"}`} />
        ))}
      </div>
      <p className={`text-[11px] font-mono ${textColors[strength - 1] ?? "text-white/30"}`}>{labels[strength - 1] ?? ""}</p>
    </div>
  );
}

// ── Magic Code Tab ──────────────────────────────────────────────────────────

function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const chars = value.padEnd(8, " ").split("");

  function handleKey(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      e.preventDefault();
      const next = [...chars];
      if (next[i] !== " ") {
        next[i] = " ";
      } else if (i > 0) {
        next[i - 1] = " ";
        refs.current[i - 1]?.focus();
      }
      onChange(next.join("").trimEnd());
    }
  }

  function handleChange(i: number, e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!raw) return;
    const next = [...chars];
    next[i] = raw[0];
    onChange(next.join("").trimEnd());
    if (i < 7) refs.current[i + 1]?.focus();
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    onChange(pasted);
    refs.current[Math.min(pasted.length, 7)]?.focus();
  }

  return (
    <div className="flex gap-2 justify-center">
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="text"
          inputMode="text"
          maxLength={1}
          value={chars[i] === " " ? "" : chars[i]}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKey(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          className={`w-9 h-11 text-center text-sm font-mono font-bold uppercase rounded-lg border transition-all duration-150 bg-black/40 text-white focus:outline-none
            ${chars[i] !== " " ? "border-white/40 bg-white/10" : "border-white/10"}
            focus:border-white/50 focus:bg-white/10`}
        />
      ))}
    </div>
  );
}

function MagicCodePanel({ onSuccess }: { onSuccess: (user: unknown) => void }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [timeLeft, setTimeLeft] = useState(600);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (step !== "code" || !expiresAt) return;
    const id = setInterval(() => {
      const secs = Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 1000));
      setTimeLeft(secs);
      if (secs === 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [step, expiresAt]);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/auth/magic-code/request"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Request failed"); return; }
      setExpiresAt(new Date(data.expiresAt));
      setTimeLeft(600);
      setStep("code");
    } catch {
      setError("Network error — try again");
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    if (code.replace(/ /g, "").length < 8) { setError("Enter all 8 characters"); return; }
    setError("");
    setVerifying(true);
    try {
      const res = await fetch(apiUrl("/api/auth/magic-code/verify"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Invalid code"); return; }
      onSuccess(data);
    } catch {
      setError("Network error — try again");
    } finally {
      setVerifying(false);
    }
  }

  const mins = String(Math.floor(timeLeft / 60)).padStart(2, "0");
  const secs = String(timeLeft % 60).padStart(2, "0");

  return (
    <AnimatePresence mode="wait">
      {step === "email" ? (
        <motion.form key="mc-email" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.2 }} onSubmit={requestCode} className="space-y-4">
          <div className="text-center pb-1">
            <div className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-3">
              <Zap className="w-5 h-5 text-yellow-400" />
            </div>
            <p className="text-white/50 text-sm">No password needed. Enter your email and we'll generate a one-time code.</p>
          </div>
          <div>
            <label className="block text-[11px] text-white/40 mb-1.5 uppercase tracking-widest font-mono">Account Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required autoFocus
              className="w-full bg-white/5 border border-white/10 text-white text-sm px-4 py-3 rounded-xl placeholder:text-white/20 focus:outline-none focus:border-white/30 focus:bg-white/[0.07] transition-all" />
          </div>
          <AnimatePresence>
            {error && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5">
                <AlertCircle className="w-4 h-4 shrink-0" />{error}
              </motion.div>
            )}
          </AnimatePresence>
          <button type="submit" disabled={loading}
            className="w-full bg-white text-black font-semibold py-3 rounded-xl text-sm hover:bg-white/90 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Generating…</> : <><Zap className="w-4 h-4" />Get Login Code</>}
          </button>
        </motion.form>
      ) : (
        <motion.form key="mc-verify" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.2 }} onSubmit={verifyCode} className="space-y-5">
          <button type="button" onClick={() => { setStep("email"); setCode(""); setError(""); }}
            className="flex items-center gap-1.5 text-[11px] text-white/30 hover:text-white/60 transition-colors font-mono uppercase tracking-widest">
            <ArrowLeft className="w-3 h-3" /> Back
          </button>

          {/* Email sent confirmation */}
          <div className="bg-black/60 border border-white/[0.08] rounded-xl p-4 space-y-2 text-center">
            <div className="w-9 h-9 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto mb-2">
              <Check className="w-4 h-4 text-green-400" />
            </div>
            <p className="text-white/80 text-sm font-medium">Check your inbox</p>
            <p className="text-white/40 text-xs leading-relaxed">We sent an 8-character code to <span className="text-white/60 font-mono">{email}</span></p>
            <p className={`text-[11px] font-mono tabular-nums mt-1 ${timeLeft < 60 ? "text-red-400" : "text-white/30"}`}>
              Expires in {mins}:{secs}
            </p>
          </div>

          {/* Code entry */}
          <div className="space-y-2">
            <label className="block text-[11px] text-white/40 mb-3 uppercase tracking-widest font-mono text-center">Enter the code from your email</label>
            <CodeInput value={code} onChange={setCode} />
          </div>

          <AnimatePresence>
            {error && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5">
                <AlertCircle className="w-4 h-4 shrink-0" />{error}
              </motion.div>
            )}
          </AnimatePresence>

          <button type="submit" disabled={verifying || timeLeft === 0 || code.replace(/ /g, "").length < 8}
            className="w-full bg-white text-black font-semibold py-3 rounded-xl text-sm hover:bg-white/90 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
            {verifying ? <><Loader2 className="w-4 h-4 animate-spin" />Verifying…</> : "Sign In with Code"}
          </button>

          {timeLeft === 0 && (
            <button type="button" onClick={() => { setStep("email"); setCode(""); setError(""); }}
              className="w-full flex items-center justify-center gap-2 border border-white/10 text-white/50 hover:text-white hover:border-white/20 py-2.5 rounded-xl text-sm transition-all">
              <RefreshCw className="w-3.5 h-3.5" /> Request new code
            </button>
          )}
        </motion.form>
      )}
    </AnimatePresence>
  );
}

// ── Main Auth Page ──────────────────────────────────────────────────────────

type AuthTab = "login" | "register" | "magic" | "recover";

export default function AuthPage() {
  const [tab, setTab] = useState<AuthTab>("login");
  const [, navigate] = useLocation();
  const { login, register, loginWithUser } = useAuth();

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [showLoginPw, setShowLoginPw] = useState(false);

  const [forgotStep, setForgotStep] = useState<"idle" | "form" | "done">("idle");
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState("");

  const [regDisplay, setRegDisplay] = useState("");
  const [regUsername, setRegUsername] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirm, setRegConfirm] = useState("");
  const [regError, setRegError] = useState("");
  const [regLoading, setRegLoading] = useState(false);
  const [showRegPw, setShowRegPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [backupCode, setBackupCode] = useState<string | null>(null);
  const [pendingNav, setPendingNav] = useState<string | null>(null);

  const [recoverIdentifier, setRecoverIdentifier] = useState("");
  const [recoverCode, setRecoverCode] = useState("");
  const [recoverError, setRecoverError] = useState("");
  const [recoverLoading, setRecoverLoading] = useState(false);
  const [newBackupCode, setNewBackupCode] = useState<string | null>(null);
  const [recoveredUsername, setRecoveredUsername] = useState("");

  async function handleRecover(e: React.FormEvent) {
    e.preventDefault();
    setRecoverError("");
    setRecoverLoading(true);
    try {
      const res = await fetch(apiUrl("/api/auth/recover"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailOrUsername: recoverIdentifier.trim(), backupCode: recoverCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setRecoverError(data.error ?? "Recovery failed"); return; }
      loginWithUser(data);
      setRecoveredUsername(data.username ?? "");
      setNewBackupCode(data.newBackupCode ?? null);
    } catch {
      setRecoverError("Network error — try again");
    } finally {
      setRecoverLoading(false);
    }
  }

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
      setForgotStep("done");
    } catch {
      setForgotError("Network error — please try again");
    } finally {
      setForgotLoading(false);
    }
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
    if (regPassword !== regConfirm) { setRegError("Passwords do not match"); return; }
    if (regPassword.length < 6) { setRegError("Password must be at least 6 characters"); return; }
    setRegLoading(true);
    const { error, backupCode: code } = await register(regDisplay.trim(), regUsername.trim(), regEmail.trim(), regPassword);
    setRegLoading(false);
    if (error) { setRegError(error); return; }
    const dest = `/u/${regUsername.trim().toLowerCase().replace(/[^a-z0-9_]/g, "")}`;
    if (code) {
      setBackupCode(code);
      setPendingNav(dest);
    } else {
      navigate(dest);
    }
  }

  function handleMagicSuccess(user: unknown) {
    loginWithUser(user as import("@/contexts/auth-context").AuthUser);
    navigate("/");
  }

  const inputClass = "w-full bg-white/5 border border-white/10 text-white text-sm px-4 py-3 rounded-xl placeholder:text-white/20 focus:outline-none focus:border-white/30 focus:bg-white/[0.07] transition-all duration-200";

  const tabs: { key: AuthTab; label: string }[] = [
    { key: "login", label: "Sign In" },
    { key: "magic", label: "⚡ Code" },
    { key: "register", label: "Sign Up" },
    { key: "recover", label: "🔑 Recover" },
  ];

  return (
    <div className="min-h-screen bg-[#080808] flex items-center justify-center px-4 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-white/[0.02] rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-1/4 w-[300px] h-[300px] bg-indigo-500/5 rounded-full blur-3xl" />
        <div className="absolute top-0 right-1/4 w-[300px] h-[300px] bg-purple-500/5 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-[420px] relative z-10">
        <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="text-center mb-8">
          <img src={nexaLogo} alt="Nexa Anime" className="w-12 h-12 mx-auto mb-3 drop-shadow-lg" />
          <h1 className="text-white font-semibold text-lg tracking-wide">Nexa Anime</h1>
          <p className="text-white/30 text-sm mt-1">
            {tab === "login" ? "Welcome back" : tab === "magic" ? "Passwordless sign in" : tab === "recover" ? "Recover your account" : "Join the community"}
          </p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.08 }}
          className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-6 shadow-2xl backdrop-blur-sm">

          {/* 3-tab switcher */}
          <div className="flex bg-black/40 rounded-xl p-1 mb-6 border border-white/[0.06]">
            {tabs.map((t) => (
              <button key={t.key} onClick={() => { setTab(t.key); setForgotStep("idle"); }}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${tab === t.key ? "bg-white text-black shadow-sm" : "text-white/40 hover:text-white/70"}`}>
                {t.label}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            {/* ── SIGN IN ── */}
            {tab === "login" && forgotStep === "idle" && (
              <motion.form key="login" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={{ duration: 0.2 }} onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-[11px] text-white/40 mb-1.5 uppercase tracking-widest font-mono">Email or Username</label>
                  <input type="text" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} placeholder="you@example.com" required autoComplete="username" className={inputClass} />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-[11px] text-white/40 uppercase tracking-widest font-mono">Password</label>
                    <button type="button" onClick={() => { setForgotStep("form"); setForgotEmail(""); setForgotError(""); }} className="text-[11px] text-white/30 hover:text-white/60 transition-colors">Forgot password?</button>
                  </div>
                  <div className="relative">
                    <input type={showLoginPw ? "text" : "password"} value={loginPassword} onChange={e => setLoginPassword(e.target.value)} placeholder="••••••••" required autoComplete="current-password" className={`${inputClass} pr-11`} />
                    <button type="button" onClick={() => setShowLoginPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors">
                      {showLoginPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <AnimatePresence>
                  {loginError && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5">
                      <AlertCircle className="w-4 h-4 shrink-0" />{loginError}
                    </motion.div>
                  )}
                </AnimatePresence>
                <button type="submit" disabled={loginLoading} className="w-full bg-white text-black font-semibold py-3 rounded-xl text-sm hover:bg-white/90 active:scale-[0.99] transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  {loginLoading ? <><Loader2 className="w-4 h-4 animate-spin" />Signing in…</> : "Sign In"}
                </button>
                <p className="text-center text-sm text-white/30 pt-1">No account?{" "}<button type="button" onClick={() => setTab("register")} className="text-white/70 hover:text-white transition-colors underline underline-offset-2">Create one</button></p>
              </motion.form>
            )}

            {/* ── FORGOT FORM ── */}
            {tab === "login" && forgotStep === "form" && (
              <motion.form key="forgot-form" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.2 }} onSubmit={handleForgot} className="space-y-4">
                <button type="button" onClick={() => setForgotStep("idle")} className="flex items-center gap-1.5 text-[11px] text-white/30 hover:text-white/60 transition-colors font-mono uppercase tracking-widest mb-1">
                  <ArrowLeft className="w-3 h-3" /> Back to sign in
                </button>
                <div>
                  <p className="text-white/60 text-sm mb-4">Enter your account email and we'll generate a reset link.</p>
                  <label className="block text-[11px] text-white/40 mb-1.5 uppercase tracking-widest font-mono">Account Email</label>
                  <input type="email" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} placeholder="you@example.com" required autoFocus className={inputClass} />
                </div>
                <AnimatePresence>
                  {forgotError && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5">
                      <AlertCircle className="w-4 h-4 shrink-0" />{forgotError}
                    </motion.div>
                  )}
                </AnimatePresence>
                <button type="submit" disabled={forgotLoading} className="w-full bg-white text-black font-semibold py-3 rounded-xl text-sm hover:bg-white/90 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  {forgotLoading ? <><Loader2 className="w-4 h-4 animate-spin" />Sending…</> : "Send Reset Email"}
                </button>
              </motion.form>
            )}

            {/* ── FORGOT DONE ── */}
            {tab === "login" && forgotStep === "done" && (
              <motion.div key="forgot-done" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.2 }} className="space-y-4">
                <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-5 text-center space-y-2">
                  <div className="w-10 h-10 rounded-full bg-green-500/15 border border-green-500/25 flex items-center justify-center mx-auto mb-3">
                    <Check className="w-5 h-5 text-green-400" />
                  </div>
                  <p className="text-white text-sm font-semibold">Check your inbox</p>
                  <p className="text-white/50 text-xs leading-relaxed">
                    We sent a password reset link to <span className="text-white/70 font-mono">{forgotEmail}</span>.<br />
                    The link expires in 24 hours.
                  </p>
                </div>
                <p className="text-center text-xs text-white/30">Didn't get it? Check your spam folder.</p>
                <button type="button" onClick={() => { setForgotStep("idle"); setForgotEmail(""); }}
                  className="w-full flex items-center justify-center gap-2 border border-white/10 text-white/50 hover:text-white hover:border-white/20 py-2.5 rounded-xl text-sm transition-all">
                  <ArrowLeft className="w-3.5 h-3.5" /> Back to sign in
                </button>
              </motion.div>
            )}

            {/* ── MAGIC CODE ── */}
            {tab === "magic" && (
              <motion.div key="magic" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.2 }}>
                <MagicCodePanel onSuccess={handleMagicSuccess} />
              </motion.div>
            )}

            {/* ── RECOVER ACCOUNT ── */}
            {tab === "recover" && (
              <motion.form key="recover" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.2 }} onSubmit={handleRecover} className="space-y-4">
                <div className="bg-amber-500/5 border border-amber-500/15 rounded-xl px-4 py-3 flex gap-3 items-start">
                  <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-amber-200/70 text-xs leading-relaxed">
                    Enter your email or username and the backup code you downloaded when you signed up. A new backup code will be generated — save it immediately.
                  </p>
                </div>
                <div>
                  <label className="block text-[11px] text-white/40 mb-1.5 uppercase tracking-widest font-mono">Email or Username</label>
                  <input
                    type="text"
                    value={recoverIdentifier}
                    onChange={e => setRecoverIdentifier(e.target.value)}
                    placeholder="you@example.com or @handle"
                    required
                    autoFocus
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-white/40 mb-1.5 uppercase tracking-widest font-mono">Backup Code</label>
                  <input
                    type="text"
                    value={recoverCode}
                    onChange={e => setRecoverCode(e.target.value.toUpperCase())}
                    placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
                    required
                    autoComplete="off"
                    spellCheck={false}
                    className={`${inputClass} font-mono tracking-widest`}
                  />
                </div>
                <AnimatePresence>
                  {recoverError && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                      className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5">
                      <AlertCircle className="w-4 h-4 shrink-0" />{recoverError}
                    </motion.div>
                  )}
                </AnimatePresence>
                <button type="submit" disabled={recoverLoading}
                  className="w-full bg-white text-black font-semibold py-3 rounded-xl text-sm hover:bg-white/90 active:scale-[0.99] transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  {recoverLoading ? <><Loader2 className="w-4 h-4 animate-spin" />Recovering…</> : <><ShieldAlert className="w-4 h-4" />Recover Account</>}
                </button>
                <p className="text-center text-sm text-white/30 pt-1">Remembered your password?{" "}<button type="button" onClick={() => setTab("login")} className="text-white/70 hover:text-white transition-colors underline underline-offset-2">Sign in</button></p>
              </motion.form>
            )}

            {/* ── SIGN UP ── */}
            {tab === "register" && (
              <motion.form key="register" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.2 }} onSubmit={handleRegister} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-white/40 mb-1.5 uppercase tracking-widest font-mono">Display Name</label>
                    <input type="text" value={regDisplay} onChange={e => setRegDisplay(e.target.value)} placeholder="Anime Fan" required autoComplete="name" className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-[11px] text-white/40 mb-1.5 uppercase tracking-widest font-mono">Username</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 text-sm select-none">@</span>
                      <input type="text" value={regUsername} onChange={e => setRegUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase())} placeholder="handle" required autoComplete="username" className={`${inputClass} pl-7`} />
                    </div>
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] text-white/40 mb-1.5 uppercase tracking-widest font-mono">Email</label>
                  <input type="email" value={regEmail} onChange={e => setRegEmail(e.target.value)} placeholder="you@example.com" required autoComplete="email" className={inputClass} />
                </div>
                <div>
                  <label className="block text-[11px] text-white/40 mb-1.5 uppercase tracking-widest font-mono">Password</label>
                  <div className="relative">
                    <input type={showRegPw ? "text" : "password"} value={regPassword} onChange={e => setRegPassword(e.target.value)} placeholder="Min. 6 characters" required minLength={6} autoComplete="new-password" className={`${inputClass} pr-11`} />
                    <button type="button" onClick={() => setShowRegPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors">
                      {showRegPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <PasswordStrength password={regPassword} />
                </div>
                <div>
                  <label className="block text-[11px] text-white/40 mb-1.5 uppercase tracking-widest font-mono">Confirm Password</label>
                  <div className="relative">
                    <input type={showConfirmPw ? "text" : "password"} value={regConfirm} onChange={e => setRegConfirm(e.target.value)} placeholder="Repeat password" required autoComplete="new-password"
                      className={`${inputClass} pr-11 ${regConfirm && regConfirm !== regPassword ? "border-red-500/40" : regConfirm && regConfirm === regPassword ? "border-green-500/40" : ""}`} />
                    <button type="button" onClick={() => setShowConfirmPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors">
                      {showConfirmPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {regConfirm && regConfirm === regPassword && (
                    <p className="text-[11px] text-green-400 mt-1 font-mono flex items-center gap-1"><Check className="w-3 h-3" /> Passwords match</p>
                  )}
                </div>
                <AnimatePresence>
                  {regError && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5">
                      <AlertCircle className="w-4 h-4 shrink-0" />{regError}
                    </motion.div>
                  )}
                </AnimatePresence>
                <button type="submit" disabled={regLoading} className="w-full bg-white text-black font-semibold py-3 rounded-xl text-sm hover:bg-white/90 active:scale-[0.99] transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  {regLoading ? <><Loader2 className="w-4 h-4 animate-spin" />Creating account…</> : "Create Account"}
                </button>
                <p className="text-center text-sm text-white/30 pt-1">Already have an account?{" "}<button type="button" onClick={() => setTab("login")} className="text-white/70 hover:text-white transition-colors underline underline-offset-2">Sign in</button></p>
              </motion.form>
            )}
          </AnimatePresence>
        </motion.div>

        <p className="text-center text-[11px] text-white/20 mt-6">By continuing, you agree to Nexa Anime's terms of service</p>
      </div>

      {backupCode && (
        <BackupCodeModal
          code={backupCode}
          username={regUsername.trim().toLowerCase().replace(/[^a-z0-9_]/g, "")}
          onClose={() => {
            setBackupCode(null);
            if (pendingNav) navigate(pendingNav);
          }}
        />
      )}

      {newBackupCode && (
        <BackupCodeModal
          code={newBackupCode}
          username={recoveredUsername}
          onClose={() => {
            setNewBackupCode(null);
            navigate(`/u/${recoveredUsername}`);
          }}
        />
      )}
    </div>
  );
}

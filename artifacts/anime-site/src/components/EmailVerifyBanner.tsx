import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MailCheck, X, Loader2, RefreshCw, CheckCircle } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { apiUrl } from "@/lib/api";

export function EmailVerifyBanner() {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  if (!user || user.emailVerified || dismissed) return null;

  async function resend() {
    if (sending || sent) return;
    setError("");
    setSending(true);
    try {
      const res = await fetch(apiUrl("/api/auth/resend-verification"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user!.email }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to send"); return; }
      setSent(true);
      setTimeout(() => setSent(false), 8000);
    } catch {
      setError("Network error — try again");
    } finally {
      setSending(false);
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: "auto", opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        transition={{ duration: 0.25 }}
        className="overflow-hidden"
      >
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2.5">
          <div className="max-w-5xl mx-auto flex items-center gap-3 justify-between flex-wrap">
            <div className="flex items-center gap-2.5 min-w-0">
              <MailCheck className="w-4 h-4 text-amber-400 shrink-0" />
              <p className="text-amber-200/80 text-sm">
                Please verify your email address —{" "}
                <span className="text-amber-200 font-medium">{user.email}</span>
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {error && <span className="text-red-400 text-xs">{error}</span>}
              {sent ? (
                <span className="flex items-center gap-1.5 text-green-400 text-xs font-medium">
                  <CheckCircle className="w-3.5 h-3.5" /> Email sent!
                </span>
              ) : (
                <button
                  onClick={resend}
                  disabled={sending}
                  className="flex items-center gap-1.5 text-xs text-amber-300 hover:text-amber-100 transition-colors font-medium disabled:opacity-50"
                >
                  {sending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  {sending ? "Sending…" : "Resend email"}
                </button>
              )}
              <button
                onClick={() => setDismissed(true)}
                className="text-white/20 hover:text-white/50 transition-colors"
                aria-label="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { motion } from "framer-motion";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { apiUrl } from "@/lib/api";

export default function VerifyEmailPage() {
  const { token } = useParams<{ token: string }>();
  const [, navigate] = useLocation();
  const { user, loginWithUser } = useAuth();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) { setStatus("error"); setMessage("Invalid verification link."); return; }
    fetch(apiUrl(`/api/auth/verify-email/${token}`))
      .then(async (res) => {
        if (res.ok || res.redirected) {
          setStatus("success");
          // Update local user state so banner disappears immediately
          if (user) loginWithUser({ ...user, emailVerified: true });
        } else {
          const data = await res.json().catch(() => ({}));
          setStatus("error");
          setMessage(data.error ?? "Verification failed.");
        }
      })
      .catch(() => { setStatus("error"); setMessage("Network error — please try again."); });
  }, [token]);

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="w-full max-w-sm bg-white/[0.04] border border-white/[0.08] rounded-2xl p-8 text-center shadow-2xl"
      >
        {status === "loading" && (
          <>
            <Loader2 className="w-10 h-10 text-white/40 animate-spin mx-auto mb-4" />
            <p className="text-white/60 text-sm">Verifying your email…</p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="w-14 h-14 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-7 h-7 text-green-400" />
            </div>
            <h1 className="text-white font-semibold text-lg mb-2">Email verified!</h1>
            <p className="text-white/50 text-sm mb-6">Your email address has been confirmed. You're all set.</p>
            <button
              onClick={() => navigate("/")}
              className="w-full bg-white text-black font-semibold py-3 rounded-xl text-sm hover:bg-white/90 transition-all"
            >
              Go to Home
            </button>
          </>
        )}

        {status === "error" && (
          <>
            <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
              <XCircle className="w-7 h-7 text-red-400" />
            </div>
            <h1 className="text-white font-semibold text-lg mb-2">Verification failed</h1>
            <p className="text-white/50 text-sm mb-6">{message || "This link may have expired or already been used."}</p>
            <button
              onClick={() => navigate("/login")}
              className="w-full bg-white text-black font-semibold py-3 rounded-xl text-sm hover:bg-white/90 transition-all"
            >
              Back to Sign In
            </button>
          </>
        )}
      </motion.div>
    </div>
  );
}

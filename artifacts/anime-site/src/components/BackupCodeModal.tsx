import { motion, AnimatePresence } from "framer-motion";
import { ShieldCheck, Download, Copy, Check, X } from "lucide-react";
import { useState } from "react";

interface BackupCodeModalProps {
  code: string;
  username: string;
  onClose: () => void;
}

export function BackupCodeModal({ code, username, onClose }: BackupCodeModalProps) {
  const [copied, setCopied] = useState(false);

  function copyCode() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  function downloadCode() {
    const content = [
      "Nexa Anime — Account Backup Code",
      "=================================",
      "",
      `Username : ${username}`,
      `Generated: ${new Date().toUTCString()}`,
      "",
      "Backup Code:",
      code,
      "",
      "KEEP THIS SAFE.",
      "You can use this code to recover your account if you ever lose access.",
      "Each use generates a new code — the old one won't work again.",
      "Do NOT share this with anyone.",
    ].join("\n");

    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nexa-anime-backup-${username}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          onClick={onClose}
        />

        {/* Modal */}
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 20 }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          className="relative w-full max-w-md bg-[#111] border border-white/10 rounded-2xl shadow-2xl p-6 z-10"
        >
          {/* Header */}
          <div className="text-center mb-6">
            <div className="w-12 h-12 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto mb-3">
              <ShieldCheck className="w-6 h-6 text-green-400" />
            </div>
            <h2 className="text-white font-semibold text-lg">Account created!</h2>
            <p className="text-white/50 text-sm mt-1">
              Save your backup code — you'll need it to recover your account if you lose access.
            </p>
          </div>

          {/* Code display */}
          <div className="bg-black/60 border border-white/10 rounded-xl p-4 mb-4">
            <p className="text-[11px] text-white/30 uppercase tracking-widest font-mono mb-2 text-center">Your Backup Code</p>
            <p className="text-white font-mono text-xl font-bold tracking-[0.2em] text-center select-all">
              {code}
            </p>
          </div>

          {/* Warning */}
          <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl px-4 py-3 mb-5">
            <p className="text-amber-200/70 text-xs leading-relaxed text-center">
              This code is shown <span className="text-amber-300 font-semibold">once only</span>. Store it somewhere safe. Each time you use it to recover your account, a new code is generated.
            </p>
          </div>

          {/* Action buttons */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            <button
              onClick={copyCode}
              className="flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white py-2.5 rounded-xl text-sm transition-all font-medium"
            >
              {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
              {copied ? "Copied!" : "Copy Code"}
            </button>
            <button
              onClick={downloadCode}
              className="flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white py-2.5 rounded-xl text-sm transition-all font-medium"
            >
              <Download className="w-4 h-4" />
              Download .txt
            </button>
          </div>

          <button
            onClick={onClose}
            className="w-full bg-white text-black font-semibold py-3 rounded-xl text-sm hover:bg-white/90 transition-all flex items-center justify-center gap-2"
          >
            <X className="w-4 h-4" />
            I've saved my code — Continue
          </button>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Loader2 } from "lucide-react";
import { apiUrl } from "@/lib/api";
import type { AuthUser } from "@/contexts/auth-context";

const ANIME_SEEDS = [
  "akira", "yuki", "sakura", "ryu",
  "hana", "kenji", "mira", "nova",
  "kira", "sora", "luna", "zara",
  "rei", "kai", "nao", "aya",
];

function avatarUrl(seed: string) {
  return `https://api.dicebear.com/9.x/lorelei/svg?seed=${encodeURIComponent(seed)}&backgroundColor=transparent`;
}

interface Props {
  userId: number;
  onSave: (updatedUser: AuthUser) => void;
  onSkip: () => void;
}

export function AvatarPickerModal({ userId, onSave, onSkip }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(apiUrl("/api/auth/avatar"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, seed: `lorelei:${selected}` }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to save avatar"); return; }
      onSave(data as AuthUser);
    } catch {
      setError("Network error — please try again");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/85 backdrop-blur-sm"
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 20 }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          className="relative w-full max-w-sm bg-[#111] border border-white/10 rounded-2xl shadow-2xl p-6 z-10"
        >
          <div className="text-center mb-5">
            <p className="text-[10px] text-white/30 uppercase tracking-[0.2em] font-mono mb-1">Step 2 of 2</p>
            <h2 className="text-white font-semibold text-lg">Choose your avatar</h2>
            <p className="text-white/40 text-sm mt-1">Pick an anime-style profile picture</p>
          </div>

          <div className="grid grid-cols-4 gap-2.5 mb-5">
            {ANIME_SEEDS.map((seed) => {
              const isSelected = selected === seed;
              return (
                <button
                  key={seed}
                  onClick={() => setSelected(seed)}
                  className={`relative rounded-2xl p-0.5 transition-all duration-150 ${
                    isSelected
                      ? "ring-2 ring-white ring-offset-2 ring-offset-[#111] scale-105"
                      : "hover:scale-105 hover:ring-1 hover:ring-white/30 hover:ring-offset-1 hover:ring-offset-[#111]"
                  }`}
                >
                  <div className="w-full aspect-square rounded-xl overflow-hidden bg-white/5">
                    <img
                      src={avatarUrl(seed)}
                      alt={seed}
                      className="w-full h-full object-cover"
                      style={{ filter: "grayscale(1) contrast(1.1)" }}
                      loading="lazy"
                    />
                  </div>
                  {isSelected && (
                    <div className="absolute -top-1 -right-1 w-4 h-4 bg-white rounded-full flex items-center justify-center shadow">
                      <Check className="w-2.5 h-2.5 text-black" strokeWidth={3} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {error && (
            <p className="text-red-400 text-xs text-center mb-3">{error}</p>
          )}

          <button
            onClick={handleSave}
            disabled={!selected || saving}
            className="w-full bg-white text-black font-semibold py-3 rounded-xl text-sm hover:bg-white/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 mb-2"
          >
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" />Saving…</> : "Save Avatar"}
          </button>

          <button
            onClick={onSkip}
            className="w-full text-white/30 hover:text-white/60 py-2 text-sm transition-colors"
          >
            Skip for now
          </button>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

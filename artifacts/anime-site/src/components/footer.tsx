import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";

const NAV_COL_1 = [
  { label: "Home", href: "/" },
  { label: "Browse", href: "/browse" },
  { label: "Ranking", href: "/ranking" },
  { label: "Schedule", href: "/schedule" },
  { label: "Community", href: "/community" },
  { label: "News", href: "/news" },
];

const NAV_COL_2 = [
  { label: "Manga", href: "/manga" },
  { label: "Dubbed", href: "/dubbed" },
  { label: "Watchlist", href: "/watchlist" },
  { label: "Discord", href: "https://discord.gg", external: true },
  { label: "Twitter / X", href: "https://x.com", external: true },
  { label: "YouTube", href: "https://youtube.com", external: true },
];

export function Footer() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim()) {
      setSubmitted(true);
      setEmail("");
    }
  };

  return (
    <footer className="relative w-full border-t border-white/[0.06] bg-black overflow-hidden">
      {/* Subtle radial glow – mirrors the blurred bg in the reference */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 60% at 10% 50%, rgba(255,255,255,0.03) 0%, transparent 70%)",
        }}
      />

      {/* ── Main grid ── */}
      <div className="relative mx-auto max-w-screen-xl px-8 pt-16 pb-10 grid grid-cols-1 gap-12 md:grid-cols-[1fr_1.4fr_1fr] md:gap-8">

        {/* LEFT — brand + contact */}
        <div className="flex flex-col justify-between gap-8">
          {/* Giant stacked brand letters */}
          <div
            className="select-none leading-none font-black tracking-tighter"
            style={{
              fontSize: "clamp(5rem, 10vw, 9rem)",
              lineHeight: 0.85,
              fontFamily: "var(--app-font-sans)",
              background:
                "linear-gradient(160deg, #ffffff 30%, #666666 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              textShadow: "none",
            }}
          >
            <span className="block">NE</span>
            <span className="block">XA</span>
          </div>

          {/* Contact block */}
          <div className="space-y-1 text-sm">
            <p className="text-white/40 uppercase tracking-widest text-[10px] font-semibold mb-3">
              Contact
            </p>
            <a
              href="mailto:hello@nexaanime.com"
              className="block text-white/70 hover:text-white transition-colors font-medium"
            >
              hello@nexaanime.com
            </a>
            <a
              href="https://discord.gg"
              target="_blank"
              rel="noopener noreferrer"
              className="block text-white/40 hover:text-white/70 transition-colors text-xs"
            >
              Join our Discord community ↗
            </a>
          </div>
        </div>

        {/* CENTRE — newsletter */}
        <div className="flex flex-col justify-center gap-6">
          <div>
            <h2 className="text-3xl md:text-4xl font-light text-white/60 leading-tight">
              Get the{" "}
              <span className="font-black text-white">latest</span>
              <br />
              anime updates
            </h2>
            <p className="mt-3 text-sm text-white/40 max-w-xs leading-relaxed">
              New episodes, seasonal picks, and community highlights — delivered
              straight to you, no spam.
            </p>
          </div>

          {submitted ? (
            <p className="text-sm text-white/60 font-medium">
              ✓ You're on the list. Stay tuned!
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="flex items-stretch gap-0 max-w-sm">
              <input
                type="email"
                required
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="
                  flex-1 bg-white/[0.06] border border-white/10 text-white text-sm px-4 py-3
                  placeholder:text-white/30 outline-none
                  focus:border-white/30 focus:bg-white/[0.09]
                  transition-colors
                "
              />
              <button
                type="submit"
                aria-label="Subscribe"
                className="
                  bg-white text-black px-4 py-3 flex items-center justify-center
                  hover:bg-white/90 active:scale-95 transition-all
                "
              >
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          )}
        </div>

        {/* RIGHT — nav links */}
        <div className="flex gap-10 md:justify-end">
          <nav className="space-y-3">
            <p className="text-white/40 uppercase tracking-widest text-[10px] font-semibold mb-4">
              Explore
            </p>
            {NAV_COL_1.map((link) => (
              <Link key={link.href} href={link.href}>
                <span className="block text-sm text-white/60 hover:text-white transition-colors cursor-pointer">
                  {link.label}
                </span>
              </Link>
            ))}
          </nav>
          <nav className="space-y-3">
            <p className="text-white/40 uppercase tracking-widest text-[10px] font-semibold mb-4">
              More
            </p>
            {NAV_COL_2.map((link) =>
              link.external ? (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-sm text-white/60 hover:text-white transition-colors"
                >
                  {link.label}
                </a>
              ) : (
                <Link key={link.href} href={link.href}>
                  <span className="block text-sm text-white/60 hover:text-white transition-colors cursor-pointer">
                    {link.label}
                  </span>
                </Link>
              )
            )}
          </nav>
        </div>
      </div>

      {/* ── Bottom strip ── */}
      <div className="relative border-t border-white/[0.06] mx-8">
        <div className="mx-auto max-w-screen-xl py-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <p className="text-xs text-white/25 max-w-md leading-relaxed">
            Nexa Anime — a streaming discovery platform. All trademarks and
            anime titles belong to their respective owners. Content is sourced
            via publicly available APIs.
          </p>
          <p className="text-xs text-white/25 whitespace-nowrap">
            © {new Date().getFullYear()} Nexa Anime. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}

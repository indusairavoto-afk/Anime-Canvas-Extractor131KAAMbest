import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-black">
      <div className="text-center">
        <p className="font-mono text-[9px] uppercase tracking-[0.4em] text-white/30 mb-4">404</p>
        <h1 className="font-serif text-5xl text-white mb-4">Page Not Found</h1>
        <p className="text-white/40 text-sm font-mono mb-8">The page you are looking for does not exist.</p>
        <Link href="/">
          <button className="px-8 py-3 bg-white text-black text-xs font-bold uppercase tracking-widest hover:bg-white/90 transition-colors">
            Go Home
          </button>
        </Link>
      </div>
    </div>
  );
}

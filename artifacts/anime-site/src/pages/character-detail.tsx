import { motion } from "framer-motion";
import { useParams, Link } from "wouter";
import { useState, useEffect } from "react";
import { ArrowLeft, User, Mic } from "lucide-react";

interface VoiceActor {
  id: number;
  name: { full: string; native?: string | null };
  image: { large?: string; medium?: string };
  language?: string;
}

interface MediaAppearance {
  id: number;
  title: { romaji: string; english?: string | null };
  coverImage: { large?: string };
  format?: string | null;
  status?: string | null;
}

interface CharacterDetail {
  id: number;
  name: { full: string; native?: string | null; alternative?: string[] };
  description?: string | null;
  image: { large?: string; medium?: string };
  gender?: string | null;
  dateOfBirth?: { year?: number | null; month?: number | null; day?: number | null } | null;
  age?: string | null;
  bloodType?: string | null;
  voiceActors: VoiceActor[];
  media?: { nodes: MediaAppearance[] };
}

const CHAR_QUERY = `
query ($id: Int!) {
  Character(id: $id) {
    id
    name { full native alternative }
    description(asHtml: false)
    image { large medium }
    gender
    dateOfBirth { year month day }
    age
    bloodType
    media(sort: [POPULARITY_DESC], perPage: 8) {
      nodes {
        id title { romaji english }
        coverImage { large }
        format status
      }
    }
  }
}`;

const VA_QUERY = `
query ($id: Int!) {
  Character(id: $id) {
    media(perPage: 1) {
      edges {
        voiceActors {
          id name { full native } image { large medium } languageV2
        }
      }
    }
  }
}`;

function stripDescription(raw: string): string {
  return raw
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .trim();
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default function CharacterDetail() {
  const params = useParams<{ id: string }>();
  const charId = parseInt(params.id ?? "0");

  const [char, setChar] = useState<CharacterDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!charId) return;
    setLoading(true);
    setError(false);

    Promise.all([
      fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: CHAR_QUERY, variables: { id: charId } }),
      }).then((r) => r.json()),
      fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: VA_QUERY, variables: { id: charId } }),
      }).then((r) => r.json()),
    ])
      .then(([charJson, vaJson]) => {
        const base = charJson?.data?.Character;
        if (!base) { setError(true); return; }
        const vaEdges: VoiceActor[] = vaJson?.data?.Character?.media?.edges?.[0]?.voiceActors ?? [];
        setChar({ ...base, voiceActors: vaEdges });
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [charId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-8 h-8 border border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !char) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-4">
        <p className="text-white/40 font-mono">Character not found</p>
        <button onClick={() => history.back()} className="text-[10px] font-mono uppercase tracking-widest border border-white/10 text-white/40 hover:text-white px-4 py-2 transition-colors">
          Go Back
        </button>
      </div>
    );
  }

  const portrait = char.image?.large || char.image?.medium || "";
  const desc = char.description ? stripDescription(char.description) : null;
  const dob = char.dateOfBirth;
  const dobStr = dob
    ? [dob.month ? MONTHS[(dob.month ?? 1) - 1] : null, dob.day, dob.year].filter(Boolean).join(" ")
    : null;
  const alternatives = (char.name.alternative ?? []).filter((a) => a.trim());

  const stats = [
    { label: "Gender",     value: char.gender },
    { label: "Age",        value: char.age },
    { label: "Born",       value: dobStr },
    { label: "Blood Type", value: char.bloodType },
  ].filter((s) => s.value);

  return (
    <div className="bg-black text-white min-h-screen">
      {/* Blurred portrait hero */}
      <div className="relative h-48 sm:h-64 overflow-hidden">
        {portrait && (
          <img
            src={portrait}
            alt={char.name.full}
            className="absolute inset-0 w-full h-full object-cover object-top scale-110"
            style={{ filter: "brightness(0.15) blur(24px)" }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black" />

        <div className="absolute top-4 sm:top-6 left-4 sm:left-8 lg:left-16">
          <button
            onClick={() => history.back()}
            className="flex items-center gap-2 text-white/50 hover:text-white text-xs sm:text-sm font-mono uppercase tracking-widest transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
        </div>
      </div>

      {/* Main layout */}
      <div className="max-w-5xl mx-auto px-4 sm:px-8 -mt-24 sm:-mt-32 relative z-10 pb-20">
        <div className="flex gap-5 sm:gap-8">
          {/* Portrait */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="flex-shrink-0 w-28 sm:w-44 md:w-52"
          >
            <div className="aspect-[2/3] border border-white/10 overflow-hidden shadow-2xl">
              {portrait ? (
                <img src={portrait} alt={char.name.full} className="w-full h-full object-cover object-top" />
              ) : (
                <div className="w-full h-full bg-zinc-900 flex items-center justify-center">
                  <User className="w-10 h-10 text-white/10" />
                </div>
              )}
            </div>
          </motion.div>

          {/* Info */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="flex-1 pt-16 sm:pt-24 min-w-0"
          >
            {char.name.native && (
              <p className="text-white/30 font-mono text-xs tracking-widest uppercase mb-1 hidden sm:block">
                {char.name.native}
              </p>
            )}
            <h1 className="font-serif text-2xl sm:text-4xl lg:text-5xl text-white leading-tight mb-3">
              {char.name.full}
            </h1>

            {alternatives.length > 0 && (
              <p className="text-white/25 font-mono text-[10px] uppercase tracking-widest mb-4 hidden sm:block">
                Also known as: {alternatives.slice(0, 3).join(" · ")}
              </p>
            )}

            {/* Stats grid */}
            {stats.length > 0 && (
              <div className="flex flex-wrap gap-x-6 gap-y-2 mb-5">
                {stats.map((s) => (
                  <div key={s.label}>
                    <p className="text-[9px] font-mono text-white/25 uppercase tracking-[0.25em]">{s.label}</p>
                    <p className="text-white/80 text-sm font-medium">{s.value}</p>
                  </div>
                ))}
              </div>
            )}

            {desc && (
              <p className="text-white/60 text-sm leading-relaxed hidden sm:block max-w-xl">
                {desc.length > 500 ? desc.slice(0, 500) + "…" : desc}
              </p>
            )}
          </motion.div>
        </div>

        {/* Mobile description */}
        {desc && (
          <div className="sm:hidden mt-5">
            <p className="text-white/60 text-sm leading-relaxed">
              {desc.length > 400 ? desc.slice(0, 400) + "…" : desc}
            </p>
          </div>
        )}

        {/* Voice Actors */}
        {char.voiceActors.length > 0 && (
          <section className="mt-10 sm:mt-14">
            <div className="flex items-center gap-2 mb-5">
              <Mic className="w-4 h-4 text-white/30" />
              <h2 className="font-serif text-xl sm:text-2xl text-white">Voice Actors</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
              {char.voiceActors.map((va, i) => {
                const vaImg = va.image?.large || va.image?.medium || "";
                return (
                  <motion.div
                    key={va.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.07 }}
                    className="flex items-center gap-3 border border-white/8 p-3 hover:border-white/20 hover:bg-white/[0.02] transition-all"
                  >
                    <div className="flex-shrink-0 w-12 h-12 overflow-hidden border border-white/10">
                      {vaImg ? (
                        <img src={vaImg} alt={va.name.full} className="w-full h-full object-cover object-top" />
                      ) : (
                        <div className="w-full h-full bg-zinc-900 flex items-center justify-center">
                          <Mic className="w-4 h-4 text-white/20" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-white text-xs font-medium leading-snug line-clamp-2">{va.name.full}</p>
                      {va.name.native && (
                        <p className="text-white/30 text-[9px] font-mono mt-0.5 truncate">{va.name.native}</p>
                      )}
                      {va.language && (
                        <p className="text-white/20 text-[8px] font-mono uppercase tracking-widest mt-0.5">{va.language}</p>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </section>
        )}

        {/* Anime Appearances */}
        {char.media?.nodes && char.media.nodes.length > 0 && (
          <section className="mt-10 sm:mt-14">
            <h2 className="font-serif text-xl sm:text-2xl text-white mb-5">Appears In</h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 sm:gap-4">
              {char.media.nodes.map((m, i) => {
                const mTitle = m.title.english || m.title.romaji;
                const mCover = m.coverImage?.large || "";
                return (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                  >
                    <Link href={`/anime/al/${m.id}`}>
                      <div className="group cursor-pointer">
                        <div className="relative aspect-[2/3] overflow-hidden border border-white/5 mb-2">
                          {mCover && (
                            <img
                              src={mCover}
                              alt={mTitle}
                              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                              loading="lazy"
                            />
                          )}
                          {m.format && (
                            <div className="absolute top-1.5 right-1.5 bg-black/70 text-white text-[8px] font-mono px-1.5 py-0.5">
                              {m.format}
                            </div>
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <p className="text-white/70 text-[11px] font-medium line-clamp-2 leading-snug group-hover:text-white transition-colors">
                          {mTitle}
                        </p>
                      </div>
                    </Link>
                  </motion.div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

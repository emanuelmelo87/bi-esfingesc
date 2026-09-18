const TONES = {
  green: "bg-emerald-950 text-emerald-400 border-emerald-800",
  red: "bg-red-950 text-red-400 border-red-800",
  yellow: "bg-amber-950 text-amber-400 border-amber-800",
  gray: "bg-zinc-800 text-zinc-400 border-zinc-700",
} as const;

export type Tone = keyof typeof TONES;

export default function StatusBadge({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${TONES[tone]}`}
    >
      {label}
    </span>
  );
}

const TONES = {
  green: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800",
  red: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-800",
  yellow: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800",
  gray: "bg-zinc-100 text-zinc-600 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700",
} as const;

export type Tone = keyof typeof TONES;

export default function StatusBadge({ label, tone, title }: { label: string; tone: Tone; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${TONES[tone]}`}
    >
      {label}
    </span>
  );
}

import type { Tone } from "@/components/StatusBadge";

const ACCENTS: Record<Tone, string> = {
  green: "text-emerald-600 dark:text-emerald-400",
  red: "text-red-600 dark:text-red-400",
  yellow: "text-amber-600 dark:text-amber-400",
  gray: "text-zinc-900 dark:text-zinc-50",
};

export default function StatTile({
  valor,
  label,
  tone = "gray",
}: {
  valor: number | string;
  label: string;
  tone?: Tone;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className={`text-3xl font-semibold tabular-nums ${ACCENTS[tone]}`}>{valor}</div>
      <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{label}</div>
    </div>
  );
}

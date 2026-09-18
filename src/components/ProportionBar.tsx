export default function ProportionBar({
  label,
  valor,
  total,
}: {
  label: string;
  valor: number;
  total: number;
}) {
  const pct = total > 0 ? (valor / total) * 100 : 0;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-36 shrink-0 truncate text-zinc-600 dark:text-zinc-400">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div className="h-full rounded-full bg-vinho" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 shrink-0 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{valor}</span>
    </div>
  );
}

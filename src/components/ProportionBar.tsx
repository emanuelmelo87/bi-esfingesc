export default function ProportionBar({
  label,
  valor,
  total,
}: {
  label: string;
  valor: number;
  total: number;
}) {
  const pct = total > 0 ? Math.round((valor / total) * 1000) / 10 : 0;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-[12px] font-medium text-apple-title">
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-vinho" />
          {label}
        </span>
        <span className="font-mono text-[12px]">
          <span className="font-bold text-apple-title">{valor}</span>{" "}
          <span className="text-apple-muted">({pct}%)</span>
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-black/[0.05] p-[1px] dark:bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-vinho-hover to-vinho"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function ContadorResultados({
  mostrando,
  total,
  label = "municípios",
}: {
  mostrando: number;
  total: number;
  label?: string;
}) {
  return (
    <span className="inline-flex items-center rounded-full border border-black/[0.08] bg-white/80 px-3 py-1.5 text-[12px] font-semibold whitespace-nowrap text-apple-title shadow-xs dark:border-white/10 dark:bg-white/5">
      {mostrando === total ? `${total} ${label}` : `${mostrando} de ${total} ${label}`}
    </span>
  );
}

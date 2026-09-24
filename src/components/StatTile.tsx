import Link from "next/link";
import type { Tone } from "@/components/StatusBadge";

const NUMERO: Record<Tone, string> = {
  green: "text-emerald-600 dark:text-emerald-400",
  red: "text-[#E02424] dark:text-red-400",
  yellow: "text-[#D97706] dark:text-amber-400",
  gray: "text-apple-title",
};

const BADGE: Record<Tone, string> = {
  green: "bg-emerald-500/10 text-emerald-700 border-emerald-500/15 dark:text-emerald-400",
  red: "bg-rose-500/10 text-rose-700 border-rose-500/15 dark:text-rose-400",
  yellow: "bg-amber-500/10 text-amber-800 border-amber-500/15 dark:text-amber-400",
  gray: "bg-black/[0.04] text-apple-title border-black/[0.04] dark:bg-white/[0.06] dark:border-white/10",
};

export default function StatTile({
  eyebrow,
  badge,
  valor,
  label,
  footerLabel,
  footerValor,
  tone = "gray",
  href,
}: {
  eyebrow: string;
  badge?: { label: string; tone: Tone };
  valor: number | string;
  label: string;
  footerLabel?: string;
  footerValor?: string;
  tone?: Tone;
  // Quando informado, o cartão inteiro vira link pra tela com o detalhe.
  href?: string;
}) {
  const conteudo = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold tracking-wider text-apple-muted uppercase">{eyebrow}</span>
        {badge && (
          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${BADGE[badge.tone]}`}>
            {badge.label}
          </span>
        )}
      </div>
      <div className="my-4">
        <div className={`text-[40px] leading-none font-bold tracking-[-0.035em] tabular-nums ${NUMERO[tone]}`}>{valor}</div>
        <p className="mt-1.5 text-[13px] font-medium text-apple-secondary">{label}</p>
      </div>
      {footerLabel && (
        <div className="flex items-center justify-between border-t border-black/[0.05] pt-3 text-[11px] text-apple-muted dark:border-white/10">
          <span>{footerLabel}</span>
          <span className="font-mono font-semibold text-apple-title">{footerValor}</span>
        </div>
      )}
    </>
  );
  const classe = "apple-glass-card flex flex-col justify-between rounded-[22px] p-5";
  return href ? (
    <Link href={href} className={`${classe} transition hover:ring-1 hover:ring-vinho/40`}>
      {conteudo}
    </Link>
  ) : (
    <div className={classe}>{conteudo}</div>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { IconTicket } from "@/components/icons";
import { formatarDuracao, URL_JIRA_CHAMADO, type Chamado } from "@/lib/chamados";

const LARGURA = 340;

// Ícone de chamado aberto ao lado de um município/módulo (vermelho se algum
// estourou o SLO). Clicar abre a lista dos chamados, cada um com link pro Jira.
// A lista usa position: fixed porque as tabelas têm overflow-x: auto, que
// cortaria um popover posicionado dentro da célula.
export default function ChamadosIndicador({ lista }: { lista: Chamado[] | undefined }) {
  const [posicao, setPosicao] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!posicao) return;
    const fechar = () => setPosicao(null);
    const teclado = (e: KeyboardEvent) => e.key === "Escape" && fechar();
    window.addEventListener("scroll", fechar, true);
    window.addEventListener("resize", fechar);
    window.addEventListener("keydown", teclado);
    return () => {
      window.removeEventListener("scroll", fechar, true);
      window.removeEventListener("resize", fechar);
      window.removeEventListener("keydown", teclado);
    };
  }, [posicao]);

  if (!lista || lista.length === 0) return null;
  const estourado = lista.some((c) => c.br);

  function abrir(e: React.MouseEvent<HTMLButtonElement>) {
    if (posicao) return setPosicao(null);
    const r = e.currentTarget.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - LARGURA - 8));
    const cabeEmbaixo = r.bottom + 300 < window.innerHeight;
    setPosicao({ top: cabeEmbaixo ? r.bottom + 6 : Math.max(8, r.top - 306), left });
  }

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        aria-expanded={!!posicao}
        aria-label={`${lista.length} chamado${lista.length > 1 ? "s" : ""} aberto${lista.length > 1 ? "s" : ""}`}
        title="Ver chamados abertos"
        className={`ml-1.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 align-middle text-[10px] font-semibold transition hover:brightness-95 ${
          estourado
            ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400"
            : "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
        }`}
      >
        <IconTicket className="h-3 w-3" />
        {lista.length}
      </button>
      {posicao && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setPosicao(null)} />
          <div
            role="dialog"
            aria-label="Chamados abertos"
            style={{ top: posicao.top, left: posicao.left, width: LARGURA }}
            className="fixed z-[61] max-h-[300px] overflow-y-auto rounded-2xl border border-black/[0.08] bg-white p-2 text-left font-normal whitespace-normal shadow-xl dark:border-white/10 dark:bg-zinc-900"
          >
            <p className="px-2 pt-1 pb-1.5 text-[10px] font-bold tracking-wider text-apple-muted uppercase">
              {lista.length} chamado{lista.length > 1 ? "s" : ""} aberto{lista.length > 1 ? "s" : ""}
            </p>
            <ul className="space-y-0.5">
              {lista.map((c) => (
                <li key={c.k}>
                  <a
                    href={URL_JIRA_CHAMADO + c.k}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-xl px-2 py-1.5 transition hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] font-semibold text-vinho dark:text-blue-400">{c.k} ↗</span>
                      <span className={`text-[10px] font-semibold ${c.br ? "text-red-600 dark:text-red-400" : "text-apple-muted"}`}>
                        {c.br ? `SLO estourado${c.rem !== null ? ` há ${formatarDuracao(c.rem)}` : ""}` : c.paused ? "SLO pausado" : "No prazo"}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-apple-title">{c.s}</span>
                    <span className="mt-0.5 block text-[10px] text-apple-muted">
                      {c.v} · {c.st} · {c.a || "sem responsável"}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
            <Link href="/chamados" className="mt-1 block rounded-xl px-2 py-1.5 text-[11px] font-medium text-apple-secondary hover:bg-black/[0.04] dark:hover:bg-white/[0.06]">
              Ver todos na tela Chamados →
            </Link>
          </div>
        </>
      )}
    </>
  );
}

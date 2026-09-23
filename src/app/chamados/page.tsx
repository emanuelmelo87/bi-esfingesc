"use client";

import RequireAuth from "@/components/RequireAuth";

const URL_CHAMADOS = "https://arimanoelgomes-ctrl.github.io/esfinge_pequenas_medias/";

export default function ChamadosPage() {
  return (
    <RequireAuth>
      <main className="flex w-full flex-1 flex-col px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold tracking-[-0.02em] text-apple-title">Chamados</h1>
            <p className="text-sm text-apple-secondary">
              Chamados de e-Sfinge no Jira Atendimento (Pequenas e Médias Contas). Painel externo, mantido fora deste sistema.
            </p>
          </div>
          <a
            href={URL_CHAMADOS}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-black/[0.08] bg-white/80 px-3 py-1.5 text-[12px] font-semibold text-apple-title shadow-xs transition hover:bg-white dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
          >
            Abrir em nova aba
          </a>
        </div>
        {/* Sem allow-top-navigation: o painel externo não consegue tirar o usuário deste sistema. */}
        <iframe
          src={URL_CHAMADOS}
          title="Chamados e-Sfinge"
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          className="h-[calc(100dvh-9rem)] min-h-[560px] w-full rounded-[22px] border border-black/[0.06] bg-white dark:border-white/10"
        />
      </main>
    </RequireAuth>
  );
}

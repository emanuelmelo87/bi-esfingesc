const CAPACIDADES = [
  { label: "Ver Ratificação Geral / Status por Módulo / Evolução", ADMIN_GERAL: true, GESTOR_CANAL: true, ANALISTA: true, LEITURA: true },
  { label: "Gerenciar municípios (Tela 4)", ADMIN_GERAL: true, GESTOR_CANAL: false, ANALISTA: false, LEITURA: false },
  { label: "Gerenciar usuários (Tela 5)", ADMIN_GERAL: true, GESTOR_CANAL: false, ANALISTA: false, LEITURA: false },
  { label: "Restrição por canal (planejado)", ADMIN_GERAL: false, GESTOR_CANAL: true, ANALISTA: false, LEITURA: false },
] as const;

const PERFIS = ["ADMIN_GERAL", "GESTOR_CANAL", "ANALISTA", "LEITURA"] as const;

export default function AdminPermissoesPage() {
  return (
    <main className="w-full min-w-0 flex-1 px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="mb-1 text-2xl font-bold tracking-[-0.02em] text-apple-title">Matriz de Permissões (RBAC)</h1>
      <p className="mb-4 max-w-2xl text-sm text-apple-secondary">
        Grade de privilégios pretendida para os 4 perfis. Hoje, só o bloqueio das telas e ações de
        administração (exclusivas de ADMIN_GERAL) está de fato aplicado. As distinções entre
        GESTOR_CANAL, ANALISTA e LEITURA (ex.: escopo por canal de atendimento) são informativas
        por enquanto — a especificação não detalha o suficiente para implementar sem adivinhar.
      </p>

      <div className="apple-glass-card overflow-hidden rounded-[22px]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-black/[0.05] bg-black/[0.015] text-[11px] font-medium tracking-wider text-apple-muted uppercase dark:border-white/10 dark:bg-white/[0.02]">
                <th className="px-6 py-3">Capacidade</th>
                {PERFIS.map((p) => (
                  <th key={p} className="px-4 py-3">{p}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.06]">
              {CAPACIDADES.map((cap) => (
                <tr key={cap.label}>
                  <td className="px-6 py-3.5 font-semibold text-apple-title">{cap.label}</td>
                  {PERFIS.map((p) => (
                    <td key={p} className="px-4 py-3.5">
                      {cap[p] ? (
                        <span className="text-emerald-600 dark:text-emerald-400">Sim</span>
                      ) : (
                        <span className="text-apple-muted">Não</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

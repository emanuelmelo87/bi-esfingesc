const CAPACIDADES = [
  { label: "Ver Pipeline / Matriz / Evolução", ADMIN_GERAL: true, GESTOR_CANAL: true, ANALISTA: true, LEITURA: true },
  { label: "Editar atribuição no Pipeline (lote)", ADMIN_GERAL: true, GESTOR_CANAL: true, ANALISTA: true, LEITURA: false },
  { label: "Gerenciar municípios (Tela 4)", ADMIN_GERAL: true, GESTOR_CANAL: false, ANALISTA: false, LEITURA: false },
  { label: "Gerenciar usuários (Tela 5)", ADMIN_GERAL: true, GESTOR_CANAL: false, ANALISTA: false, LEITURA: false },
  { label: "Restrição por canal (planejado)", ADMIN_GERAL: false, GESTOR_CANAL: true, ANALISTA: false, LEITURA: false },
] as const;

const PERFIS = ["ADMIN_GERAL", "GESTOR_CANAL", "ANALISTA", "LEITURA"] as const;

export default function AdminPermissoesPage() {
  return (
    <main className="flex-1 px-6 py-6">
      <h1 className="mb-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Matriz de Permissões (RBAC)</h1>
      <p className="mb-4 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
        Grade de privilégios pretendida para os 4 perfis. Nesta sprint, só o bloqueio de acesso
        às telas de Admin (ADMIN_GERAL) e a restrição de edição em lote para LEITURA estão
        de fato aplicados no código. As distinções entre GESTOR_CANAL e ANALISTA (ex.: escopo
        por canal de atendimento) são informativas por enquanto — a especificação não detalha
        o suficiente para implementar sem adivinhar.
      </p>

      <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-100 text-left text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2">Capacidade</th>
              {PERFIS.map((p) => (
                <th key={p} className="px-3 py-2">{p}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CAPACIDADES.map((cap) => (
              <tr key={cap.label} className="border-t border-zinc-200 dark:border-zinc-800">
                <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">{cap.label}</td>
                {PERFIS.map((p) => (
                  <td key={p} className="px-3 py-2">
                    {cap[p] ? (
                      <span className="text-emerald-600 dark:text-emerald-400">Sim</span>
                    ) : (
                      <span className="text-zinc-400 dark:text-zinc-600">Não</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

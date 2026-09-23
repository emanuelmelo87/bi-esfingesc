import Link from "next/link";
import { IconTicket } from "@/components/icons";
import { resumoChamados, type Chamado } from "@/lib/chamados";

// Ícone de chamado aberto ao lado de um município/módulo; vermelho se algum
// estourou o SLO. Passar o mouse lista os chamados; clicar abre a tela Chamados.
export default function ChamadosIndicador({ lista }: { lista: Chamado[] | undefined }) {
  if (!lista || lista.length === 0) return null;
  const estourado = lista.some((c) => c.br);
  return (
    <Link
      href="/chamados"
      title={`${lista.length} chamado${lista.length > 1 ? "s" : ""} aberto${lista.length > 1 ? "s" : ""}:\n\n${resumoChamados(lista)}`}
      className={`ml-1.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 align-middle text-[10px] font-semibold ${
        estourado
          ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400"
          : "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
      }`}
    >
      <IconTicket className="h-3 w-3" />
      {lista.length}
    </Link>
  );
}

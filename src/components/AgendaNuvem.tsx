"use client";

import { useEffect, useRef, useState } from "react";
import { doc, getDoc, serverTimestamp, setDoc, type Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { JQL_PADRAO } from "@/lib/jira-jql";

// Agenda de uma carga na nuvem: TCE em config/agenda_nuvem (função relogioCarga)
// e Jira em config/agenda_jira (relogioJira). As funções conferem o documento a
// cada 5 minutos e disparam a carga nos horários cadastrados.
type Agenda = {
  ativo: boolean;
  horarios: string[];
  dias: number[]; // 0 = domingo
  competencia_inicio: string; // só TCE
  jql: string; // só Jira
  atualizado_por?: string;
  atualizado_em?: Timestamp | null;
};

export type FonteCarga = "tce" | "jira";

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const PADRAO: Agenda = { ativo: false, horarios: [], dias: [1, 2, 3, 4, 5], competencia_inicio: "05/2026", jql: JQL_PADRAO };
const DOC: Record<FonteCarga, string> = { tce: "agenda_nuvem", jira: "agenda_jira" };

function proximoDisparo(a: Agenda): string | null {
  if (!a.ativo || !a.horarios.length) return null;
  const agora = new Date();
  for (let d = 0; d < 8; d++) {
    const dia = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + d);
    if (a.dias.length && !a.dias.includes(dia.getDay())) continue;
    for (const h of a.horarios) {
      const [hh, mm] = h.split(":").map(Number);
      const quando = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), hh, mm);
      if (quando > agora) {
        return (d === 0 ? "hoje" : d === 1 ? "amanhã" : DIAS[quando.getDay()].toLowerCase()) + " às " + h;
      }
    }
  }
  return null;
}

export default function AgendaNuvem({ fonte }: { fonte: FonteCarga }) {
  const { user } = useAuth();
  const [agenda, setAgenda] = useState<Agenda>(PADRAO);
  const [novoHorario, setNovoHorario] = useState("");
  // Atalho "de X em X": preenche a lista inteira de uma vez.
  const [serie, setSerie] = useState(fonte === "jira" ? { de: "07:00", ate: "19:00", intervalo: 15 } : { de: "08:00", ate: "18:00", intervalo: 60 });
  const [alterado, setAlterado] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  // O filtro do Jira se salva sozinho (sem "Salvar agenda"): 1,5s depois da
  // última tecla, ou ao sair do campo. Vale a partir da próxima carga.
  const [estadoFiltro, setEstadoFiltro] = useState<string | null>(null);
  const timerFiltro = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timerFiltro.current) clearTimeout(timerFiltro.current);
  }, []);

  useEffect(() => {
    getDoc(doc(db, "config", DOC[fonte])).then((snap) => {
      if (snap.exists()) setAgenda({ ...PADRAO, ...(snap.data() as Agenda) });
    });
  }, [fonte]);

  function mudar(parcial: Partial<Agenda>) {
    setAgenda((a) => ({ ...a, ...parcial }));
    setAlterado(true);
    setMensagem(null);
  }

  async function salvarFiltro(jql: string) {
    if (timerFiltro.current) clearTimeout(timerFiltro.current);
    timerFiltro.current = null;
    if (!jql.trim()) {
      setEstadoFiltro("O filtro não pode ficar vazio — não foi salvo.");
      return;
    }
    setEstadoFiltro("Salvando o filtro…");
    try {
      await setDoc(
        doc(db, "config", DOC[fonte]),
        { jql: jql.trim(), atualizado_por: user?.email ?? null, atualizado_em: serverTimestamp() },
        { merge: true }
      );
      setEstadoFiltro("Filtro salvo às " + new Date().toLocaleTimeString("pt-BR") + " — vale a partir da próxima carga (ou clique em Rodar na nuvem agora).");
    } catch (err) {
      setEstadoFiltro("Não foi possível salvar o filtro: " + (err as Error).message);
    }
  }

  function mudarFiltro(jql: string) {
    setAgenda((a) => ({ ...a, jql }));
    setEstadoFiltro("Filtro alterado — salvando em instantes…");
    if (timerFiltro.current) clearTimeout(timerFiltro.current);
    timerFiltro.current = setTimeout(() => salvarFiltro(jql), 1500);
  }

  function adicionarHorario() {
    if (!novoHorario || agenda.horarios.includes(novoHorario)) return;
    mudar({ horarios: [...agenda.horarios, novoHorario].sort() });
    setNovoHorario("");
  }

  function gerarSerie() {
    const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
    const lista = new Set(agenda.horarios);
    for (let m = minutos(serie.de); m <= minutos(serie.ate); m += serie.intervalo) {
      lista.add(String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"));
    }
    mudar({ horarios: [...lista].sort() });
  }

  async function salvar() {
    // Hora digitada sem clicar em "Adicionar" também entra.
    const horarios = novoHorario && !agenda.horarios.includes(novoHorario) ? [...agenda.horarios, novoHorario].sort() : agenda.horarios;
    if (agenda.ativo && horarios.length === 0) {
      setMensagem("Adicione ao menos um horário antes de ativar.");
      return;
    }
    if (fonte === "tce" && !/^(0[1-9]|1[0-2])\/\d{4}$/.test(agenda.competencia_inicio)) {
      setMensagem("Competência inicial deve estar no formato MM/AAAA.");
      return;
    }
    if (fonte === "jira" && !agenda.jql.trim()) {
      setMensagem("O filtro do Jira não pode ficar vazio.");
      return;
    }
    setSalvando(true);
    try {
      await setDoc(
        doc(db, "config", DOC[fonte]),
        {
          ativo: agenda.ativo,
          horarios: horarios,
          dias: agenda.dias,
          ...(fonte === "tce" ? { competencia_inicio: agenda.competencia_inicio } : { jql: agenda.jql.trim() }),
          atualizado_por: user?.email ?? null,
          atualizado_em: serverTimestamp(),
        },
        { merge: true }
      );
      setAgenda((a) => ({ ...a, horarios }));
      setNovoHorario("");
      setAlterado(false);
      setMensagem("Agenda salva" + (agenda.ativo ? " — " + horarios.length + " horário" + (horarios.length > 1 ? "s" : "") + " por dia." : " (desligada)."));
    } catch (err) {
      setMensagem("Não foi possível salvar: " + (err as Error).message);
    }
    setSalvando(false);
  }

  const proximo = proximoDisparo(agenda);
  const pill = (ativo: boolean) =>
    `rounded-full px-3 py-1 text-[12px] font-semibold transition ${
      ativo
        ? "bg-vinho text-white dark:bg-blue-600"
        : "border border-black/[0.08] bg-white/80 text-apple-secondary hover:bg-white dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
    }`;
  const inputClass =
    "rounded-full border border-black/[0.08] bg-white/90 px-3 py-1.5 text-[12px] text-apple-title shadow-xs focus:border-vinho focus:ring-1 focus:ring-vinho dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-100";

  return (
    <section className="apple-glass-card mb-6 rounded-[22px] px-6 py-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-[15px] font-semibold text-apple-title">Agendamento na nuvem — {fonte === "jira" ? "Jira" : "TCE"}</h2>
        <label className="flex cursor-pointer items-center gap-2 text-[12px] font-medium text-apple-secondary">
          <input type="checkbox" checked={agenda.ativo} onChange={(e) => mudar({ ativo: e.target.checked })} className="h-4 w-4 accent-vinho" />
          Ativo
        </label>
        <span className={`text-[12px] font-semibold ${agenda.ativo ? "text-emerald-700 dark:text-emerald-400" : "text-apple-muted"}`}>
          {agenda.ativo ? (proximo ? "Próximo disparo: " + proximo : "Sem horários cadastrados") : "Desligado"}
        </span>
      </div>

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr_auto]">
        <div>
          <p className="mb-2 text-[11px] font-medium tracking-wider text-apple-muted uppercase">
            Horários do dia ({agenda.horarios.length})
          </p>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {agenda.horarios.length === 0 && (
              <span className="text-[12px] font-medium text-amber-700 dark:text-amber-400">Nenhum horário ainda — adicione um por um ou gere a série abaixo.</span>
            )}
            {agenda.horarios.map((h) => (
              <span key={h} className="flex items-center gap-1 rounded-full bg-black/[0.05] py-1 pr-1.5 pl-3 text-[12px] font-semibold text-apple-title dark:bg-white/10">
                {h}
                <button
                  type="button"
                  title={"Remover " + h}
                  onClick={() => mudar({ horarios: agenda.horarios.filter((x) => x !== h) })}
                  className="flex h-5 w-5 items-center justify-center rounded-full text-apple-muted hover:bg-black/10 hover:text-apple-title dark:hover:bg-white/15"
                >
                  ×
                </button>
              </span>
            ))}
            {agenda.horarios.length > 0 && (
              <button type="button" onClick={() => mudar({ horarios: [] })} className="text-[11px] font-medium text-apple-muted underline hover:text-apple-title">
                limpar
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-apple-secondary">
            <input
              type="time"
              value={novoHorario}
              onChange={(e) => setNovoHorario(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && adicionarHorario()}
              className={inputClass}
            />
            <button type="button" onClick={adicionarHorario} disabled={!novoHorario} className={pill(false) + " disabled:opacity-50"}>
              + Adicionar horário
            </button>
            <span className="mx-1 text-apple-muted">ou</span>
            de
            <input type="time" value={serie.de} onChange={(e) => setSerie({ ...serie, de: e.target.value })} className={inputClass} />
            até
            <input type="time" value={serie.ate} onChange={(e) => setSerie({ ...serie, ate: e.target.value })} className={inputClass} />
            a cada
            <select value={serie.intervalo} onChange={(e) => setSerie({ ...serie, intervalo: Number(e.target.value) })} className={inputClass}>
              <option value={15}>15 min</option>
              <option value={30}>30 min</option>
              <option value={60}>1 hora</option>
              <option value={120}>2 horas</option>
              <option value={180}>3 horas</option>
            </select>
            <button type="button" onClick={gerarSerie} disabled={!serie.de || !serie.ate} className={pill(false) + " disabled:opacity-50"}>
              Gerar horários
            </button>
          </div>
        </div>

        <div>
          <p className="mb-2 text-[11px] font-medium tracking-wider text-apple-muted uppercase">Dias</p>
          <div className="flex flex-wrap gap-1.5">
            {DIAS.map((nome, i) => (
              <button
                key={nome}
                type="button"
                onClick={() => mudar({ dias: agenda.dias.includes(i) ? agenda.dias.filter((d) => d !== i) : [...agenda.dias, i].sort() })}
                className={pill(agenda.dias.includes(i))}
              >
                {nome}
              </button>
            ))}
          </div>
        </div>

        {fonte === "tce" && (
          <div>
            <p className="mb-2 text-[11px] font-medium tracking-wider text-apple-muted uppercase">Competência inicial</p>
            <input
              value={agenda.competencia_inicio}
              onChange={(e) => mudar({ competencia_inicio: e.target.value.trim() })}
              placeholder="MM/AAAA"
              className={inputClass + " w-28"}
            />
          </div>
        )}
      </div>

      {fonte === "jira" && (
        <div className="mt-5">
          <p className="mb-2 flex flex-wrap items-center gap-3 text-[11px] font-medium tracking-wider text-apple-muted uppercase">
            Filtro do Jira (JQL)
            {agenda.jql.trim() !== JQL_PADRAO && (
              <button type="button" onClick={() => mudarFiltro(JQL_PADRAO)} className="text-[11px] font-medium tracking-normal normal-case underline hover:text-apple-title">
                voltar ao filtro padrão
              </button>
            )}
          </p>
          <textarea
            value={agenda.jql}
            onChange={(e) => mudarFiltro(e.target.value)}
            onBlur={() => timerFiltro.current && salvarFiltro(agenda.jql)}
            rows={4}
            spellCheck={false}
            className="w-full rounded-2xl border border-black/[0.08] bg-white/90 px-3 py-2 font-mono text-[11px] text-apple-title shadow-xs focus:border-vinho focus:ring-1 focus:ring-vinho dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <p className="mt-1 text-[11px] text-apple-muted">
            {estadoFiltro ?? "O filtro se salva sozinho ao editar — não precisa clicar em Salvar agenda."}
          </p>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={salvar}
          disabled={!alterado || salvando}
          className="rounded-full bg-gradient-to-b from-vinho-hover to-vinho px-4 py-1.5 text-[12px] font-semibold text-white shadow-apple-btn ring-1 ring-white/20 transition hover:brightness-105 disabled:opacity-50"
        >
          {salvando ? "Salvando..." : "Salvar agenda"}
        </button>
        {mensagem && <span className="text-[12px] font-medium text-apple-title">{mensagem}</span>}
        <span className="text-[11px] text-apple-muted">
          {fonte === "jira"
            ? "Cada disparo lê do Jira os chamados desse filtro e guarda no sistema; quem sai do filtro fica marcado como fechado."
            : "Cada disparo carrega da competência inicial até a vigente (mês anterior), sem depender de nenhum computador ligado."}
          {agenda.atualizado_por &&
            " Última alteração: " +
              agenda.atualizado_por +
              (agenda.atualizado_em ? " em " + agenda.atualizado_em.toDate().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "") +
              "."}
        </span>
      </div>
    </section>
  );
}

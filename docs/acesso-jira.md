# Como o BI eSfinge SC acessa os dados do Jira

Este documento explica como o sistema busca, guarda e mostra os chamados do Jira
Atendimento (`atendimento.betha.com.br`). A primeira parte é para quem usa ou
administra; o fim tem os detalhes técnicos.

> Este documento **não contém senhas nem códigos de acesso**. A credencial fica
> só no cofre do Google (Secret Manager) e nunca aparece no código, no Git ou no portal.

---

## 1. Visão geral

```
Agenda (portal) ──► Função na nuvem ──► Jira Atendimento ──► Banco (Firestore) ──► Telas do portal
 Controle de Cargas    relogioJira        /rest/api/2/search     coleção "chamados"    Chamados, Status por
 aba Jira              (a cada 5 min)                                                  Módulo, Ratificação, Início
```

- **Quem busca:** uma função no Google Cloud (Cloud Functions, região São Paulo).
  Não depende de computador ligado, extensão ou planilha.
- **Com que usuário:** o **usuário de serviço** do Jira (exibido como "Ação
  Automática"), o mesmo dos scripts do Google que já consultam esse Jira. Não usa a
  senha pessoal de ninguém.
- **O que busca:** os chamados do **filtro (JQL)** cadastrado no portal.
- **Onde guarda:** no banco do próprio sistema. Só quem entra com conta
  `@betha.com.br` consegue ver.

---

## 2. Onde administrar (portal)

**Administração → Controle de Cargas → aba "Jira (chamados)"**

| O quê | Como funciona |
|---|---|
| **Ativo** | Liga/desliga a carga automática. Grava na hora. |
| **Horários do dia** | Quando a carga roda. Dá para gerar uma série ("de 07:00 até 19:00 a cada 15 min"). Precisa clicar em **Salvar agenda**. |
| **Dias** | Dias da semana em que a agenda vale. Precisa clicar em **Salvar agenda**. |
| **Filtro do Jira (JQL)** | Quais chamados entram. **Salva sozinho** ao editar e vale a partir da próxima carga. "voltar ao filtro padrão" restaura o original. |
| **Rodar na nuvem agora** | Roda uma carga na hora (só administrador). |
| **Histórico** | Cada carga mostra início/fim, duração, status, quantos chamados vieram no filtro, quantos são novos, quantos saíram e quantos foram resolvidos, além dos alertas. |

Regras da agenda:
- Cada horário dispara **uma vez por dia**.
- Um horário que passou há mais de **60 minutos** sem disparar (função fora do ar, por exemplo) é pulado.
- Nunca rodam duas cargas do Jira ao mesmo tempo. Se uma estiver em andamento, a outra é pulada.

---

## 3. O que acontece em cada carga

1. **Abre uma sessão no Jira** com o usuário de serviço (`/rest/auth/1/session`),
   igual aos scripts do Google.
2. **Busca os chamados do filtro** (`/rest/api/2/search`), de 100 em 100, até trazer todos.
3. **Traduz cada chamado** para o formato das telas: chave, assunto, situação,
   responsável, prioridade, tipo, município, entidade, área, equipe, funcionalidade e SLO.
4. **Grava no banco** (`chamados/{chave}`):
   - quem está no filtro fica `aberto = sim`;
   - quem **saiu do filtro** desde a última carga **não é apagado**. O sistema
     pergunta ao Jira como o chamado está agora e marca `aberto = não`, com a data e o motivo:
     - `resolvido`: foi resolvido ou concluído;
     - `aguardando`: foi para um status "Aguardando…";
     - `fora_do_filtro`: mudou de forma que não entra mais no filtro;
     - `nao_encontrado`: não existe mais no Jira.
5. **Registra a carga** no histórico (Controle de Cargas), com totais e alertas.

**Alertas** que podem aparecer:
- chamado **sem município**;
- município que **não existe no cadastro** do sistema (o chamado não cruza com as telas);
- o Jira trouxe **menos chamados** do que informou;
- **credencial recusada** (ver item 6).

---

## 4. Onde os chamados aparecem

| Tela | Uso |
|---|---|
| **Chamados** | Lista dos abertos, cruzada com o status do módulo e com a ratificação da competência. O rodapé mostra o filtro em uso e a hora da última carga. |
| **Status por Módulo** | Ícone de chamado ao lado do módulo do município (vermelho = SLO estourado). |
| **Ratificação Geral** | Ícone de chamado ao lado do município. |
| **Início** | Indicador de chamados abertos e com SLO estourado. |

A ligação com os módulos é feita pela **área** do chamado:

| Área no Jira | Módulo |
|---|---|
| Pessoal | Folha |
| Arrecadação | Tributos |
| Contratos | Contratos |
| Contábil | Contábil |

O município do chamado é comparado com o cadastro pelo **nome** (sem acento e sem
diferenciar maiúsculas de minúsculas).

---

## 5. Filtro padrão

O filtro que vem por padrão pega os chamados **abertos** de prestação de contas das
**Pequenas e Médias Contas**. Ele inclui e-Sfinge, SIOPE, SIOPS, SICONFI (MSC/DCA),
eSocial/EFD-Reinf, SisObra, PNCP e a etiqueta `PrestacaoDeContas`, nas equipes
Suporte, Serviço e Serviços Especializados. Ficam de fora:
- o tipo Melhoria;
- os status "Aguardando aprovação do solicitante", "Aguardando solicitante",
  "Aguardando negociação" e "Aguardando dependência".

O texto completo fica em `src/lib/jira-jql.ts` e aparece no próprio portal.

---

## 6. Credencial do Jira

- Fica no **Secret Manager** do Google Cloud, com o nome **`JIRA_CREDENCIAL`**:
  https://console.cloud.google.com/security/secret-manager?project=bi-esfingesc
- Formatos aceitos (qualquer um):
  - a linha do script: `headers: { Authorization: "Basic CODIGO" },`
  - só o código: `CODIGO`
  - usuário e senha: `{"usuario":"…","senha":"…"}`
- **Para trocar:** abra o secret → **Nova versão** → cole o valor novo. A próxima
  carga já usa a versão nova, sem precisar mexer no código.
- **Cuidado:** o código Base64 **não é criptografia**. Qualquer um transforma de
  volta em usuário e senha, então trate como senha e nunca cole em chat, e-mail ou documento.
- **Jira recusou a credencial:** este Jira responde a uma senha errada com uma
  página vazia e o aviso `AUTHENTICATED_FAILED`. O portal mostra
  "Jira recusou a credencial…". Confira o secret.
- **Muitas tentativas erradas** fazem o Jira pedir **CAPTCHA** para o usuário
  (`AUTHENTICATION_DENIED`), e aí nem a senha certa funciona. Para liberar, entre
  uma vez pelo navegador com esse usuário. Enquanto a credencial estiver errada,
  deixe a agenda desligada.
- Este Jira **não tem tokens pessoais de acesso** (o endereço `/rest/pat` não
  existe). Por isso o acesso é feito com o usuário de serviço.

---

## 7. Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| A agenda não rodou | **Ativo** desmarcado, ou o dia/horário fora da agenda | Marque **Ativo** e confira "Próximo disparo" |
| "Jira recusou a credencial" | Senha do usuário de serviço trocada, ou código errado no secret | Atualize o `JIRA_CREDENCIAL` |
| A carga usou o filtro antigo | Filtro editado antes da última atualização do portal | Edite de novo: agora ele salva sozinho |
| "Jira respondeu 400" | Erro de sintaxe no filtro (JQL) | Teste o filtro na busca do próprio Jira e corrija |
| Chamado não aparece no Status por Módulo | Município fora do cadastro ou área sem módulo | Veja os alertas da carga |
| Telas sem chamados | Nenhuma carga do Jira com sucesso ainda | Clique em **Rodar na nuvem agora** |

---

## 8. Detalhes técnicos

| Item | Valor |
|---|---|
| Código | `functions/src/jira.js` (busca, tradução, gravação); `functions/src/index.js` (`relogioJira`, `rodarJiraAgora`); `functions/src/agenda.js` (regra dos horários) |
| Funções | `relogioJira` (Cloud Scheduler a cada 5 min, 256 MiB, até 9 min) e `rodarJiraAgora` (`onCall`, só `ADMIN_GERAL`) |
| Endpoints do Jira | `GET /rest/auth/1/session` (sessão) · `POST /rest/api/2/search` (`maxResults` 100, `validateQuery` `true`, ou `false` na busca `key in (…)`) |
| Agenda | `config/agenda_jira`: `ativo`, `horarios`, `dias`, `jql` (lido por todos, alterado só por admin) |
| Estado interno | `config/carga_jira`: `em_andamento_desde` (trava de 30 min) e `disparos_dia` (só a função acessa) |
| Chamados | `chamados/{chave}` (formato curto `k, s, st, sc, a, p, t, c, u, f, pf, v, e, m, eq, br, rem, paused`), mais `aberto`, `primeira_vez_em`, `visto_em`, `saiu_em`, `motivo_saida`, `status_saida`, `resolucao` e `resolvido_em` |
| Histórico | `cargas/{id}` com `fonte: "jira"`; totais `no_filtro`, `total_jira`, `novos`, `atualizados`, `sairam`, `resolvidos` |
| Leitura no portal | `carregarChamados()` em `src/lib/chamados.ts` (chamados com `aberto == true`, mais a última carga do Jira com sucesso) |
| Teste | `node functions/teste-jira.mjs` (tradução, SLO e formatos da credencial) |

**Campos do Jira usados:**

| Campo | Significado |
|---|---|
| `summary`, `status`, `assignee`, `priority`, `issuetype`, `created`, `updated`, `resolution`, `resolutiondate` | padrão do Jira |
| `customfield_10331` | Município (se vier vazio, é tirado da Entidade) |
| `customfield_10202` | Entidade |
| `customfield_32400` | Portfólio de Atendimento |
| `customfield_10335` | Funcionalidades |
| `customfield_10300` | Vertical (área) |
| `customfield_21500` | Equipe responsável |
| `customfield_24813` | SLO de Atendimento (`ongoingCycle`/`completeCycles`: estourado, pausado, tempo restante) |

**Publicar mudanças:**

```bash
npm --prefix functions run build
firebase deploy --only functions:relogioJira,functions:rodarJiraAgora
```

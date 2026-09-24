# BI eSfinge SC

Ferramenta interna da Betha para acompanhar o envio de dados e as ratificações
dos 295 municípios catarinenses ao TCE-SC (Tribunal de Contas do Estado de
Santa Catarina, sistema e-Sfinge). Substitui planilhas manuais por um painel
único, alimentado por uma extensão de Chrome que captura os dados nos painéis
do TCE e grava no Firestore.

- **Produção:** https://bi-esfingesc.web.app (Firebase Hosting)
- **Repositório:** https://github.com/emanuelmelo87/bi-esfingesc
- **Acesso:** somente contas Google `@betha.com.br`

> Estado descrito aqui: setembro/2026.

---

## Como funciona (visão geral)

```
 Painéis do TCE-SC                 Extensão Chrome                 Firestore              App web
 ──────────────────                ────────────────                ─────────              ───────
 CND pública (DOM)      ──┐
 Ratificações (Qlik     ──┼──>  progress.js captura,  ──>  status_operacional_atual  ──>  Telas de
   público, WebSocket)    │     compara com o banco,       status_por_competencia         consulta
 Módulos (Qlik restrito ──┘     grava e registra           snapshots_diarios              (somente
   + login TCE Virtual)          movimentações              movimentacoes, cargas          leitura*)
```

O app web **não coleta nada**: só lê o que a extensão gravou e complementa com
a classificação manual dos municípios (fornecedor, canal, associação).
\* Exceções de escrita no app: cadastro de municípios, usuários e "Apagar
competência" (todos restritos a admin).

---

## Stack

- **Next.js 16** (App Router, Turbopack) + **React 19** + **TypeScript** estrito
- **Tailwind CSS v4** (tokens via `@theme` em `src/app/globals.css`)
- **Firebase**: Auth (Google), Firestore (plano **Blaze**) e Hosting
- **Recharts** para os gráficos (Home e Evolução)
- Build **estático** (`output: "export"` em `next.config.ts`): toda leitura de
  dados é feita no navegador pelo SDK do Firebase, não há servidor
- Extensão Chrome Manifest V3 (`Extencao-BIEsfinge/`), empacotada com esbuild

---

## Telas

Todas as telas buscam os dados **uma vez ao abrir** e têm botão **Atualizar**
(ícone ↻). Não há atualização ao vivo: depois de rodar uma carga, clique em
Atualizar ou recarregue a página. Todas mostram no cabeçalho o total de
registros do filtro atual e, onde há filtro de fornecedor, ele vem em
**Betha** por padrão.

### Para todos os usuários

| Tela | Rota | Status | O que mostra |
|---|---|---|---|
| Início | `/` | Em produção | Painel da competência escolhida (‹ ›, abre na mais recente), com filtros de fornecedor (Betha), canal e associação valendo pra página toda. Faixa com a última carga, quando o TCE atualizou, quando a CND foi consultada e alertas. Indicadores clicáveis: ratificação geral, módulos completos, falta só ratificar, chamados abertos (SLO estourado) e CND irregular. Lista "Precisam de atenção" (municípios com mais pendências), a ratificar por canal, últimas movimentações e gráficos por competência. Mesmas regras de Status por Módulo (`todosModulosOk` em `src/lib/ratificacao.ts`). |
| Status por Módulo | `/matriz` | Em produção | Por competência (navegação ‹ ›): Ratificação Geral, Ratificação por Módulo e o status de Contábil, Folha, Contratos e Tributos por município. Filtros de busca, fornecedor, canal, associação e filtros SIM/NÃO nas colunas de ratificação. Linha em âmbar = todos os módulos OK mas ratificação geral ainda não concluída. Passar o mouse num "Pendente" mostra o campo/entidade que falta. Exporta CSV. |
| Ratificação Geral | `/ratificacao-geral` | Em produção | Grade município × competência com a situação da ratificação geral (Ratificado / Enviado fora do prazo / Ausente) e a data de envio. Filtro SIM/NÃO por coluna de competência, busca, fornecedor, canal, associação. Exporta CSV. |
| CND | `/cnd` | Em produção | Aba **Geral**: situação e validade da CND dos 295 municípios, com filtros. Aba **Ranking (Hab.)**: Top 10 / Top 30 municípios por população, com filtro de empresa de software. Exporta CSV. |
| Evolução | `/evolucao` | Em produção | A partir dos snapshots diários: curva S de % de municípios concluídos por dia (com opção de sobrepor o mês anterior), volume diário de fechamentos e linha do tempo por município. "Concluído" = ratificação enviada. |
| Chamados | `/chamados` | Em produção (novo) | Chamados abertos de e-Sfinge do Jira Atendimento (Pequenas e Médias Contas), lidos do arquivo público do painel externo (`src/lib/chamados.ts`). O cabeçalho mostra o filtro (JQL) que gera a lista, traduzido por campo, e quando o arquivo foi gerado. Cruza cada chamado com o status do módulo da mesma área (Pessoal→Folha, Arrecadação→Tributos, Contratos, Contábil) e a ratificação geral da competência mais recente. Filtros de município/chamado, fornecedor, área, SLO e módulo. Em Status por Módulo e Ratificação Geral, um ícone ao lado do módulo/município indica chamado aberto (vermelho se o SLO estourou). |
| Movimentações | `/movimentacoes` | Em produção (novo) | O que mudou em cada carga: **Envio** (passou a constar como enviado, inclusive o que ainda não existia no banco), **Remoção** (estava enviado e deixou de estar, ex.: ratificou e depois removeu) e **Alteração** (continua enviado, mas mudou situação ou data). Nos módulos, compara também **item a item** (ex.: "Execução Orçamentária (Prefeitura)"), o que pega o envio parcial que não muda o status da área. Mostra antes → depois, competência e horário. Filtros de município, fornecedor, movimento, campo, nível (área ou item) e competência. Lista as 1000 mais recentes. Começa a ser preenchida a partir da primeira carga feita com a extensão atualizada. |

### Somente admin (`ADMIN_GERAL`)

| Tela | Rota | Status | O que faz |
|---|---|---|---|
| Municípios | `/admin/municipios` | Em produção | Classifica fornecedor/canal/associação por município. Botões **Importar Planilha** (`src/data/clientes-betha.json`), **Importar População (Top 30)** (`src/data/populacao-top30.json`) e **Recarregar IBGE** (repõe a lista oficial de SC sem apagar a classificação manual). |
| Usuários | `/admin/usuarios` | Em produção | Altera perfil e ativa/desativa usuários. |
| Permissões | `/admin/permissoes` | Informativa | Grade de referência dos 4 perfis (ver RBAC abaixo). |
| Controle de Cargas | `/admin/cargas` | Em produção (novo) | Histórico de cada execução da extensão: quando terminou, tipo (sincronização/backfill), período, quem rodou, duração, sucesso/erro (passe o mouse no "Erro" para ver o motivo) e quantos documentos foram gravados por fonte, incluindo quantas movimentações a carga gerou. |

Também restrito a admin: botão **Apagar competência** em Status por Módulo e
Ratificação Geral (remove todos os documentos daquela competência de
`status_por_competencia`).

---

## Extensão Chrome (`Extencao-BIEsfinge/`)

Nome no Chrome: **BI Esfinge SC**. O painel lateral se chama **Carga de dados**.

### Instalação e atualização

1. `cd Extencao-BIEsfinge && npm install && npm run build` (gera `progress.js`
   a partir de `src/progress.js`).
2. `chrome://extensions` → modo desenvolvedor → **Carregar sem compactação** →
   pasta `Extencao-BIEsfinge/`.
3. **Após qualquer alteração ou `git pull`, clique em recarregar (↻) em
   `chrome://extensions`** — o Chrome não pega o build novo sozinho.

### Painel lateral

- **Login Google** (`@betha.com.br`): a extensão grava no Firestore como o
  usuário logado.
- **Execução**: "Sincronizar agora". Com as competências em branco roda a
  sincronização normal; preenchendo inicial/final (MM/AAAA) roda um backfill do
  período. Os últimos valores usados ficam salvos.
- **Agendamento**: horários e dias da semana para disparo automático
  (`chrome.alarms`), opcionalmente com um período de backfill fixo.
- **Conta TCE**: lista de credenciais (matrícula + senha) do TCE Virtual,
  usadas só para a captura de módulos. Se o login falhar com uma, a extensão
  tenta a próxima automaticamente. Ficam salvas **sem criptografia** no
  `chrome.storage.local` daquele navegador.

### O que cada modo captura e grava

| Fonte | Como é capturada | Sincronização normal | Backfill (período) |
|---|---|---|---|
| CND | Scraping da consulta pública em aba oculta | `status_operacional_atual` | Só se o período incluir a competência vigente (mês anterior) |
| Ratificação Geral | WebSocket no Qlik público (objeto pivot `a76276a9-…`, que traz data e cor por célula, inclusive da competência em curso) | competência do mês anterior → `status_operacional_atual` + `status_por_competencia` | cada competência do período → `status_por_competencia` |
| Módulos (Contábil/Folha/Contratos/Tributos) | Login no TCE Virtual → ticket Qlik (pedido de novo a cada competência, é de uso único) → WebSocket no Qlik restrito | idem ratificação | idem ratificação |
| Snapshot diário | Cópia de `status_operacional_atual` | `snapshots_diarios` | Só se o período incluir a competência vigente |

Backfill cujo período inclui a competência vigente (mês anterior) faz também o que a sincronização normal faz: captura a CND, atualiza `status_operacional_atual` e grava a foto do dia (`atualizarEstadoAtual` em `src/progress.js`). Assim, quem só usa o backfill não deixa a CND, a Início e a Evolução paradas.

**Alertas de mudança no TCE:** cada captura confere se o que veio ainda tem o
formato esperado e registra um alerta quando não tem — por exemplo, competência
que não aparece no painel, cor de célula ou valor de ratificação fora do
padrão, bem menos de 295 municípios, todas as CNDs como "regular" (texto de
irregularidade mudou), módulo com nome novo fora das regras (avisado uma vez por
nome), tela de login do TCE Virtual diferente, ou nenhum acesso ao painel
restrito após as tentativas. O alerta aparece no log, numa notificação do
sistema, como "!" vermelho no ícone da extensão, no cartão "Última execução" do
painel e no Controle de Cargas ("Sucesso · N alertas"); Movimentações mostra
quantos alertas teve a última carga.

Em toda carga, **antes de gravar**, a extensão compara o capturado com o que já
está no banco e grava as diferenças em `movimentacoes`; ao final (sucesso ou
erro) grava um registro em `cargas`. A aba `progress.html` mostra o log
completo da execução.

### Regras de negócio

- **Ratificação**: classificada pela cor da célula no painel do TCE — azul =
  `quitado` (Ratificado, no prazo), vermelho = `atrasado` (enviado fora do
  prazo), "Ausente" = `ausente`. `quitado` e `atrasado` contam como enviado.
- **Módulos**: cada área agrega campos do Qlik de extratos
  (`REGRAS_MODULO` em `src/progress.js`), por tipo de entidade (Prefeitura,
  Câmara, Controle Interno…). Ex.: Assinatura Balancete = exatamente 2 pacotes;
  demais = ao menos 1 pacote. Área `ok` se todos os campos aplicáveis passam,
  senão `pendente` (com a lista de pendências).
- **Contratos** não existe no TCE: usa como substituto "Situações de
  Obras/Serviços de Engenharia em Atraso" (ok = 0 em atraso).
- **Ratificação Geral prevalece**: se a ratificação geral está concluída, a
  tela Status por Módulo mostra os 4 módulos como OK e "Ratificação por
  Módulo" = SIM, mesmo que as regras acima apontem pendência.

---

## Modelo de dados (Firestore)

| Coleção | Doc ID | Quem grava | Conteúdo |
|---|---|---|---|
| `municipios` | `codigo_ibge` | App (admin) / scripts | Nome, fornecedor, canal, associação (FECAM), população, empresa |
| `status_operacional_atual` | `codigo_ibge` | Extensão (sync normal) | Estado atual: CND, ratificação, módulos |
| `status_por_competencia` | `AAAA-MM_codigoIbge` | Extensão (sync e backfill) | Ratificação e módulos de cada competência |
| `snapshots_diarios` | `AAAA-MM-DD_codigoIbge` | Extensão (sync normal) | Cópia diária do estado atual (tela Evolução) |
| `movimentacoes` | automático | Extensão | Uma diferença detectada: município, competência, campo, tipo, antes/depois, `carga_id` |
| `cargas` | automático | Extensão | Uma execução: início/fim, tipo, período, usuário, duração, status, totais |
| `usuarios` | `email` | App | Perfil, canal primário, ativo, último login |
| `atribuicoes_municipios` | `codigo_ibge` | — | Legado da antiga tela Pipeline, não usado mais pelo código |

Tipos em `src/types/*.ts`. Regras de acesso em `firestore.rules`.

---

## Autenticação e perfis (RBAC)

Login Google restrito a `@betha.com.br`. No primeiro acesso o usuário é criado
em `usuarios/{email}` com perfil `LEITURA`; usuário desativado perde o acesso.

| Perfil | Telas de consulta | Telas e ações de admin |
|---|---|---|
| `ADMIN_GERAL` | Sim | Sim |
| `GESTOR_CANAL` | Sim | Não |
| `ANALISTA` | Sim | Não |
| `LEITURA` | Sim | Não |

Aplicado de fato: bloqueio das telas/ações de admin para quem não é
`ADMIN_GERAL` (no app e nas regras do Firestore para `municipios`). A
diferença entre `GESTOR_CANAL`, `ANALISTA` e `LEITURA` ainda não tem efeito
(escopo por canal está planejado).

---

## Rodando localmente

```bash
npm install
npm run dev          # http://localhost:3000
```

Variáveis do Firebase em `.env.local` (modelo em `.env.example`).

### Publicar

```bash
npm run build                                     # gera out/
firebase deploy --only hosting                    # app
firebase deploy --only firestore:rules            # quando mudar firestore.rules
```

### Scripts (`scripts/`)

Precisam de uma service account do Firebase (fica fora do Git, em
`DadosChavesProjetos/` ou `service-account*.json`):

```bash
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/seed-municipios.mjs     # semeia municipios pela API do IBGE
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/seed-admin.mjs          # cria o primeiro ADMIN_GERAL
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/limpar-competencia.mjs MM/AAAA   # apaga uma competência
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/remover-prioridade.mjs  # one-off, limpeza de campo antigo
```

---

## Estrutura de pastas

```
src/
  app/
    page.tsx                  # Início
    matriz/                   # Status por Módulo
    ratificacao-geral/        # Ratificação Geral
    cnd/                      # CND (Geral + Ranking)
    evolucao/                 # Evolução
    movimentacoes/            # Movimentações
    admin/                    # municipios, usuarios, permissoes, cargas + layout (gate de admin)
  components/                 # RequireAuth (menu lateral + login), StatusBadge, ContadorResultados, ícones…
  lib/                        # firebase, auth-context, ratificacao, competencia, csv
  types/                      # tipos das coleções
  data/                       # planilhas importáveis (clientes Betha, população)
scripts/                      # utilitários com firebase-admin
Extencao-BIEsfinge/
  src/progress.js             # toda a captura, comparação e gravação (fonte)
  progress.js                 # build gerado pelo esbuild (commitado; é o que o Chrome carrega)
  sidepanel.html/.js          # painel "Carga de dados"
  background.js               # abre o painel e dispara o agendamento
firestore.rules, firebase.json, next.config.ts
```

---

## Limitações conhecidas e pendências

- **Regras de módulos não são oficiais**: foram deduzidas dos extratos do TCE;
  "Contratos" usa um substituto. Por isso a Ratificação Geral prevalece na tela.
- **Captura de módulos depende do login no TCE Virtual**: sem credencial válida
  a carga segue só com CND e ratificação. O TCE falha de forma intermitente
  (ticket Qlik vazio, sessão que devolve só 1 município): cada etapa (CND,
  ratificação, ticket, módulos) é repetida até 5 vezes com espera crescente,
  com ticket novo a cada tentativa; módulos com menos de 200 municípios contam
  como falha. Toda aba aberta pela carga é fechada no fim, e a aba do log fecha
  sozinha 10s depois de uma carga bem-sucedida.
- **Movimentações**: um município ausente numa captura parcial não vira
  remoção; mas um município capturado com dados incompletos pode gerar uma
  "Remoção" falsa. A primeira carga de uma competência nova gera muitos
  "Envio" de uma vez (é o que ainda não estava no banco).
- **Evolução** depende de `snapshots_diarios`, gravados pela sincronização
  normal e pelo backfill que inclui a competência vigente. A data do snapshot é
  em UTC e pode cair no dia vizinho perto da meia-noite.
- As coleções operacionais aceitam escrita de qualquer usuário `@betha.com.br`,
  porque a extensão grava como o usuário logado.
- Credenciais do TCE ficam sem criptografia no navegador onde a extensão roda.
- A coleção `atribuicoes_municipios` é legado e pode ser removida.

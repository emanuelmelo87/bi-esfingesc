# BI eSfinge SC

Ferramenta interna da Betha para acompanhar o envio de dados e as ratificações
dos municípios catarinenses ao TCE-SC (Tribunal de Contas do Estado de Santa
Catarina). Substitui planilhas manuais por um painel único, alimentado
automaticamente por uma extensão de navegador que sincroniza dados dos
sistemas de origem para o Firestore.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS v4** (tokens via `@theme` em `src/app/globals.css`)
- **Firebase**: Auth (Google, restrito a `@betha.com.br`) + Firestore (banco de dados) + Hosting
- **Recharts** para os gráficos da tela de Evolução
- Extensão de navegador própria (`Extencao-BIEsfinge/`) que sincroniza os dados de origem para o Firestore

## Estrutura de pastas

```
src/
  app/
    page.tsx                 # Home — KPIs e alertas críticos
    pipeline/page.tsx         # Pipeline operacional (295 municípios)
    matriz/page.tsx           # Matriz de Módulos & CND
    evolucao/page.tsx         # Evolução temporal (gráficos)
    admin/
      municipios/page.tsx     # Cadastro/import de municípios (admin)
      usuarios/page.tsx       # Gestão de usuários e perfis (admin)
      permissoes/page.tsx     # Matriz de permissões (RBAC, informativa)
      layout.tsx               # Gate de admin (bloqueia não-ADMIN_GERAL)
    layout.tsx                 # Layout raiz (fontes, tema, AuthProvider)
  components/
    RequireAuth.tsx            # Sidebar + header + gate de login
    ThemeToggle.tsx             # Alternador de tema (pill + versão compacta)
    icons.tsx                   # Ícones SVG usados na sidebar
    StatusBadge.tsx, StatTile.tsx, ProportionBar.tsx
  lib/
    firebase.ts                 # Inicialização do Firebase (client SDK)
    auth-context.tsx            # Contexto de autenticação + perfil do usuário
    csv.ts                       # Exportação de tabelas em CSV
  types/                         # Tipos das coleções do Firestore
  data/
    clientes-betha.json          # Fornecedor/Canal/Associação por município (fonte: planilha)
scripts/
  seed-municipios.mjs            # Semeia `municipios` a partir da API do IBGE (SC)
  seed-admin.mjs                 # Cria o primeiro usuário ADMIN_GERAL
Extencao-BIEsfinge/               # Extensão de navegador que alimenta o Firestore
```

## Autenticação e perfis (RBAC)

Login exclusivo via Google, restrito a e-mails `@betha.com.br`. No primeiro
login, o usuário é criado em `usuarios/{email}` com perfil `LEITURA`.

| Perfil | Pode ver Pipeline/Matriz/Evolução | Editar em lote no Pipeline | Telas de Admin |
|---|---|---|---|
| `ADMIN_GERAL` | Sim | Sim | Sim |
| `GESTOR_CANAL` | Sim | Sim | Não |
| `ANALISTA` | Sim | Sim | Não |
| `LEITURA` | Sim | Não | Não |

Hoje, de fato aplicado no código: bloqueio das telas de Admin pra quem não é
`ADMIN_GERAL`, e bloqueio de edição em lote pra `LEITURA`. A distinção fina
entre `GESTOR_CANAL` e `ANALISTA` (ex.: escopo por canal) ainda é só
informativa — ver `/admin/permissoes`.

Regras de acesso ao banco em `firestore.rules`.

## Telas

- **Home (`/`)** — KPIs (cobertura estadual, alertas fiscais, cronograma,
  distribuição interna, fornecedor/canal) e tabela de municípios com
  inconsistências críticas.
- **Pipeline (`/pipeline`)** — tabela dos 295 municípios com Fornecedor, Canal,
  Associação, CND, Ratificação, Analista e Etapa. Filtros por Canal,
  Fornecedor, Etapa e Associação. Seleção em lote pra atribuir
  analista/equipe/etapa. Campo de **Competência** com sugestão das
  competências já existentes no banco — ao selecionar uma, a tabela mostra o
  histórico daquele mês e a Ratificação vira editável (grava em
  `status_por_competencia`). Exporta CSV.
- **Matriz de Módulos & CND (`/matriz`)** — status por área (Contábil, Folha,
  Contratos, Tributos) e contagem regressiva de validade da CND, por
  município. Filtros por Fornecedor, Canal, Associação e categoria de CND
  (Irregular/Vencida/Vencendo em 15d/Regular/Sem dado). Exporta CSV.
- **Evolução (`/evolucao`)** — curva S de % de municípios concluídos por mês
  e volume diário de fechamentos, a partir dos snapshots diários.
- **Admin → Municípios** — classifica Fornecedor/Canal por município,
  botão **Importar Planilha** (lê `data/clientes-betha.json` e casa por nome
  normalizado) e **Recarregar IBGE** (repopula a lista oficial de municípios
  de SC, sem sobrescrever a classificação manual).
- **Admin → Usuários** — gerencia perfil e status ativo/inativo de cada
  usuário.
- **Admin → Permissões** — grade de referência dos 4 perfis (ver tabela acima).

## Modelo de dados (Firestore)

| Coleção | Doc ID | Descrição |
|---|---|---|
| `municipios` | `codigo_ibge` | Nome, fornecedor, canal, sigla/associação regional (FECAM), flag de monitoramento |
| `status_operacional_atual` | `codigo_ibge` | Estado atual: CND, ratificação, módulos, analista, equipe, etapa do pipeline |
| `status_por_competencia` | `AAAA-MM_codigoIbge` | Histórico mensal de ratificação, gravado pela extensão (e editável manualmente pela tela de Pipeline) |
| `snapshots_diarios` | — | Snapshots diários usados pela tela de Evolução |
| `usuarios` | `email` | Perfil (RBAC), canal primário, status ativo |
| `atribuicoes_municipios` | `codigo_ibge` | Atribuição de analista/equipe por município |

Tipos completos em `src/types/*.ts`.

## Identidade visual

- Cor de marca: **azul Betha `#0861FF`** (extraído do logo oficial), com
  `#409cff` como tom claro/hover. Token Tailwind `vinho`/`vinho-hover` em
  `globals.css` (nome histórico, valor já atualizado pra azul).
- Navegação em **sidebar de ícones** fixa e sempre escura (`RequireAuth.tsx`),
  com tooltip por item, destaque da rota ativa e alternador de tema
  compacto. Abaixo de `lg`, vira header + menu dropdown.
- Logo: marca oficial da Betha (`public/betha-mark.png`).

## Rodando localmente

```bash
npm install
npm run dev
```

Variáveis de ambiente do Firebase em `.env.local` (ver `.env.example`).

### Scripts utilitários (`scripts/`)

Precisam de uma service account do Firebase:

```bash
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/seed-municipios.mjs
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/seed-admin.mjs
```

## Extensão de navegador

`Extencao-BIEsfinge/` é a fonte primária dos dados operacionais (CND,
ratificação, módulos, snapshots diários) — ela sincroniza os sistemas de
origem direto pro Firestore usado por este app. O app web não duplica essa
lógica de coleta, só lê e complementa (classificação manual de
fornecedor/canal, atribuições, edição pontual de competências).

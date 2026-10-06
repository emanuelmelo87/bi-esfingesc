// Filtro (JQL) padrão da carga do Jira — o recorte de prestação de contas das
// Pequenas e Médias Contas. Usado pela função na nuvem (functions/src/jira.js)
// quando a agenda do Jira não tem filtro próprio, e mostrado no portal.
export const JQL_PADRAO =
  'cf[32400] in ("Portfólio Pequenas Contas", "Portfólio Médias Contas") AND (cf[10335] in ("Geração arquivos TCE-SC (e-Sfinge)", ' +
  'E-Sfinge, "Integração e-Sfinge", "TCE-SC - e-Sfinge", "Prestação de Contas e-Sfinge", "e-SFINGE - UG", "e-SFINGE - Planejamento", ' +
  '"TCE-SC - e-SFINGE", "e-SFINGE - CI", "e-SFINGE UG", "e-SFINGE WebService - 2016", "e-SFINGE - CI - 2011", SIOPE, SIOPS, ' +
  '"Arquivo da Matriz de Saldos Contábeis - MSC (SICONFI)", "Arquivo da Declaração de Contas Anuais - DCA (SICONFI)", ' +
  '"eSocial - EFD-Reinf", "Envio SisObra", "Relação de Comprovantes do EFD-Reinf", "Geração do arquivo do SIOPE", ' +
  '"Interação com o Portal Nacional de Contratações Públicas", "Interação com o Portal Nacional de Contratações Pública") ' +
  "OR labels = PrestacaoDeContas) AND statusCategory != Done AND issuetype != Melhoria AND cf[21500] in (Suporte, Serviço, " +
  '"Serviços Especializados") AND status not in ("Aguardando aprovação do solicitante", "Aguardando solicitante", ' +
  '"Aguardando negociação", "Aguardando dependência")';

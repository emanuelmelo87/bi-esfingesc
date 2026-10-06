// Funções que rodam DENTRO das páginas do TCE (injetadas numa aba pela
// extensão, ou via page.evaluate na carga em nuvem). Autocontidas: são
// serializadas com toString(), então não podem usar nada de fora do próprio corpo.

export function extractCNDPublico() {
  var rows = Array.from(document.querySelectorAll("tbody tr"));
  return rows
    .map(function (tr) {
      var cells = tr.querySelectorAll("td");
      if (cells.length < 5) return null;
      var ente = (cells[0].innerText || "").trim();
      var bimestre = (cells[1].innerText || "").trim();
      var certidaoTexto = (cells[2].innerText || "").trim();
      var validade = (cells[3].innerText || "").trim();
      var labelEl = cells[4].querySelector(".p-tag-label");
      var numero = (labelEl ? labelEl.innerText : "").trim().replace("● ", "");
      return {
        ente: ente,
        bimestre: bimestre,
        status: certidaoTexto.indexOf("Falta de Dados") >= 0 ? "irregular" : "regular",
        validade: validade,
        numero: numero,
      };
    })
    .filter(Boolean);
}

export function extractRatificacoesGlobais(competenciaAlvo) {
  return new Promise(function (resolve, reject) {
    var appId = "0e41d18b-45c4-4fef-94d4-ec0eee70fe5b";
    var objectId = "a76276a9-7638-4c81-96a6-b504100f7457";
    var ws = new WebSocket("wss://paineistransparencia.tce.sc.gov.br/app/" + appId);
    var msgId = 1;
    var ALTURA_PAGINA = 100;

    function call(method, handle, params) {
      return new Promise(function (res, rej) {
        var id = msgId++;
        function onMsg(e) {
          var d = JSON.parse(e.data);
          if (d.id !== id) return;
          ws.removeEventListener("message", onMsg);
          if (d.error) rej(new Error(JSON.stringify(d.error)));
          else res(d.result);
        }
        ws.addEventListener("message", onMsg);
        ws.send(JSON.stringify({ jsonrpc: "2.0", id: id, method: method, handle: handle, params: params }));
      });
    }

    // Cor da célula (qAttrExps) além do texto — mais confiável que tentar
    // adivinhar "no prazo"/"fora do prazo" só pela data. RGB(51,102,255) =
    // azul (no prazo), RGB(255,51,51) = vermelho (fora do prazo); qualquer
    // outra cor com data presente cai em "atrasado" (mais seguro que
    // "ausente", já que existe uma data real).
    // Sinais de que o TCE mudou o painel, devolvidos pra quem chamou avisar:
    // cor ou texto de célula fora do padrão conhecido, competência não encontrada.
    var coresDesconhecidas = {};
    var valoresInesperados = {};
    var colunaEncontrada = false;
    var colunasVistas = [];
    function classificar(valor, cor) {
      if (valor === "Ausente") return "ausente";
      if (!/^\d{2}\/\d{2}\/\d{4}$/.test(valor)) valoresInesperados[valor] = true;
      if (cor && cor.indexOf("51,102,255") >= 0) return "quitado";
      if (cor && cor.indexOf("255,51,51") >= 0) return "atrasado";
      coresDesconhecidas[cor || "sem cor"] = true;
      return "atrasado";
    }

    ws.onerror = function () {
      reject(new Error("Falha ao conectar no WebSocket do Qlik."));
    };
    // Horário da última recarga do painel no TCE — os dados só mudam quando ele recarrega.
    var recarga = null;
    ws.onopen = function () {
      call("OpenDoc", -1, [appId])
        .then(function (openDoc) {
          var docHandle = openDoc.qReturn.qHandle;
          return call("GetAppLayout", docHandle, [])
            .then(function (app) { recarga = (app.qLayout && app.qLayout.qLastReloadTime) || null; })
            .catch(function () {})
            .then(function () { return call("GetObject", docHandle, [objectId]); });
        })
        .then(function (getObj) {
          var objHandle = getObj.qReturn.qHandle;
          return call("GetLayout", objHandle, []).then(function (layoutRes) {
            var tamanho = layoutRes.qLayout.qHyperCube.qSize;
            var totalColunas = tamanho.qcx;
            var totalMunicipios = tamanho.qcy;
            return call("GetHyperCubePivotData", objHandle, ["/qHyperCubeDef", [{ qTop: 0, qLeft: 0, qWidth: totalColunas, qHeight: 1 }]]).then(
              function (pagina0) {
                var colunas = pagina0.qDataPages[0].qTop;
                colunasVistas = colunas.slice(-3).map(function (c) { return c.qText; });
                var colIndex = -1;
                for (var i = 0; i < colunas.length; i++) {
                  if (colunas[i].qText === competenciaAlvo) {
                    colIndex = i;
                    break;
                  }
                }
                if (colIndex < 0) return [];
                colunaEncontrada = true;

                var linhas = [];
                function buscarPagina(top) {
                  var altura = Math.min(ALTURA_PAGINA, totalMunicipios - top);
                  return call("GetHyperCubePivotData", objHandle, ["/qHyperCubeDef", [{ qTop: top, qLeft: colIndex, qWidth: 1, qHeight: altura }]]).then(
                    function (dataPage) {
                      var pg = dataPage.qDataPages[0];
                      pg.qLeft.forEach(function (municipioNo, i) {
                        var cell = pg.qData[i] && pg.qData[i][0];
                        if (!cell) return;
                        var valor = cell.qText;
                        var cor = cell.qAttrExps && cell.qAttrExps.qValues[0] && cell.qAttrExps.qValues[0].qText;
                        linhas.push({
                          nomeMunicipio: municipioNo.qText,
                          situacao: classificar(valor, cor),
                          data: valor === "Ausente" ? null : valor,
                        });
                      });
                      if (top + altura < totalMunicipios) return buscarPagina(top + altura);
                      return linhas;
                    }
                  );
                }
                return buscarPagina(0);
              }
            );
          });
        })
        .then(function (linhas) {
          ws.close();
          resolve({
            linhas: linhas,
            recarga: recarga,
            colunaEncontrada: colunaEncontrada,
            colunasVistas: colunasVistas,
            coresDesconhecidas: Object.keys(coresDesconhecidas),
            valoresInesperados: Object.keys(valoresInesperados).slice(0, 3),
          });
        })
        .catch(function (err) {
          ws.close();
          reject(err);
        });
    };
  });
}

export function readTokenFromPage() {
  var t = localStorage.getItem("token");
  if (!t) return null;
  try { t = JSON.parse(t); } catch (e) {}
  return t || null;
}

export function isLoginPage() {
  return !!(
    document.querySelector("input[type=password]") ||
    document.body.innerText.includes("Matricula") ||
    document.body.innerText.includes("Fazer login")
  );
}

export function fillLoginForm(matricula, senha) {
  function setVal(el, v) {
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    try { setter.call(el, v); } catch (e) { el.value = v; }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  var inputs = Array.from(document.querySelectorAll("input"));
  var userEl = inputs.find(function (i) { return i.type !== "password" && i.type !== "hidden" && i.type !== "submit"; });
  var passEl = inputs.find(function (i) { return i.type === "password"; });
  if (!userEl || !passEl) return "formulario-nao-encontrado";
  setVal(userEl, matricula);
  setVal(passEl, senha);
  var btn = document.querySelector("button[type=submit]") ||
    Array.from(document.querySelectorAll("button")).find(function (b) { return /entrar|login|ok|acessar/i.test(b.textContent); });
  if (btn) { btn.click(); return "ok"; }
  var form = document.querySelector("form");
  if (form) { form.submit(); return "ok"; }
  return "botao-nao-encontrado";
}

export function callTicketQlik(token) {
  // Timeout explícito — sem ele, se a API do TCE não responder, a extensão
  // fica travada nessa etapa pra sempre (sem log de erro, sem "Concluído").
  var controller = new AbortController();
  var timeoutId = setTimeout(function () { controller.abort(); }, 20000);
  return fetch("https://api.virtual.tce.sc.gov.br/sgi/rest/usuarios/ticketQlik", {
    method: "GET",
    headers: { auth_token: token },
    signal: controller.signal,
  })
    .then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error("ticketQlik " + r.status + ": " + t.slice(0, 100)); });
      return r.text();
    })
    .then(function (body) {
      var match = body.match(/qlikTicket=([^&\s"']+)/);
      if (match) return match[1];
      try {
        var d = JSON.parse(body);
        var t = typeof d === "string" ? d : d.ticket || d.qlikTicket || d.token;
        if (t) return String(t);
      } catch (e) {}
      throw new Error("Nao foi possivel extrair ticket: " + body.slice(0, 100));
    })
    .catch(function (err) {
      if (err.name === "AbortError") throw new Error("ticketQlik: tempo esgotado (20s) sem resposta do TCE");
      throw err;
    })
    .finally(function () { clearTimeout(timeoutId); });
}

// periodo: "MM/AAAA". Retorna array de {municipio, anoMes, modulo, unidade, qtd, data_envio}
// ou {error}.
export function extractQlikModulos(periodo) {
  return new Promise(function (resolve) {
    var appId = "7b7ba237-120c-4c65-9188-65334fc38245";
    var ws = new WebSocket("wss://paineis.tce.sc.gov.br/custom/app/" + appId);
    var msgId = 1, cubeHandle = null, docHandle = null, recarga = null, allRows = [], totalRows = 0;
    var PAGE_SIZE = 2000;
    var fase = "open";
    var timer = setTimeout(function () {
      try { ws.close(); } catch (e) {}
      resolve({ error: "Timeout — sessão Qlik expirou" });
    }, 120000);

    function send(msg) { ws.send(JSON.stringify(msg)); }

    ws.onopen = function () {
      send({ jsonrpc: "2.0", id: msgId++, method: "OpenDoc", handle: -1, params: [appId] });
    };
    ws.onerror = function () {
      clearTimeout(timer);
      resolve({ error: "Erro WebSocket — autenticação Qlik inválida" });
    };
    ws.onmessage = function (e) {
      var d = JSON.parse(e.data);
      if (d.method) return;

      if (fase === "open") {
        if (d.error || !d.result || !d.result.qReturn) {
          clearTimeout(timer); try { ws.close(); } catch (ex) {}
          resolve({ error: (d.error && d.error.message) || "OpenDoc falhou" });
          return;
        }
        docHandle = d.result.qReturn.qHandle;
        // A sessão Qlik é a do usuário do login: uma seleção feita no painel
        // (ex.: um município) vale também aqui e filtra a extração inteira.
        // Limpa tudo antes, inclusive seleções travadas.
        fase = "clear";
        send({ jsonrpc: "2.0", id: msgId++, method: "ClearAll", handle: docHandle, params: [true] });
      } else if (fase === "clear") {
        fase = "reload";
        send({ jsonrpc: "2.0", id: msgId++, method: "GetAppLayout", handle: docHandle, params: [] });
      } else if (fase === "reload") {
        // Horário da última recarga do painel no TCE; se falhar, segue sem ele.
        recarga = (d.result && d.result.qLayout && d.result.qLayout.qLastReloadTime) || null;
        fase = "cube";
        send({
          jsonrpc: "2.0", id: msgId++, method: "CreateSessionObject", handle: docHandle,
          params: [{
            qInfo: { qType: "extract" },
            qHyperCubeDef: {
              qDimensions: [
                { qDef: { qFieldDefs: ["nomeEnte"] } },
                { qDef: { qFieldDefs: ["descricao"] } },
                { qDef: { qFieldDefs: ["nomeUnidade"], qNullSuppression: false } },
              ],
              qMeasures: [
                { qDef: { qDef: "Sum({<anoMesData={'" + periodo + "'}> } qtdPacotes)" } },
                { qDef: { qDef: "Date(Max({<anoMesData={'" + periodo + "'}> } datahorainiciotransmissao_original), 'DD/MM/YYYY')" } },
              ],
              qSuppressMissing: false,
              qInitialDataFetch: [{ qTop: 0, qLeft: 0, qHeight: 0, qWidth: 5 }],
            },
          }],
        });
      } else if (fase === "cube") {
        if (d.error || !d.result || !d.result.qReturn) {
          clearTimeout(timer); try { ws.close(); } catch (ex) {}
          resolve({ error: (d.error && d.error.message) || "CreateSessionObject falhou" });
          return;
        }
        cubeHandle = d.result.qReturn.qHandle;
        fase = "layout";
        send({ jsonrpc: "2.0", id: msgId++, method: "GetLayout", handle: cubeHandle, params: [] });
      } else if (fase === "layout") {
        if (d.error || !d.result || !d.result.qLayout) {
          clearTimeout(timer); try { ws.close(); } catch (ex) {}
          resolve({ error: (d.error && d.error.message) || "GetLayout falhou" });
          return;
        }
        var sz = d.result.qLayout.qHyperCube && d.result.qLayout.qHyperCube.qSize;
        if (!sz || sz.qcy === 0) {
          clearTimeout(timer); try { ws.close(); } catch (ex) {}
          resolve({ error: "Sem dados para o período " + periodo });
          return;
        }
        totalRows = sz.qcy;
        fase = "fetch";
        fetchPage(0);
      } else if (fase === "fetch") {
        if (d.error || !d.result || !d.result.qDataPages) {
          clearTimeout(timer); try { ws.close(); } catch (ex) {}
          resolve({ error: (d.error && d.error.message) || "GetHyperCubeData falhou" });
          return;
        }
        var pg = d.result.qDataPages[0];
        if (pg && pg.qMatrix.length > 0) pg.qMatrix.forEach(function (r) { allRows.push(r); });
        if (allRows.length < totalRows) fetchPage(allRows.length);
        else finish();
      }
    };

    function fetchPage(top) {
      var h = Math.min(PAGE_SIZE, totalRows - top);
      send({ jsonrpc: "2.0", id: msgId++, method: "GetHyperCubeData", handle: cubeHandle, params: ["/qHyperCubeDef", [{ qTop: top, qLeft: 0, qHeight: h, qWidth: 5 }]] });
    }
    function finish() {
      clearTimeout(timer); try { ws.close(); } catch (ex) {}
      resolve({
        recarga: recarga,
        linhas: allRows.map(function (row) {
          var qtdNum = row[3] ? row[3].qNum || 0 : 0;
          return {
            municipio: (row[0].qText || "").trim(),
            anoMes: periodo,
            modulo: (row[1].qText || "").trim(),
            unidade: (row[2].qText || "").trim(),
            qtd: isNaN(qtdNum) ? 0 : qtdNum,
          };
        }),
      });
    }
  });
}

/**
 * ============================================================================
 * ZAPPAS - Controle de Acesso (Autenticação / Permissões / Log de Acesso)
 * ============================================================================
 *
 * COMO INSTALAR:
 * 1. Crie uma nova planilha Google (pode chamar de "Zappas - Controle de Acesso").
 * 2. Nessa planilha, crie 3 abas com estes nomes EXATOS (maiúsculas/minúsculas importam):
 *      - Usuarios
 *      - Permissoes
 *      - AccessLog
 * 3. Na aba "Usuarios", coloque na linha 1 (cabeçalho) exatamente:
 *      email | nome | role | ativo | criadoEm | atualizadoEm | loja
 *    A coluna "loja" é NOVA (usada pra travar o filtro de loja de usuários
 *    não-administradores em Acompanhamento de Metas). Se você já tinha essa
 *    planilha criada antes dessa coluna existir, é só adicionar "loja" na
 *    célula da 7ª coluna da linha 1 (coluna G) — os usuários já cadastrados
 *    continuam funcionando normalmente, só ficam sem loja definida (o que
 *    equivale a "vê todas as lojas") até você editar cada um e escolher uma.
 * 4. Na aba "Permissoes", coloque na linha 1:
 *      email | telaKey | permitido
 * 5. Na aba "AccessLog", coloque na linha 1:
 *      timestamp | email | telaKey | resultado
 * 6. Cadastre manualmente na aba "Usuarios" (linha 2) o primeiro administrador,
 *    por exemplo:
 *      seuemail@zappas.com.br | Seu Nome | admin | TRUE | 2026-09-04 | 2026-09-04 |
 *    (deixe a célula de loja vazia para administradores — eles sempre veem
 *    todas as lojas independente do que estiver ali).
 *    Isso evita ficar sem acesso à tela de administração antes de qualquer
 *    cadastro ser feito pelo próprio painel.
 * 7. Abra Extensões > Apps Script nesta planilha, apague o conteúdo do
 *    Code.gs padrão e cole TODO o conteúdo deste arquivo no lugar.
 * 8. Troque o valor de AUTH_TOKEN abaixo por um segredo novo, só seu
 *    (qualquer texto longo e difícil de adivinhar - não reaproveite o
 *    token já usado em Elaboracao_Metas.html).
 * 9. NOVO (login por código de e-mail): por padrão o código é enviado pela
 *    própria conta Google dona deste Apps Script (usando MailApp), sem
 *    precisar configurar nada. Se quiser enviar como um alias específico
 *    (ex.: nao-responda@zappas.com.br), veja a opção comentada dentro de
 *    enviarCodigoLogin() — mas esse alias precisa já estar cadastrado em
 *    "Enviar e-mail como" nas configurações do Gmail dessa conta.
 * 10. Clique em Implantar > Nova implantação > tipo "App da Web".
 *      - Executar como: Eu (sua conta)
 *      - Quem pode acessar: Qualquer pessoa
 *     Na primeira vez que publicar (ou volte a implantar após esta
 *     atualização), o Google vai pedir para AUTORIZAR o script — aceite e
 *     conceda a permissão de enviar e-mail em nome da sua conta. Sem essa
 *     autorização, o envio do código falha com um erro de permissão.
 * 11. Copie a URL gerada (termina em /exec) - essa é a AUTH_APPS_SCRIPT_URL
 *     que vai ser usada dentro de auth-common.js.
 *
 * ============================================================================
 */

// Precisa ser IGUAL ao AUTH_TOKEN usado em auth-common.js / Administracao.html.
var AUTH_TOKEN = "zappas2026usuarios";

// Não é mais usada para bloquear cadastro/login (qualquer e-mail cadastrado
// em Administração pode entrar); mantida só por compatibilidade, caso algum
// outro trecho de código ainda faça referência a ela.
var EMAIL_EXCECOES = ["reginaldo.rfo2@gmail.com", "livia.zapaterra@gmail.com"];

var SHEET_USUARIOS = "Usuarios";
var SHEET_PERMISSOES = "Permissoes";
var SHEET_LOG = "AccessLog";

// PRECISA ficar igual (mesmas chaves) ao objeto TELA_LABELS em
// Administracao.html — toda chave nova adicionada lá (ex.: uma nova tela ou
// sub-permissão) também precisa ser adicionada aqui, senão o backend ignora
// silenciosamente essa permissão ao salvar (foi o que aconteceu com
// "curva_abc_produto": existia no HTML mas não aqui).
var TELA_KEYS = [
  "home", "analise_comercial", "faturamento_lucro", "faturamento_detalhado",
  "curva_abc_produto", "dre_gerencial", "orcamento_2027", "contas_a_pagar", "fluxo_caixa", "banco_declaracao",
  "reembolso", "ciclo_financeiro", "endividamento", "elaboracao_metas", "resultado_meta",
  "acompanhamento_metas"
];

// ═══════════════════════════════════════════════════════════════════════
// NOVO: Login por código enviado por e-mail (OTP), alternativa ao Google
// ═══════════════════════════════════════════════════════════════════════
var OTP_TTL_SEGUNDOS = 600;           // código válido por 10 minutos
var OTP_REENVIO_MIN_SEGUNDOS = 45;    // intervalo mínimo entre pedidos de novo código
var OTP_MAX_TENTATIVAS = 5;           // tentativas erradas até invalidar o código

// Por padrão o código é enviado pela própria conta Google dona deste Apps
// Script (via MailApp), sem precisar configurar nenhum alias. OTP_REMETENTE
// só é usado se você decidir enviar como um alias específico (opção
// comentada dentro de enviarCodigoLogin) — nesse caso ele PRECISA já estar
// cadastrado em "Enviar e-mail como" nas configurações do Gmail dessa
// conta, senão o envio falha.
var OTP_REMETENTE = "nao-responda@zappas.com.br"; // só usado se você habilitar o envio por alias
var OTP_REMETENTE_NOME = "Painel de Gestão Zappas";

function doGet(e) {
  try {
    var action = (e.parameter.action || "").trim();
    if (action === "getUsuario") return jsonOut(getUsuario(e.parameter.email));
    if (action === "getUsuarios") return jsonOut(getUsuarios());
    if (action === "getAccessLog") return jsonOut(getAccessLog(parseInt(e.parameter.limit, 10) || 500));
    return jsonOut({ erro: "Ação inválida: " + action });
  } catch (err) {
    return jsonOut({ erro: String(err) });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.token !== AUTH_TOKEN) return jsonOut({ erro: "Token inválido" });

    if (body.action === "salvarUsuario") return jsonOut(salvarUsuario(body));
    if (body.action === "removerUsuario") return jsonOut(removerUsuario(body.email));
    if (body.action === "logAcesso") return jsonOut(logAcesso(body.email, body.telaKey, body.resultado));

    // NOVO: fluxo de login por código de e-mail.
    if (body.action === "enviarCodigoLogin") return jsonOut(enviarCodigoLogin(body.email));
    if (body.action === "validarCodigoLogin") return jsonOut(validarCodigoLogin(body.email, body.codigo));

    return jsonOut({ erro: "Ação inválida: " + body.action });
  } catch (err) {
    return jsonOut({ erro: String(err) });
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet(nome) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nome);
}

function sheetToObjects(sheet) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (!row[0]) continue; // pula linhas vazias
    var obj = {};
    headers.forEach(function (h, idx) { obj[h] = row[idx]; });
    out.push(obj);
  }
  return out;
}

function normEmail(email) {
  return String(email || "").trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

function getUsuario(email) {
  email = normEmail(email);
  if (!email) return { erro: "email não informado" };

  var usuarios = sheetToObjects(getSheet(SHEET_USUARIOS));
  var user = usuarios.find(function (u) { return normEmail(u.email) === email; });
  if (!user) return { encontrado: false };

  var permissoesRows = sheetToObjects(getSheet(SHEET_PERMISSOES))
    .filter(function (p) { return normEmail(p.email) === email; });

  var permissoes = {};
  TELA_KEYS.forEach(function (k) { permissoes[k] = false; });
  permissoesRows.forEach(function (p) {
    permissoes[p.telaKey] = (p.permitido === true || String(p.permitido).toUpperCase() === "TRUE");
  });

  return {
    encontrado: true,
    email: normEmail(user.email),
    nome: user.nome,
    role: user.role,
    ativo: (user.ativo === true || String(user.ativo).toUpperCase() === "TRUE"),
    loja: user.loja || "",
    permissoes: permissoes
  };
}

function getUsuarios() {
  var usuarios = sheetToObjects(getSheet(SHEET_USUARIOS));
  var permissoes = sheetToObjects(getSheet(SHEET_PERMISSOES));

  return usuarios.map(function (u) {
    var email = normEmail(u.email);
    var perm = {};
    TELA_KEYS.forEach(function (k) { perm[k] = false; });
    permissoes.filter(function (p) { return normEmail(p.email) === email; })
      .forEach(function (p) {
        perm[p.telaKey] = (p.permitido === true || String(p.permitido).toUpperCase() === "TRUE");
      });
    return {
      email: email,
      nome: u.nome,
      role: u.role,
      ativo: (u.ativo === true || String(u.ativo).toUpperCase() === "TRUE"),
      criadoEm: u.criadoEm,
      atualizadoEm: u.atualizadoEm,
      loja: u.loja || "",
      permissoes: perm
    };
  });
}

function getAccessLog(limit) {
  var rows = sheetToObjects(getSheet(SHEET_LOG));
  rows.sort(function (a, b) {
    return new Date(b.timestamp) - new Date(a.timestamp);
  });
  return rows.slice(0, limit || 500);
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

function salvarUsuario(body) {
  var email = normEmail(body.email);
  if (!email) return { erro: "email não informado" };
  // Não exigimos mais domínio @zappas.com.br: quem entra é controlado pelo
  // próprio cadastro em Administração (estar aqui = ter acesso liberado),
  // então aceitamos qualquer conta Google com formato de e-mail válido.
  if (email.indexOf("@") === -1 || email.indexOf(".") === -1) {
    return { erro: "informe um e-mail válido" };
  }

  // Evita que dois cadastros/edições simultâneos leiam a planilha ao mesmo
  // tempo e se pisem (um sobrescrevendo a linha do outro).
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return { erro: "Sistema ocupado salvando outro usuário, tente novamente em alguns segundos." };
  }
  try {
    return salvarUsuarioInterno(body, email);
  } finally {
    lock.releaseLock();
  }
}

function salvarUsuarioInterno(body, email) {
  // Se o admin trocou o e-mail do usuário na edição, emailAntigo aponta pra
  // linha que já existe na planilha; sem isso, a busca seria pelo e-mail
  // novo (que ainda não existe) e criaria uma linha duplicada em vez de
  // renomear a existente.
  var emailBusca = body.emailAntigo ? normEmail(body.emailAntigo) : email;

  var sheetU = getSheet(SHEET_USUARIOS);
  var dataU = sheetU.getDataRange().getValues();
  var headersU = dataU[0].map(function (h) { return String(h).trim(); });
  var colEmail = headersU.indexOf("email");
  var agora = new Date();

  var rowIndex = -1;
  for (var i = 1; i < dataU.length; i++) {
    if (normEmail(dataU[i][colEmail]) === emailBusca) { rowIndex = i + 1; break; }
  }

  // Impede duplicar e-mail: seja num cadastro novo (email já pertence a
  // outra linha), seja numa edição que troca para um e-mail já usado por
  // outro usuário.
  for (var j = 1; j < dataU.length; j++) {
    if (normEmail(dataU[j][colEmail]) === email && (j + 1) !== rowIndex) {
      return { erro: "Já existe um usuário cadastrado com esse e-mail." };
    }
  }

  var colLojaU = headersU.indexOf("loja");
  var lojaAnterior = (rowIndex === -1 || colLojaU === -1) ? "" : (dataU[rowIndex - 1][colLojaU] || "");

  var novaLinha = [
    email,
    body.nome || "",
    body.role === "admin" ? "admin" : "user",
    body.ativo === false ? false : true,
    rowIndex === -1 ? agora : dataU[rowIndex - 1][headersU.indexOf("criadoEm")],
    agora,
    body.loja !== undefined ? (body.loja || "") : lojaAnterior
  ];

  if (rowIndex === -1) {
    sheetU.appendRow(novaLinha);
  } else {
    sheetU.getRange(rowIndex, 1, 1, novaLinha.length).setValues([novaLinha]);
  }

  // Regrava permissões: remove linhas antigas desse email (o antigo, se
  // trocou) e insere as novas já com o e-mail atual
  var sheetP = getSheet(SHEET_PERMISSOES);
  var dataP = sheetP.getDataRange().getValues();
  var headersP = dataP[0].map(function (h) { return String(h).trim(); });
  var colEmailP = headersP.indexOf("email");

  for (var r = dataP.length - 1; r >= 1; r--) {
    if (normEmail(dataP[r][colEmailP]) === emailBusca) {
      sheetP.deleteRow(r + 1);
    }
  }

  var permissoes = body.permissoes || {};
  TELA_KEYS.forEach(function (key) {
    if (permissoes[key]) {
      sheetP.appendRow([email, key, true]);
    }
  });

  return { ok: true, email: email };
}

function removerUsuario(email) {
  email = normEmail(email);
  if (!email) return { erro: "email não informado" };

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return { erro: "Sistema ocupado, tente novamente em alguns segundos." };
  }
  try {
    return removerUsuarioInterno(email);
  } finally {
    lock.releaseLock();
  }
}

function removerUsuarioInterno(email) {
  var sheetU = getSheet(SHEET_USUARIOS);
  var dataU = sheetU.getDataRange().getValues();
  var headersU = dataU[0].map(function (h) { return String(h).trim(); });
  var colEmail = headersU.indexOf("email");

  for (var i = dataU.length - 1; i >= 1; i--) {
    if (normEmail(dataU[i][colEmail]) === email) {
      sheetU.deleteRow(i + 1);
    }
  }

  var sheetP = getSheet(SHEET_PERMISSOES);
  var dataP = sheetP.getDataRange().getValues();
  var headersP = dataP[0].map(function (h) { return String(h).trim(); });
  var colEmailP = headersP.indexOf("email");

  for (var r = dataP.length - 1; r >= 1; r--) {
    if (normEmail(dataP[r][colEmailP]) === email) {
      sheetP.deleteRow(r + 1);
    }
  }

  return { ok: true };
}

function logAcesso(email, telaKey, resultado) {
  var sheet = getSheet(SHEET_LOG);
  sheet.appendRow([new Date(), normEmail(email), telaKey || "", resultado || ""]);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// NOVO: Login por código de e-mail (OTP)
// ---------------------------------------------------------------------------

/**
 * SÓ PARA RODAR MANUALMENTE UMA VEZ NO EDITOR (não é chamada pelo doGet/doPost).
 *
 * Selecione "autorizarEnvioDeEmail" no menu suspenso de funções do editor
 * (ao lado do botão "Executar") e clique em Executar. Isso força a linha
 * que usa MailApp a rodar de verdade, o que faz o Google mostrar a tela de
 * autorização pedindo a permissão de enviar e-mail. Sem rodar uma função
 * que *de fato* chame MailApp/GmailApp, essa tela nunca aparece — é por
 * isso que rodar enviarCodigoLogin() sem argumento não resolve: ela para
 * antes de chegar na linha do envio.
 *
 * Depois de autorizar uma vez, pode deixar esta função aqui (ela não afeta
 * nada) ou apagá-la — não é usada pelo restante do sistema.
 */
function autorizarEnvioDeEmail() {
  var minhaConta = Session.getActiveUser().getEmail();
  MailApp.sendEmail(
    minhaConta,
    "Teste de autorização — Painel de Gestão Zappas",
    "Se você recebeu este e-mail, a permissão de envio foi concedida com sucesso. " +
    "Pode voltar ao painel e testar o login por código normalmente."
  );
}

function gerarCodigoOtp() {
  var n = Math.floor(Math.random() * 1000000);
  return ("000000" + n).slice(-6);
}

/**
 * Gera um código de 6 dígitos, guarda no CacheService (expira sozinho em
 * OTP_TTL_SEGUNDOS) e envia por e-mail via GmailApp. Não usa aba nova na
 * planilha — o cache do Apps Script já resolve a expiração automática.
 */
function enviarCodigoLogin(email) {
  email = normEmail(email);
  if (!email) return { erro: "email não informado" };

  var usuario = getUsuario(email);
  if (!usuario.encontrado || usuario.ativo === false) {
    // Resposta genérica de propósito: não revela se o e-mail existe ou não
    // no cadastro, para não ajudar alguém a "escanear" e-mails válidos.
    // O cliente mostra a mesma mensagem de "verifique seu e-mail" em
    // qualquer um dos dois casos (existe ou não existe).
    return { ok: true };
  }

  var cache = CacheService.getScriptCache();
  var chaveUltimoEnvio = "otp_ultimo_" + email;
  if (cache.get(chaveUltimoEnvio)) {
    return { erro: "Aguarde alguns segundos antes de pedir um novo código." };
  }

  var codigo = gerarCodigoOtp();

  var minutos = Math.round(OTP_TTL_SEGUNDOS / 60);
  var corpo =
    "Olá" + (usuario.nome ? ", " + usuario.nome : "") + ",\n\n" +
    "Seu código de acesso ao Painel de Gestão Zappas é:\n\n" +
    "    " + codigo + "\n\n" +
    "Esse código é válido por " + minutos + " minutos. Se você não pediu este " +
    "código, pode ignorar este e-mail com segurança.";

  try {
    // Usamos MailApp (não GmailApp): MailApp.sendEmail pede só a permissão
    // "enviar e-mail como você", que é concedida na autorização padrão do
    // projeto. GmailApp exige escopos extras do Gmail (gmail.readonly /
    // gmail.modify / mail.google.com) que geram o erro "The script does not
    // have permission to perform that action" até serem autorizados à parte
    // — e normalmente nem são necessários só para enviar um e-mail simples.
    MailApp.sendEmail({
      to: email,
      subject: "Seu código de acesso — Painel de Gestão Zappas",
      body: corpo,
      name: OTP_REMETENTE_NOME
      // Se quiser enviar como um alias específico (ex.: nao-responda@zappas.com.br),
      // descomente a linha abaixo — mas ele precisa já estar cadastrado em
      // Gmail > Configurações > Contas e Importação > "Enviar e-mail como"
      // na conta dona deste Apps Script, senão o envio falha.
      // , from: OTP_REMETENTE
    });
  } catch (e) {
    return { erro: "Não foi possível enviar o e-mail: " + e.message };
  }

  // Só marca o cooldown de reenvio DEPOIS de confirmar que o e-mail saiu —
  // assim, se o envio falhar, a pessoa consegue tentar de novo na hora, em
  // vez de ficar presa na mensagem "aguarde alguns segundos" escondendo o
  // erro real (foi o que aconteceu no teste: o primeiro envio falhou e o
  // cooldown, marcado antes da tentativa, mascarou o erro verdadeiro nas
  // tentativas seguintes).
  cache.put("otp_codigo_" + email, codigo, OTP_TTL_SEGUNDOS);
  cache.put("otp_tentativas_" + email, "0", OTP_TTL_SEGUNDOS);
  cache.put(chaveUltimoEnvio, "1", OTP_REENVIO_MIN_SEGUNDOS);

  return { ok: true };
}

/**
 * Confere o código digitado contra o que está no cache. Em caso de sucesso,
 * devolve os mesmos dados que getUsuario() devolveria (o cliente monta a
 * sessão a partir disso, sem precisar de uma segunda chamada).
 */
function validarCodigoLogin(email, codigoDigitado) {
  email = normEmail(email);
  codigoDigitado = String(codigoDigitado || "").trim();
  if (!email || !codigoDigitado) return { erro: "Informe o e-mail e o código." };

  var cache = CacheService.getScriptCache();
  var chaveCodigo = "otp_codigo_" + email;
  var chaveTentativas = "otp_tentativas_" + email;

  var codigoValido = cache.get(chaveCodigo);
  if (!codigoValido) {
    return { erro: "Código expirado ou não solicitado. Peça um novo código." };
  }

  var tentativas = parseInt(cache.get(chaveTentativas) || "0", 10);
  if (tentativas >= OTP_MAX_TENTATIVAS) {
    cache.remove(chaveCodigo);
    cache.remove(chaveTentativas);
    return { erro: "Muitas tentativas incorretas. Peça um novo código." };
  }

  if (codigoDigitado !== codigoValido) {
    cache.put(chaveTentativas, String(tentativas + 1), OTP_TTL_SEGUNDOS);
    return { erro: "Código incorreto." };
  }

  // Código certo: remove do cache pra não poder ser reaproveitado.
  cache.remove(chaveCodigo);
  cache.remove(chaveTentativas);

  var usuario = getUsuario(email);
  if (!usuario.encontrado || usuario.ativo === false) {
    return { erro: "Sua conta ainda não tem acesso liberado a este painel. Fale com um administrador." };
  }
  return usuario;
}

/**
 * ============================================================================
 * ZAPPAS - auth-common.js
 * ============================================================================
 * Arquivo compartilhado de autenticação/autorização para todas as páginas do
 * Painel de Gestão. Inclua com:
 *
 *   <script src="auth-common.js"></script>
 *
 * como a PRIMEIRA tag de script da página (antes de qualquer código que leia
 * cache/IndexedDB ou busque dados). Em seguida, envolva o código de
 * inicialização já existente da página assim:
 *
 *   AuthGuard.requireScreen('telaKey_da_pagina', function () {
 *     // ... código que já existia na página, ex. loadData(), etc.
 *   });
 *
 * IMPORTANTE: configure as constantes abaixo antes de publicar:
 *   - GOOGLE_CLIENT_ID: Client ID OAuth criado no Google Cloud Console.
 *   - AUTH_APPS_SCRIPT_URL: URL /exec do Apps Script criado a partir de Code.gs.
 *   - AUTH_TOKEN: precisa ser IGUAL ao AUTH_TOKEN configurado em Code.gs.
 *
 * NOVO: além do login com Google, esta versão adiciona uma segunda opção —
 * "Entrar com código por e-mail" — que usa as ações enviarCodigoLogin /
 * validarCodigoLogin do Code.gs (que envia um código de 6 dígitos via
 * MailApp). As duas formas de login coexistem, mas o código por e-mail é a
 * tela PADRÃO agora; o login com Google fica atrás de um link ("Fazer login
 * com o Google") e só carrega o script do Google quando clicado.
 * ============================================================================
 */

(function (window) {
  "use strict";

  // ── CONFIGURAÇÃO (edite aqui) ──────────────────────────────────────────
  var GOOGLE_CLIENT_ID = "660941198657-kolngnc6en0etp73afcdffl2c9il1au7.apps.googleusercontent.com";
  var AUTH_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbz3ZLCz2tQFFWyGQ58tw2w1kCMhvfNI2nH9hPX3SxS7bHAEQZkcVijNd1hzvTnP3JEppw/exec";
  var AUTH_TOKEN = "zappas2026usuarios";
  // Não há mais restrição de domínio de e-mail: o acesso é controlado só
  // pelo cadastro em Administração (qualquer conta Google, inclusive Gmail
  // pessoal, funciona desde que esteja cadastrada e ativa por lá).
  var SESSION_KEY = "zappas_session";

  // Duração da sessão criada via código de e-mail (o login Google usa o
  // "exp" que já vem no próprio token do Google; aqui definimos nós mesmos,
  // já que não existe token do Google nesse fluxo).
  var OTP_SESSION_SEGUNDOS = 12 * 60 * 60; // 12 horas

  // Mapa telaKey -> {label, href} usado no link "Administração" injetado no
  // rodapé do menu e nas mensagens de acesso negado.
  var TELAS = {
    home: { label: "Início", href: "GestaoZappas.html" },
    analise_comercial: { label: "Análise Comercial", href: "Analise_Comercial.html" },
    faturamento_lucro: { label: "Faturamento x Lucro", href: "Faturamento_Lucro.html" },
    faturamento_detalhado: { label: "Faturamento Detalhado", href: "Faturamento_Detalhado.html" },
    dre_gerencial: { label: "Demonstrativo de Resultado", href: "DRE_Gerencial.html" },
    contas_a_pagar: { label: "Contas a Pagar", href: "Contas_a_Pagar.html" },
    banco_declaracao: { label: "Banco", href: "Banco_Declaracao.html" },
    reembolso: { label: "Reembolso entre Lojas", href: "Reembolso.html" },
    ciclo_financeiro: { label: "Ciclo Financeiro", href: "Ciclo_Financeiro.html" },
    elaboracao_metas: { label: "Elaboração de Metas", href: "Elaboracao_Metas.html" },
    resultado_meta: { label: "Resultado Metas", href: "Resultado_Meta.html" },
    acompanhamento_metas: { label: "Acompanhamento de Metas", href: "Acompanhamento_Metas.html" }
  };

  // ── Estado interno ──────────────────────────────────────────────────────
  var session = null; // { email, name, picture, exp, role, loja, ativo, permissoes, fetchedAt }
  var gisReady = false;
  var pendingScreenKey = null;
  var pendingCallback = null;
  var otpEmailPendente = null; // e-mail que já pediu código e está aguardando digitar

  // ── Utilidades ───────────────────────────────────────────────────────────

  function log() {
    try { console.log.apply(console, ["[AuthGuard]"].concat(Array.prototype.slice.call(arguments))); } catch (e) {}
  }

  function base64UrlDecode(str) {
    str = str.replace(/-/g, "+").replace(/_/g, "/");
    while (str.length % 4) str += "=";
    return decodeURIComponent(
      atob(str)
        .split("")
        .map(function (c) { return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2); })
        .join("")
    );
  }

  function decodeJwt(token) {
    try {
      var payload = token.split(".")[1];
      return JSON.parse(base64UrlDecode(payload));
    } catch (e) {
      return null;
    }
  }

  function loadSessionFromStorage() {
    try {
      // Lê do localStorage e, se estiver vazio, da cópia em sessionStorage
      // (proteção caso o localStorage tenha sido limpo/bloqueado pelo navegador).
      var raw = null;
      try { raw = localStorage.getItem(SESSION_KEY); } catch (e) {}
      if (!raw) { try { raw = sessionStorage.getItem(SESSION_KEY); } catch (e) {} }
      if (!raw) { log("Sem sessão salva neste navegador/endereço:", location.origin); return null; }
      var s = JSON.parse(raw);
      var agora = Date.now() / 1000;
      if (!s || !s.exp) { log("Sessão salva inválida (sem exp)."); return null; }
      if (agora > s.exp) { log("Sessão expirada em", new Date(s.exp * 1000).toLocaleString()); return null; }
      // Sessão deslizante: cada abertura de tela renova a validade por mais 12h,
      // então quem está usando o painel não é deslogado no meio do uso.
      var novaExp = Math.floor(agora) + OTP_SESSION_SEGUNDOS;
      if (novaExp > s.exp) { s.exp = novaExp; saveSessionToStorage(s); }
      return s;
    } catch (e) {
      log("Erro ao ler sessão:", e);
      return null;
    }
  }

  function saveSessionToStorage(s) {
    var txt = JSON.stringify(s);
    try { localStorage.setItem(SESSION_KEY, txt); } catch (e) { log("Falha ao gravar no localStorage:", e); }
    try { sessionStorage.setItem(SESSION_KEY, txt); } catch (e) {}
  }

  function clearSession() {
    session = null;
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  function fetchUsuario(email) {
    var url = AUTH_APPS_SCRIPT_URL + "?action=getUsuario&email=" + encodeURIComponent(email) + "&_cb=" + Date.now();
    return fetch(url, { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    });
  }

  function logAcesso(email, telaKey, resultado) {
    try {
      fetch(AUTH_APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "logAcesso", token: AUTH_TOKEN, email: email, telaKey: telaKey, resultado: resultado })
      }).catch(function () {});
    } catch (e) {}
  }

  // Helper genérico para chamar ações de escrita/fluxo no Apps Script
  // (mesmo padrão do postAuthAction usado em Administracao.html).
  function postAuthAction(body) {
    body.token = AUTH_TOKEN;
    return fetch(AUTH_APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  // ── UI: overlay de login ───────────────────────────────────────────────

  function injectStyles() {
    var style = document.createElement("style");
    style.id = "auth-guard-styles";
    style.textContent =
      "#auth-guard-overlay{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;" +
      "background:linear-gradient(135deg,#0B1E3D 0%,#16283F 55%,#122C52 100%);font-family:'Epilogue',system-ui,sans-serif;}" +
      "#auth-guard-overlay .ag-card{background:#FFFFFF;border-radius:22px;padding:40px 36px;max-width:380px;width:90vw;" +
      "text-align:center;box-shadow:0 12px 48px rgba(0,0,0,.35);}" +
      "#auth-guard-overlay .ag-icon{width:56px;height:56px;border-radius:16px;background:#C8961A;display:flex;align-items:center;" +
      "justify-content:center;margin:0 auto 18px;}" +
      "#auth-guard-overlay .ag-icon svg{width:28px;height:28px;color:#16160F;}" +
      "#auth-guard-overlay .ag-title{font-family:'Syne',system-ui,sans-serif;font-weight:800;font-size:20px;color:#16160F;margin-bottom:8px;}" +
      "#auth-guard-overlay .ag-sub{font-size:13px;color:#787868;margin-bottom:22px;line-height:1.5;}" +
      "#auth-guard-overlay .ag-gsi{display:flex;justify-content:center;min-height:44px;}" +
      "#auth-guard-overlay .ag-err{margin-top:14px;font-size:12.5px;color:#B4483A;}" +
      "#auth-guard-overlay .ag-ok{margin-top:14px;font-size:12.5px;color:#3E8F63;}" +
      "#auth-guard-overlay .ag-divider{display:flex;align-items:center;gap:10px;margin:18px 0;color:#AEADA0;font-size:11px;text-transform:uppercase;letter-spacing:.05em;}" +
      "#auth-guard-overlay .ag-divider::before,#auth-guard-overlay .ag-divider::after{content:'';flex:1;height:1px;background:#E8E6DE;}" +
      "#auth-guard-overlay .ag-link{background:none;border:none;color:#1B3D6E;font-family:'Epilogue',system-ui,sans-serif;font-size:12.5px;" +
      "font-weight:600;cursor:pointer;text-decoration:underline;padding:4px;}" +
      "#auth-guard-overlay .ag-link:hover{color:#2C4E78;}" +
      "#auth-guard-overlay .ag-field{margin-bottom:12px;text-align:left;}" +
      "#auth-guard-overlay .ag-field input{width:100%;padding:10px 12px;border:1px solid #D8D5CC;border-radius:10px;" +
      "font-family:'Epilogue',system-ui,sans-serif;font-size:14px;background:#F7F6F2;text-align:center;letter-spacing:.02em;}" +
      "#auth-guard-overlay .ag-field input:focus{outline:none;border-color:#2C4E78;box-shadow:0 0 0 3px #E4ECF6;}" +
      "#auth-guard-overlay .ag-field input[type=tel]{letter-spacing:.5em;font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:600;}" +
      "#auth-guard-overlay .ag-btn{width:100%;background:#1B3D6E;color:#fff;border:none;border-radius:10px;padding:11px 15px;" +
      "font-family:'Epilogue',system-ui,sans-serif;font-size:13px;font-weight:700;cursor:pointer;margin-top:4px;}" +
      "#auth-guard-overlay .ag-btn:hover{background:#2C4E78;}" +
      "#auth-guard-overlay .ag-btn:disabled{opacity:.6;cursor:default;}" +
      "#auth-guard-overlay .ag-back-link{display:block;margin-top:14px;}" +
      "#auth-guard-denied{position:fixed;inset:0;z-index:99998;display:flex;align-items:center;justify-content:center;background:#F7F6F2;}" +
      "#auth-guard-denied .ag-card{display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center;max-width:380px;}" +
      "#auth-guard-denied .ag-icon{width:64px;height:64px;border-radius:16px;background:#E39184;display:flex;align-items:center;justify-content:center;}" +
      "#auth-guard-denied .ag-icon svg{width:32px;height:32px;color:#fff;}" +
      "#auth-guard-denied .ag-title{font-family:'Syne',system-ui,sans-serif;font-weight:800;font-size:22px;color:#16160F;}" +
      "#auth-guard-denied .ag-sub{font-family:'Epilogue',system-ui,sans-serif;font-size:14px;color:#787868;}" +
      "#auth-guard-denied .ag-back{margin-top:6px;font-family:'Syne',system-ui,sans-serif;font-weight:700;font-size:13px;" +
      "color:#16160F;background:#C8961A;padding:10px 20px;border-radius:10px;text-decoration:none;}";
    document.head.appendChild(style);
  }

  // Modo do overlay: 'otp-email' (pedir e-mail — PADRÃO), 'google' ou
  // 'otp-codigo' (digitar o código recebido).
  function showLoginOverlay(errorMsg, modo) {
    hideOverlay();
    modo = modo || "otp-email";
    var wrap = document.createElement("div");
    wrap.id = "auth-guard-overlay";

    var innerHtml =
      '<div class="ag-card">' +
      '<div class="ag-icon"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">' +
      '<path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg></div>' +
      '<div class="ag-title">Painel de Gestão</div>';

    if (modo === "google") {
      innerHtml +=
        '<div class="ag-sub">Entre com a conta Google cadastrada para você acessar este painel.</div>' +
        '<div class="ag-gsi" id="ag-gsi-btn"></div>' +
        '<div class="ag-divider">ou</div>' +
        '<button type="button" class="ag-link" id="ag-ir-otp">Entrar com código enviado por e-mail</button>';
    } else if (modo === "otp-email") {
      innerHtml +=
        '<div class="ag-sub">Informe seu e-mail cadastrado. Vamos enviar um código de acesso para ele.</div>' +
        '<div class="ag-field"><input type="email" id="ag-otp-email" placeholder="seuemail@zappas.com.br" autocomplete="email"></div>' +
        '<button type="button" class="ag-btn" id="ag-enviar-codigo">Enviar código</button>' +
        '<div class="ag-divider">ou</div>' +
        '<button type="button" class="ag-link" id="ag-voltar-google">Fazer login com o Google</button>';
    } else if (modo === "otp-codigo") {
      innerHtml +=
        '<div class="ag-sub">Enviamos um código de 6 dígitos para <strong>' + (otpEmailPendente || "") + '</strong>. Confira sua caixa de entrada (e o spam) e digite o código abaixo.</div>' +
        '<div class="ag-field"><input type="tel" inputmode="numeric" maxlength="6" id="ag-otp-codigo" placeholder="000000" autocomplete="one-time-code"></div>' +
        '<button type="button" class="ag-btn" id="ag-confirmar-codigo">Confirmar código</button>' +
        '<button type="button" class="ag-link" id="ag-reenviar-codigo" style="margin-top:10px;">Reenviar código</button>' +
        '<a class="ag-link ag-back-link" id="ag-voltar-email" href="javascript:void(0)">Usar outro e-mail</a>';
    }

    innerHtml += (errorMsg ? '<div class="ag-err">' + errorMsg + "</div>" : "") + "</div>";
    wrap.innerHTML = innerHtml;
    document.body.appendChild(wrap);

    if (modo === "google") {
      renderGoogleButton();
      var btnIrOtp = document.getElementById("ag-ir-otp");
      if (btnIrOtp) btnIrOtp.addEventListener("click", function () { showLoginOverlay(null, "otp-email"); });
    } else if (modo === "otp-email") {
      var btnEnviar = document.getElementById("ag-enviar-codigo");
      var inputEmail = document.getElementById("ag-otp-email");
      if (btnEnviar) btnEnviar.addEventListener("click", function () { solicitarCodigoOtp(inputEmail.value); });
      if (inputEmail) {
        inputEmail.addEventListener("keydown", function (e) { if (e.key === "Enter") solicitarCodigoOtp(inputEmail.value); });
        inputEmail.focus();
      }
      var btnVoltarGoogle = document.getElementById("ag-voltar-google");
      if (btnVoltarGoogle) btnVoltarGoogle.addEventListener("click", function () { mostrarLoginGoogle(); });
    } else if (modo === "otp-codigo") {
      var btnConfirmar = document.getElementById("ag-confirmar-codigo");
      var inputCodigo = document.getElementById("ag-otp-codigo");
      if (btnConfirmar) btnConfirmar.addEventListener("click", function () { confirmarCodigoOtp(inputCodigo.value); });
      if (inputCodigo) {
        inputCodigo.addEventListener("keydown", function (e) { if (e.key === "Enter") confirmarCodigoOtp(inputCodigo.value); });
        inputCodigo.focus();
      }
      var btnReenviar = document.getElementById("ag-reenviar-codigo");
      if (btnReenviar) btnReenviar.addEventListener("click", function () { solicitarCodigoOtp(otpEmailPendente, true); });
      var btnVoltarEmail = document.getElementById("ag-voltar-email");
      if (btnVoltarEmail) btnVoltarEmail.addEventListener("click", function () { showLoginOverlay(null, "otp-email"); });
    }
  }

  function showDeniedOverlay(telaKey) {
    hideOverlay();
    var tela = TELAS[telaKey];
    var wrap = document.createElement("div");
    wrap.id = "auth-guard-denied";
    wrap.innerHTML =
      '<div class="ag-card">' +
      '<div class="ag-icon"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">' +
      '<path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg></div>' +
      '<div class="ag-title">Acesso não autorizado</div>' +
      '<div class="ag-sub">Sua conta não tem permissão para acessar' + (tela ? " “" + tela.label + "”" : " esta tela") + ".<br>Fale com um administrador do painel se precisar de acesso.</div>" +
      '<a class="ag-back" href="' + (primeiraTelaLiberada() || "GestaoZappas.html") + '">Voltar ao início</a>' +
      "</div>";
    document.body.appendChild(wrap);
  }

  function hideOverlay() {
    var a = document.getElementById("auth-guard-overlay");
    if (a) a.remove();
    var b = document.getElementById("auth-guard-denied");
    if (b) b.remove();
  }

  // ── Google Identity Services ───────────────────────────────────────────

  function loadGisScript(cb) {
    if (window.google && window.google.accounts && window.google.accounts.id) { cb(); return; }
    var s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = cb;
    document.head.appendChild(s);
  }

  function initGis() {
    if (gisReady) return;
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      // Não usamos o parâmetro "hd" aqui: o acesso não é mais restrito a um
      // domínio específico, qualquer conta Google cadastrada em
      // Administração pode entrar (checagem feita via getUsuario, dentro
      // de handleCredentialResponse).
      auto_select: true,
      callback: handleCredentialResponse
    });
    gisReady = true;
  }

  function renderGoogleButton() {
    if (!window.google || !window.google.accounts || !window.google.accounts.id) return;
    var target = document.getElementById("ag-gsi-btn");
    if (!target) return;
    window.google.accounts.id.renderButton(target, {
      theme: "outline", size: "large", type: "standard", text: "signin_with", shape: "pill", width: 260
    });
    try { window.google.accounts.id.prompt(); } catch (e) {}
  }

  // Login por código é o padrão agora, então só carregamos o script do
  // Google (e mostramos o botão) quando a pessoa realmente pede — em vez de
  // carregar isso tudo já na primeira tela, antes de saber se vai ser usado.
  function mostrarLoginGoogle(errorMsg) {
    loadGisScript(function () {
      initGis();
      showLoginOverlay(errorMsg, "google");
    });
  }

  function handleCredentialResponse(response) {
    var payload = decodeJwt(response.credential);
    if (!payload) { mostrarLoginGoogle("Não foi possível validar o login. Tente novamente."); return; }

    var email = String(payload.email || "").toLowerCase();

    // Não exigimos mais domínio @zappas.com.br nem lista de exceções: quem
    // controla o acesso é o cadastro em Administração (getUsuario abaixo).
    // Isso permite cadastrar qualquer conta Google (inclusive Gmail pessoal)
    // direto na tela de Administração, sem precisar editar código.
    if (!payload.email_verified) {
      mostrarLoginGoogle("Não foi possível confirmar seu e-mail com o Google. Tente novamente.");
      return;
    }

    fetchUsuario(email).then(function (data) {
      if (!data || !data.encontrado || data.ativo === false) {
        mostrarLoginGoogle("Sua conta ainda não tem acesso liberado a este painel. Fale com um administrador.");
        return;
      }
      session = {
        email: email,
        name: payload.name || data.nome || email,
        picture: payload.picture || "",
        // Usa a mesma duração do login por código (12h) em vez do "exp" do token
        // do Google, que costuma ser de ~1h e derrubava a sessão cedo demais.
        exp: Math.floor(Date.now() / 1000) + OTP_SESSION_SEGUNDOS,
        role: data.role,
        loja: data.loja || "",
        permissoes: data.permissoes || {},
        fetchedAt: Date.now()
      };
      saveSessionToStorage(session);
      hideOverlay();
      injectAdminLink();
      proceedAfterAuth();
    }).catch(function (err) {
      log("Erro ao buscar usuário:", err);
      mostrarLoginGoogle("Erro ao verificar sua conta. Tente novamente em instantes.");
    });
  }

  // ── Login por código de e-mail (OTP) ───────────────────────────────────

  function solicitarCodigoOtp(emailDigitado, reenvio) {
    var email = String(emailDigitado || "").trim().toLowerCase();
    if (!email || email.indexOf("@") === -1 || email.indexOf(".") === -1) {
      showLoginOverlay("Informe um e-mail válido.", "otp-email");
      return;
    }

    var btn = document.getElementById(reenvio ? "ag-reenviar-codigo" : "ag-enviar-codigo");
    if (btn) btn.disabled = true;

    postAuthAction({ action: "enviarCodigoLogin", email: email }).then(function (res) {
      if (btn) btn.disabled = false;
      if (res && res.erro) {
        showLoginOverlay(res.erro, reenvio ? "otp-codigo" : "otp-email");
        return;
      }
      otpEmailPendente = email;
      // Mensagem sempre genérica: o backend não informa se o e-mail existe
      // ou não no cadastro (ver comentário em enviarCodigoLogin no Code.gs).
      showLoginOverlay(null, "otp-codigo");
    }).catch(function () {
      if (btn) btn.disabled = false;
      showLoginOverlay("Erro ao enviar o código. Tente novamente.", reenvio ? "otp-codigo" : "otp-email");
    });
  }

  function confirmarCodigoOtp(codigoDigitado) {
    var codigo = String(codigoDigitado || "").trim();
    if (!otpEmailPendente) { showLoginOverlay(null, "otp-email"); return; }
    if (!codigo) {
      showLoginOverlay("Informe o código recebido por e-mail.", "otp-codigo");
      return;
    }

    var btn = document.getElementById("ag-confirmar-codigo");
    if (btn) btn.disabled = true;

    postAuthAction({ action: "validarCodigoLogin", email: otpEmailPendente, codigo: codigo }).then(function (data) {
      if (btn) btn.disabled = false;
      if (!data || data.erro || !data.encontrado || data.ativo === false) {
        showLoginOverlay((data && data.erro) || "Não foi possível confirmar o código.", "otp-codigo");
        return;
      }
      session = {
        email: data.email,
        name: data.nome || data.email,
        picture: "",
        exp: Math.floor(Date.now() / 1000) + OTP_SESSION_SEGUNDOS,
        role: data.role,
        loja: data.loja || "",
        permissoes: data.permissoes || {},
        fetchedAt: Date.now()
      };
      otpEmailPendente = null;
      saveSessionToStorage(session);
      hideOverlay();
      injectAdminLink();
      proceedAfterAuth();
    }).catch(function () {
      if (btn) btn.disabled = false;
      showLoginOverlay("Erro ao confirmar o código. Tente novamente.", "otp-codigo");
    });
  }

  // ── Menu "Administração" (só para admins) ──────────────────────────────
  // Grupo padrão no menu lateral de TODAS as telas, no mesmo formato de
  // Comercial / Financeiro / Metas: ao clicar, abre embaixo
  //   • Atualização Geral   • Backup Geral   • Cadastro de Usuários
  // Fica aqui (e não em cada HTML) pra existir num lugar só.

  var DATA_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyHkPrEsO5BcqE8MzbnazuCZVe1LmHoH98e3SZo1Fzvwm01vnOK3z-ZIcfmwigp_LTv/exec";
  var METAS_APPS_SCRIPT_URL_BK = "https://script.google.com/macros/s/AKfycbzmpNN6di1R7wrW4bE-9BJ0EWZ4Hmt_9E4PesSdj8CgRLZFdApQsbUDJyFzXYOvvcWl/exec";
  var GLOBAL_REFRESH_KEY_ADM = "zappas_global_refresh_ts";
  var BACKUP_STORE_KEYS = ["anisio", "bady", "belvedere", "damha", "havan", "muffato"];
  var BACKUP_APP_FILES = [
    "GestaoZappas.html", "Administracao.html", "auth-common.js",
    "Analise_Comercial.html", "Faturamento_Lucro.html", "Faturamento_Detalhado.html", "Curva_ABC_Produto.html",
    "DRE_Gerencial.html", "Contas_a_Pagar.html", "Banco_Declaracao.html", "Reembolso.html", "Ciclo_Financeiro.html",
    "Elaboracao_Metas.html", "Acompanhamento_Metas.html", "Resultado_Meta.html"
  ];

  var ICON_ADMIN = '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 15a3 3 0 100-6 3 3 0 000 6z"/><path stroke-linecap="round" stroke-linejoin="round" d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>';
  var ICON_CHEV = '<svg class="chev" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>';
  var ICON_REFRESH = '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>';
  var ICON_DOWNLOAD = '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>';
  var ICON_USERS = '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>';

  function paginaAtual() {
    var p = (location.pathname.split("/").pop() || "").toLowerCase();
    return p;
  }

  function injectAdminStyles() {
    if (document.getElementById("auth-guard-admin-styles")) return;
    var st = document.createElement("style");
    st.id = "auth-guard-admin-styles";
    st.textContent =
      // Separador acima do grupo e itens-ação (são <a>, mesmo visual dos links)
      ".side-item[data-menu=admin]{margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,.08);}" +
      ".side-item[data-menu=admin] .side-sub a{cursor:pointer;}" +
      ".side-item[data-menu=admin] .side-sub a.ag-busy{opacity:.55;pointer-events:none;}" +
      // Overlay de progresso (Atualização Geral / Backup Geral)
      "#ag-adm-overlay{position:fixed;inset:0;z-index:99990;display:none;align-items:center;justify-content:center;background:rgba(10,20,40,.35);backdrop-filter:blur(2px);}" +
      "#ag-adm-overlay.show{display:flex;}" +
      "#ag-adm-overlay .ag-adm-card{background:#fff;border-radius:16px;padding:20px 24px;display:flex;align-items:center;gap:14px;min-width:300px;max-width:440px;box-shadow:0 12px 48px rgba(0,0,0,.25);font-family:'Epilogue',system-ui,sans-serif;}" +
      "#ag-adm-overlay .ag-adm-icon{width:40px;height:40px;border-radius:12px;background:#E4ECF6;color:#1B3D6E;display:flex;align-items:center;justify-content:center;flex-shrink:0;}" +
      "#ag-adm-overlay .ag-adm-icon svg{width:20px;height:20px;}" +
      "#ag-adm-overlay .ag-adm-icon.spin svg{animation:agAdmSpin .9s linear infinite;}" +
      "@keyframes agAdmSpin{to{transform:rotate(360deg);}}" +
      "#ag-adm-overlay .ag-adm-title{font-family:'Syne',system-ui,sans-serif;font-weight:700;font-size:14.5px;color:#16160F;}" +
      "#ag-adm-overlay .ag-adm-sub{font-size:12.5px;color:#787868;margin-top:2px;}" +
      "#ag-adm-overlay .ag-adm-sub.ok{color:#3E8F63;}" +
      "#ag-adm-overlay .ag-adm-sub.err{color:#B4483A;}";
    document.head.appendChild(st);
  }

  function admOverlay(titulo, icone) {
    var ov = document.getElementById("ag-adm-overlay");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "ag-adm-overlay";
      ov.innerHTML = '<div class="ag-adm-card"><div class="ag-adm-icon"></div><div><div class="ag-adm-title"></div><div class="ag-adm-sub"></div></div></div>';
      document.body.appendChild(ov);
    }
    var ic = ov.querySelector(".ag-adm-icon"), ti = ov.querySelector(".ag-adm-title"), sub = ov.querySelector(".ag-adm-sub");
    ic.innerHTML = icone; ic.classList.add("spin");
    ti.textContent = titulo; sub.className = "ag-adm-sub"; sub.textContent = "Aguarde…";
    ov.classList.add("show");
    return {
      msg: function (t) { sub.textContent = t; },
      fim: function (t, ok, depois) {
        ic.classList.remove("spin");
        sub.className = "ag-adm-sub " + (ok ? "ok" : "err");
        sub.textContent = t;
        setTimeout(function () { ov.classList.remove("show"); if (depois) depois(); }, ok ? 1800 : 4000);
      }
    };
  }

  // Atualização Geral: na tela inicial usa a função que já existe lá;
  // nas demais telas faz a mesma chamada e recarrega a tela no final,
  // pra ela já abrir com os dados novos.
  function acaoAtualizacaoGeral(el) {
    if (typeof window.gerarResumoMensal === "function" && document.getElementById("btn-gerar-resumo")) {
      window.gerarResumoMensal();
      return;
    }
    if (el) el.classList.add("ag-busy");
    var ui = admOverlay("Atualização Geral", ICON_REFRESH);
    ui.msg("Gerando resumo mensal, aguarde…");
    fetch(DATA_APPS_SCRIPT_URL + "?action=gerarResumo&_=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.text(); })
      .then(function (texto) {
        if (el) el.classList.remove("ag-busy");
        if (String(texto).indexOf("OK") === 0) {
          try { localStorage.setItem(GLOBAL_REFRESH_KEY_ADM, String(Date.now())); } catch (e) {}
          ui.fim("✓ " + String(texto).replace(/^OK - /, "") + " · recarregando a tela…", true, function () { location.reload(); });
        } else {
          ui.fim(texto || "Falha ao atualizar.", false);
        }
      })
      .catch(function (e) {
        if (el) el.classList.remove("ag-busy");
        ui.fim("Falha na conexão: " + e.message, false);
      });
  }

  function carregarJSZip() {
    if (window.JSZip) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
      s.onload = resolve;
      s.onerror = function () { reject(new Error("Não foi possível carregar a biblioteca de compactação (verifique a conexão).")); };
      document.head.appendChild(s);
    });
  }

  // Backup Geral: mesma lógica da tela inicial (dados + telas do app num .zip).
  function acaoBackupGeral(el) {
    if (el) el.classList.add("ag-busy");
    var ui = admOverlay("Backup Geral", ICON_DOWNLOAD);
    var falhas = [];
    var bust = "_bk=" + Date.now();
    function buscar(url, rotulo) {
      var sep = url.indexOf("?") >= 0 ? "&" : "?";
      return fetch(url + sep + bust, { cache: "no-store" })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
        .catch(function (e) { falhas.push(rotulo + ": " + e.message); return null; });
    }
    var tarefas = [];
    BACKUP_STORE_KEYS.forEach(function (l) {
      tarefas.push(["dados/faturamento/" + l + ".csv", DATA_APPS_SCRIPT_URL + "?loja=" + l, "Faturamento (" + l + ")"]);
      tarefas.push(["dados/contas_a_pagar/" + l + ".csv", DATA_APPS_SCRIPT_URL + "?tipo=ctaspagar&loja=" + l, "Contas a Pagar (" + l + ")"]);
      tarefas.push(["dados/recebidos/" + l + ".csv", DATA_APPS_SCRIPT_URL + "?tipo=recebidos&loja=" + l, "Recebidos (" + l + ")"]);
      tarefas.push(["dados/depara/" + l + ".csv", DATA_APPS_SCRIPT_URL + "?tipo=depara&loja=" + l, "De-Para (" + l + ")"]);
    });
    tarefas.push(["dados/plano_de_contas.csv", DATA_APPS_SCRIPT_URL + "?tipo=planocontas", "Plano de Contas"]);
    tarefas.push(["dados/metas.csv", METAS_APPS_SCRIPT_URL_BK, "Metas"]);
    BACKUP_APP_FILES.forEach(function (f) { tarefas.push(["app/" + f, f, "Tela " + f]); });

    carregarJSZip().then(function () {
      var zip = new window.JSZip();
      var i = 0;
      function proxima() {
        if (i >= tarefas.length) return Promise.resolve();
        var t = tarefas[i++];
        ui.msg(t[2] + " (" + i + "/" + tarefas.length + ")");
        return buscar(t[1], t[2]).then(function (txt) { if (txt) zip.file(t[0], txt); return proxima(); });
      }
      return proxima().then(function () {
        var agora = new Date();
        zip.file("LEIA-ME.txt", [
          "BACKUP GERAL — GESTÃO ZAPPAS",
          "Gerado em: " + agora.toLocaleString("pt-BR"),
          "",
          "  /dados → CSVs de Faturamento, Contas a Pagar, Recebidos, De-Para, Plano de Contas e Metas.",
          "  /app   → cópia das telas do painel (HTML) e do auth-common.js, como publicadas.",
          "",
          "O código do Apps Script não entra aqui: faça a cópia dele em script.google.com (Arquivo → Fazer uma cópia).",
          "",
          falhas.length ? "FALHAS NESTE BACKUP:\n  " + falhas.join("\n  ") : "Nenhuma falha — todas as fontes foram incluídas."
        ].join("\n"));
        ui.msg("Compactando arquivo…");
        return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } }).then(function (blob) {
          var nome = "Backup_Zappas_" + agora.toISOString().slice(0, 16).replace(/[-T:]/g, "").replace(/^(\d{8})(\d{4})$/, "$1_$2") + ".zip";
          var url = URL.createObjectURL(blob);
          var a = document.createElement("a");
          a.href = url; a.download = nome;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
          if (el) el.classList.remove("ag-busy");
          ui.fim(falhas.length ? "✓ Backup baixado com " + falhas.length + " falha(s) — veja o LEIA-ME.txt" : "✓ Backup baixado com sucesso", !falhas.length);
        });
      });
    }).catch(function (e) {
      if (el) el.classList.remove("ag-busy");
      ui.fim("Erro no backup: " + e.message, false);
    });
  }

  // ── Rodapé do menu: nome/e-mail do usuário logado + "Sair" ────────────
  // Padrão em todas as telas (para qualquer usuário). A tela de
  // Administração já tem esse bloco próprio (#side-user), então lá não
  // duplica.
  var ICON_SAIR = '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>';
  function escHtml(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function injectUserFooter() {
    if (!session) return;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", injectUserFooter);
      return;
    }
    if (document.getElementById("side-user") || document.getElementById("ag-user-footer")) return;
    var sidebar = document.querySelector(".sidebar");
    if (!sidebar) return;
    if (!document.getElementById("ag-user-footer-styles")) {
      var st = document.createElement("style");
      st.id = "ag-user-footer-styles";
      st.textContent =
        "#ag-user-footer{flex-shrink:0;padding:10px 10px 12px;border-top:1px solid rgba(255,255,255,.08);}" +
        "#ag-user-footer .ag-uf-info{padding:6px 11px 8px;overflow:hidden;}" +
        "#ag-user-footer .ag-uf-n{font-family:'Syne','Epilogue',system-ui,sans-serif;font-size:12px;font-weight:600;color:#fff;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}" +
        "#ag-user-footer .ag-uf-e{font-size:10.5px;color:rgba(255,255,255,.5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}" +
        "#ag-user-footer .ag-uf-sair{display:flex;align-items:center;gap:11px;width:100%;background:none;border:none;cursor:pointer;" +
        "color:rgba(255,255,255,.7);font-family:'Syne','Epilogue',system-ui,sans-serif;font-weight:600;font-size:13px;padding:9px 11px;border-radius:10px;text-align:left;}" +
        "#ag-user-footer .ag-uf-sair:hover{background:rgba(255,255,255,.07);color:#fff;}" +
        "#ag-user-footer .ag-uf-sair svg{width:18px;height:18px;flex-shrink:0;opacity:.85;}" +
        "#ag-user-footer .ag-uf-atualizar{color:#E9C46A;}" +
        "#ag-user-footer .ag-uf-atualizar.ag-busy{opacity:.55;pointer-events:none;}" +
        // Menu recolhido (só ícones): esconde nome/e-mail e centraliza o "Sair"
        ".sidebar.collapsed:not(.peek) #ag-user-footer .ag-uf-info," +
        ".sidebar.collapsed:not(.peek) #ag-user-footer .ag-uf-sair span{display:none;}" +
        ".sidebar.collapsed:not(.peek) #ag-user-footer .ag-uf-sair{justify-content:center;padding:11px 0;}";
      document.head.appendChild(st);
    }
    var nome = session.name || session.email;
    var div = document.createElement("div");
    div.id = "ag-user-footer";
    div.innerHTML =
      '<div class="ag-uf-info" title="' + escHtml(session.email) + '">' +
      '<div class="ag-uf-n">' + escHtml(nome) + "</div>" +
      (nome !== session.email ? '<div class="ag-uf-e">' + escHtml(session.email) + "</div>" : "") +
      "</div>" +
      (session.role !== "admin"
        ? '<button type="button" class="ag-uf-sair ag-uf-atualizar" title="Atualização Geral">' + ICON_REFRESH + "<span>Atualização Geral</span></button>"
        : "") +
      '<button type="button" class="ag-uf-sair" title="Sair">' + ICON_SAIR + "<span>Sair</span></button>";
    div.querySelector(".ag-uf-sair:not(.ag-uf-atualizar)").addEventListener("click", logout);
    // Tela inicial: esconde o rodapé antigo (botão "…" com Atualização /
    // Backup) para todos — Atualização Geral agora fica neste rodapé (ou no
    // grupo Administração, para admins) e Backup Geral é só de admin. O
    // HTML antigo continua na página porque a atualização automática usa.
    var rodapeAntigo = document.getElementById("side-footer-toggle");
    if (rodapeAntigo && rodapeAntigo.closest(".side-footer")) rodapeAntigo.closest(".side-footer").style.display = "none";
    var btnAtu = div.querySelector(".ag-uf-atualizar");
    if (btnAtu) btnAtu.addEventListener("click", function () { injectAdminStyles(); acaoAtualizacaoGeral(btnAtu); });
    sidebar.appendChild(div);
  }

  // ── Menu mostra só as telas liberadas para o usuário ──────────────────
  // Administrador vê tudo. Para os demais: some cada link de tela sem
  // permissão, os itens "(em breve)" e o grupo inteiro (Comercial,
  // Financeiro, Metas) quando não sobrar nenhuma tela dentro dele.
  function telaKeyDoHref(href) {
    var arq = String(href || "").split("?")[0].split("#")[0].split("/").pop().toLowerCase();
    if (!arq) return null;
    for (var k in TELAS) {
      if (TELAS.hasOwnProperty(k) && TELAS[k].href.toLowerCase() === arq) return k;
    }
    return null;
  }
  // Primeira tela que o usuário pode abrir (usada quando ele não tem
  // acesso à tela inicial: login, logo "Dashboards" e "Voltar ao início").
  function primeiraTelaLiberada() {
    if (!session) return null;
    if (session.role === "admin" || (session.permissoes || {}).home) return TELAS.home.href;
    for (var k in TELAS) {
      if (TELAS.hasOwnProperty(k) && k !== "home" && session.permissoes[k]) return TELAS[k].href;
    }
    return null;
  }

  function filtrarMenuPorPermissao() {
    if (!session) return;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", filtrarMenuPorPermissao);
      return;
    }
    var admin = session.role === "admin";
    var perms = session.permissoes || {};
    document.querySelectorAll(".sidebar .side-nav .side-item").forEach(function (item) {
      if (item.getAttribute("data-menu") === "admin") return;
      var links = item.querySelectorAll(".side-sub a");
      if (!links.length) return;
      var visiveis = 0;
      links.forEach(function (a) {
        var key = telaKeyDoHref(a.getAttribute("href"));
        var pode = admin || (key && !!perms[key]);
        a.style.display = pode ? "" : "none";
        if (pode) visiveis++;
      });
      item.style.display = visiveis ? "" : "none";
    });
    // Logo "Dashboards / Painel de Gestão": sem acesso à tela inicial,
    // leva para a primeira tela liberada em vez de cair em "acesso negado".
    var destino = primeiraTelaLiberada();
    document.querySelectorAll('.sidebar a.side-brand, a.side-brand').forEach(function (a) {
      if (destino) a.setAttribute("href", destino);
    });
    // Links soltos de tela direto no menu (fora de grupos)
    document.querySelectorAll(".sidebar .side-nav > a.side-link").forEach(function (a) {
      var key = telaKeyDoHref(a.getAttribute("href"));
      if (key && key !== "home") a.style.display = (admin || perms[key]) ? "" : "none";
    });
  }

  function injectAdminLink() {
    injectUserFooter();
    filtrarMenuPorPermissao();
    if (!session || session.role !== "admin") return;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", injectAdminLink);
      return;
    }
    var nav = document.querySelector(".sidebar .side-nav");
    if (!nav || nav.querySelector('.side-item[data-menu="admin"]')) return;
    injectAdminStyles();

    var naAdmin = paginaAtual() === "administracao.html";
    var item = document.createElement("div");
    item.className = "side-item" + (naAdmin ? " open active" : "");
    item.setAttribute("data-menu", "admin");
    item.innerHTML =
      '<button class="side-link" type="button" data-label="Administração">' + ICON_ADMIN + "<span>Administração</span>" + ICON_CHEV + "</button>" +
      '<div class="side-sub">' +
      '<a href="#" data-acao="atualizar">' + ICON_REFRESH + "Atualização Geral</a>" +
      '<a href="#" data-acao="backup">' + ICON_DOWNLOAD + "Backup Geral</a>" +
      '<a href="Administracao.html"' + (naAdmin ? ' class="active"' : "") + ">" + ICON_USERS + "Cadastro de Usuários</a>" +
      "</div>";
    nav.appendChild(item);

    // Abrir/fechar igual aos outros grupos (fecha os demais ao abrir).
    item.querySelector(".side-link").addEventListener("click", function () {
      var aberto = item.classList.contains("open");
      document.querySelectorAll(".side-item.open").forEach(function (i) { if (i !== item) i.classList.remove("open"); });
      item.classList.toggle("open", !aberto);
      var sb = document.getElementById("sidebar");
      try { if (sb && sb.classList.contains("collapsed") && item.classList.contains("open")) lastOpenMenu = "admin"; } catch (e) {}
    });
    // Abrir outro grupo fecha o de Administração.
    nav.addEventListener("click", function (ev) {
      var btn = ev.target.closest && ev.target.closest(".side-item > .side-link");
      if (btn && !item.contains(btn)) item.classList.remove("open");
    });
    item.querySelector('[data-acao="atualizar"]').addEventListener("click", function (ev) { ev.preventDefault(); acaoAtualizacaoGeral(this); });
    item.querySelector('[data-acao="backup"]').addEventListener("click", function (ev) {
      ev.preventDefault();
      acaoBackupGeral(this); // mesma rotina em todas as telas (inclui também Resultado Metas, Administração e auth-common.js)
    });

    // Tela inicial: o rodapé antigo (botão "…" com Atualização/Backup) fica
    // escondido pro admin — as ações agora estão no grupo acima. O HTML
    // continua na página porque a atualização automática da tela usa ele.
  }

  // ── Fluxo principal ─────────────────────────────────────────────────────

  // ── Atualização automática diária ──────────────────────────────────────
  // As telas guardam os dados no navegador e só buscam de novo quando
  // alguém roda "Atualização Geral" NESTE navegador. Usuário de loja nunca
  // passa pela tela inicial, então ficava vendo dados antigos. Agora, na
  // primeira tela aberta de cada dia, marcamos "há dado novo": cada tela
  // atualiza sozinha uma vez naquele dia (em segundo plano).
  var DAILY_KEY = "zappas_auto_daily_refresh";
  function marcarAtualizacaoDiaria() {
    try {
      var hoje = new Date().toLocaleDateString("pt-BR");
      if (localStorage.getItem(DAILY_KEY) === hoje) return;
      localStorage.setItem(DAILY_KEY, hoje);
      localStorage.setItem(GLOBAL_REFRESH_KEY_ADM, String(Date.now()));
    } catch (e) {}
  }

  function proceedAfterAuth() {
    if (!pendingScreenKey) return;
    marcarAtualizacaoDiaria();
    var key = pendingScreenKey;
    var cb = pendingCallback;
    pendingScreenKey = null;
    pendingCallback = null;

    var autorizado = session.role === "admin" || !!session.permissoes[key];
    logAcesso(session.email, key, session.role === "admin" ? "admin_override" : (autorizado ? "permitido" : "negado"));

    if (!autorizado) {
      // Usuário sem acesso à tela inicial (ex.: só Metas da loja dele):
      // em vez de "acesso negado", vai direto para a primeira tela liberada.
      var destino = primeiraTelaLiberada();
      if (key === "home" && destino && destino !== TELAS.home.href) {
        location.replace(destino);
        return;
      }
      showDeniedOverlay(key);
      return;
    }
    if (typeof cb === "function") cb(session);
  }

  function start(telaKey, callback) {
    pendingScreenKey = telaKey;
    pendingCallback = callback;

    injectStyles();

    session = loadSessionFromStorage();
    if (session) {
      injectAdminLink();
      // Revalida permissões/role em segundo plano (sem travar a página),
      // mas usa o que já está em cache para decidir agora.
      proceedAfterAuth();
      fetchUsuario(session.email).then(function (data) {
        if (data && data.encontrado && data.ativo !== false) {
          session.role = data.role;
          session.loja = data.loja || "";
          session.permissoes = data.permissoes || {};
          filtrarMenuPorPermissao(); // permissões podem ter mudado desde o último login
          saveSessionToStorage(session);
        }
      }).catch(function () {});
      return;
    }

    // Tela inicial agora é o login por código de e-mail; o script do Google
    // só é carregado se a pessoa clicar em "Fazer login com o Google".
    showLoginOverlay(null, "otp-email");
  }

  function logout() {
    clearSession();
    location.href = "GestaoZappas.html";
  }

  window.AuthGuard = {
    requireScreen: start,
    logout: logout,
    getSession: function () { return session; }
  };

  // Exposto para a tela de administração (Administracao.html) reutilizar a
  // mesma URL/token sem precisar redeclará-los em outro arquivo.
  window.__AUTH_APPS_SCRIPT_URL__ = AUTH_APPS_SCRIPT_URL;
  window.__AUTH_TOKEN__ = AUTH_TOKEN;
})(window);

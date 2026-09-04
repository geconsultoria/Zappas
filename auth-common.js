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

  // Mapa telaKey -> {label, href} usado no link "Administração" injetado no
  // rodapé do menu e nas mensagens de acesso negado.
  var TELAS = {
    home: { label: "Início", href: "GestaoZappas.html" },
    analise_comercial: { label: "Análise Comercial", href: "Analise_Comercial.html" },
    faturamento_lucro: { label: "Faturamento x Lucro", href: "Faturamento_Lucro.html" },
    faturamento_detalhado: { label: "Faturamento Detalhado", href: "Faturamento_Detalhado.html" },
    dre_gerencial: { label: "DFC Fluxo de Caixa", href: "DRE_Gerencial.html" },
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
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || !s.exp || Date.now() / 1000 > s.exp) return null;
      return s;
    } catch (e) {
      return null;
    }
  }

  function saveSessionToStorage(s) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {}
  }

  function clearSession() {
    session = null;
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
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

  function showLoginOverlay(errorMsg) {
    hideOverlay();
    var wrap = document.createElement("div");
    wrap.id = "auth-guard-overlay";
    wrap.innerHTML =
      '<div class="ag-card">' +
      '<div class="ag-icon"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">' +
      '<path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg></div>' +
      '<div class="ag-title">Painel de Gestão</div>' +
      '<div class="ag-sub">Entre com a conta Google cadastrada para você acessar este painel.</div>' +
      '<div class="ag-gsi" id="ag-gsi-btn"></div>' +
      (errorMsg ? '<div class="ag-err">' + errorMsg + "</div>" : "") +
      "</div>";
    document.body.appendChild(wrap);
    renderGoogleButton();
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
      '<a class="ag-back" href="GestaoZappas.html">Voltar ao início</a>' +
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

  function handleCredentialResponse(response) {
    var payload = decodeJwt(response.credential);
    if (!payload) { showLoginOverlay("Não foi possível validar o login. Tente novamente."); return; }

    var email = String(payload.email || "").toLowerCase();

    // Não exigimos mais domínio @zappas.com.br nem lista de exceções: quem
    // controla o acesso é o cadastro em Administração (getUsuario abaixo).
    // Isso permite cadastrar qualquer conta Google (inclusive Gmail pessoal)
    // direto na tela de Administração, sem precisar editar código.
    if (!payload.email_verified) {
      showLoginOverlay("Não foi possível confirmar seu e-mail com o Google. Tente novamente.");
      return;
    }

    fetchUsuario(email).then(function (data) {
      if (!data || !data.encontrado || data.ativo === false) {
        showLoginOverlay("Sua conta ainda não tem acesso liberado a este painel. Fale com um administrador.");
        return;
      }
      session = {
        email: email,
        name: payload.name || data.nome || email,
        picture: payload.picture || "",
        exp: payload.exp,
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
      showLoginOverlay("Erro ao verificar sua conta. Tente novamente em instantes.");
    });
  }

  // ── Link "Administração" no rodapé do menu (só para admins) ────────────

  function injectAdminLink() {
    if (!session || session.role !== "admin") return;
    if (document.getElementById("side-link-admin")) return;

    // Nem toda página tem um <div class="side-footer"> no rodapé do menu
    // (só GestaoZappas.html tem, por causa dos botões "Atualização Geral" /
    // "Backup Geral"). Nas demais, cria um rodapé simples dentro da sidebar
    // para o link "Administração" ter onde entrar.
    var footer = document.querySelector(".side-footer");
    if (!footer) {
      var sidebar = document.querySelector(".sidebar");
      if (!sidebar) return;
      footer = document.createElement("div");
      footer.className = "side-footer";
      footer.style.padding = "12px 10px 14px";
      footer.style.borderTop = "1px solid rgba(255,255,255,.08)";
      sidebar.appendChild(footer);
    }

    var a = document.createElement("a");
    a.id = "side-link-admin";
    a.className = "side-link";
    a.href = "Administracao.html";
    a.style.textDecoration = "none";
    a.style.display = "flex";
    a.title = "Administração";
    a.innerHTML =
      '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 15a3 3 0 100-6 3 3 0 000 6z"/><path stroke-linecap="round" stroke-linejoin="round" d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>' +
      "<span>Administração</span>";
    footer.insertBefore(a, footer.firstChild);
  }

  // ── Fluxo principal ─────────────────────────────────────────────────────

  function proceedAfterAuth() {
    if (!pendingScreenKey) return;
    var key = pendingScreenKey;
    var cb = pendingCallback;
    pendingScreenKey = null;
    pendingCallback = null;

    var autorizado = session.role === "admin" || !!session.permissoes[key];
    logAcesso(session.email, key, session.role === "admin" ? "admin_override" : (autorizado ? "permitido" : "negado"));

    if (!autorizado) {
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
          saveSessionToStorage(session);
        }
      }).catch(function () {});
      return;
    }

    showLoginOverlay();
    loadGisScript(function () {
      initGis();
      renderGoogleButton();
    });
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

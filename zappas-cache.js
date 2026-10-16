/* ═══════════════════════════════════════════════════════════════════
   zappas-cache.js — cache compartilhado entre TODAS as telas do painel
   Versão v2026.10.16-b

   Carregue este arquivo como o PRIMEIRO script do <head> de cada tela:
     <script src="zappas-cache.js"></script>

   O que ele faz:
   1) Guarda no navegador (IndexedDB) a resposta de cada planilha buscada
      no Apps Script de dados (?loja=…, ?tipo=curvaabc…, ?tipo=ctaspagar…
      etc.). Quando outra tela pede a MESMA planilha, recebe a cópia
      guardada na hora, desde que:
        • a cópia tenha sido buscada DEPOIS da última alteração dos
          arquivos no Drive (consultada em ?tipo=versao), e
        • ninguém tenha pedido uma atualização forçada depois dela
          (Atualização Geral manual, meta gravada), e
        • tenha menos de 12 horas.
      Ex.: a Curva ABC baixa os produtos; o Faturamento x Lucro e o DRE
      usam a mesma base e passam a abrir sem baixar de novo.
   2) Guarda a hora da última alteração do Drive ("zappas_drive_ts") para
      as telas decidirem se o próprio cache ainda está em dia
      (ZappasCache.semMudancaDesde).

   Segurança: se algo der errado (sem IndexedDB, sem ?tipo=versao, erro de
   leitura), simplesmente busca na rede como antes. Se este arquivo não
   for encontrado, as telas funcionam normalmente, só sem o cache.
═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.ZappasCache) return;

  // Só o Apps Script de DADOS. O de metas/login (outro endereço) nunca
  // passa por aqui, porque não sabemos se as planilhas dele estão na
  // pasta monitorada pelo ?tipo=versao.
  var BASE = 'https://script.google.com/macros/s/AKfycbyHkPrEsO5BcqE8MzbnazuCZVe1LmHoH98e3SZo1Fzvwm01vnOK3z-ZIcfmwigp_LTv/exec';
  var MAX_IDADE = 12 * 60 * 60 * 1000;   // cópia com mais de 12h é ignorada
  var VALIDADE_VERSAO = 2 * 60 * 1000;   // reconsulta ?tipo=versao a cada 2 min
  var JANELA_REPETICAO = 20 * 1000;      // mesma planilha pedida de novo em 20s = nova tentativa → vai à rede

  // Pede ao navegador para não apagar estes dados sozinho por falta de espaço.
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}

  function lsNum(k) { try { return parseInt(localStorage.getItem(k) || '0', 10) || 0; } catch (e) { return 0; } }
  function lsSet(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) {} }

  /* ── IndexedDB ── */
  var dbP = null;
  function db() {
    if (!dbP) dbP = new Promise(function (res, rej) {
      var rq = indexedDB.open('zappasFetchCacheDB', 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore('r'); };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error); };
    }).catch(function () { return null; });
    return dbP;
  }
  function idbGet(k) {
    return db().then(function (d) {
      if (!d) return null;
      return new Promise(function (res) {
        try {
          var rq = d.transaction('r', 'readonly').objectStore('r').get(k);
          rq.onsuccess = function () { res(rq.result || null); };
          rq.onerror = function () { res(null); };
        } catch (e) { res(null); }
      });
    });
  }
  function idbPut(k, v) {
    return db().then(function (d) {
      if (!d) return;
      try { d.transaction('r', 'readwrite').objectStore('r').put(v, k); } catch (e) {}
    });
  }

  /* ── Hora da última alteração no Drive ── */
  var origFetch = window.fetch.bind(window);
  var versaoP = null, versaoEm = 0;
  function driveTs() {
    if (versaoP && Date.now() - versaoEm < VALIDADE_VERSAO) return versaoP;
    versaoEm = Date.now();
    var tempo = new Promise(function (res) { setTimeout(function () { res(0); }, 12000); });
    var busca = origFetch(BASE + '?tipo=versao&_=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (t) {
        var d = 0; try { d = +JSON.parse(t).ultimaAlteracao || 0; } catch (e) {}
        if (d) lsSet('zappas_drive_ts', d);
        return d;
      })
      .catch(function () { return 0; });
    versaoP = Promise.race([busca, tempo]);
    return versaoP;
  }

  /* ── Quais pedidos entram no cache ── */
  function chave(url) {
    var u;
    try { u = new URL(url, location.href); } catch (e) { return null; }
    if (u.origin + u.pathname !== BASE) return null;
    u.searchParams.delete('_'); u.searchParams.delete('_cb');
    if (!u.searchParams.toString()) return null;
    if (u.searchParams.has('action')) return null;               // ações (gerarResumo, salvar…) nunca
    if (u.searchParams.get('tipo') === 'versao') return null;
    u.searchParams.sort();
    return u.origin + u.pathname + '?' + u.searchParams.toString();
  }
  function pareceValido(t) {
    if (!t || t.length < 10) return false;
    var ini = t.slice(0, 400).toLowerCase().trim();
    if (ini.charAt(0) === '<') return false;                     // página de erro/login do Google
    if (/exception|"erro"|^erro|^error/.test(ini)) return false;
    return true;
  }

  var servidoEm = {};
  async function viaCache(k, input, init) {
    var agora = Date.now();
    var repetido = servidoEm[k] && (agora - servidoEm[k] < JANELA_REPETICAO);
    if (!repetido) {
      try {
        var res = await Promise.all([idbGet(k), driveTs()]);
        var ent = res[0], d = res[1];
        var forcado = lsNum('zappas_forcar_ts');
        if (ent && d && ent.ts >= d && ent.ts >= forcado && agora - ent.ts < MAX_IDADE && typeof ent.text === 'string') {
          servidoEm[k] = agora;
          return new Response(ent.text, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Zappas-Cache': '1' } });
        }
      } catch (e) { /* cai na rede */ }
    }
    var inicio = Date.now();                                     // hora do INÍCIO da busca: conservador
    var r = await origFetch(input, init);
    if (r.ok) {
      try {
        r.clone().text().then(function (t) { if (pareceValido(t)) idbPut(k, { ts: inicio, text: t }); }).catch(function () {});
      } catch (e) {}
    }
    return r;
  }

  window.fetch = function (input, init) {
    try {
      var url = typeof input === 'string' ? input : (input && input.url);
      var metodo = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      var k = (url && metodo === 'GET') ? chave(url) : null;
      if (k) return viaCache(k, input, init);
    } catch (e) {}
    return origFetch(input, init);
  };

  window.ZappasCache = {
    /* true quando se sabe que o Drive NÃO mudou desde "ts" e nenhuma
       atualização forçada foi pedida depois — ou seja, um cache salvo em
       "ts" ainda está em dia. Na dúvida, devolve false. */
    semMudancaDesde: function (ts) {
      var d = lsNum('zappas_drive_ts'), f = lsNum('zappas_forcar_ts');
      return !!(ts && d && d <= ts && f <= ts);
    },
    /* Atualização pedida de propósito (Atualização Geral manual, meta
       gravada): invalida todos os caches, mesmo sem mudança no Drive. */
    forcar: function () { var t = Date.now(); lsSet('zappas_forcar_ts', t); return t; },
    /* Apaga todas as cópias guardadas (diagnóstico). */
    limpar: function () {
      return db().then(function (d) { if (d) try { d.transaction('r', 'readwrite').objectStore('r').clear(); } catch (e) {} });
    }
  };
})();

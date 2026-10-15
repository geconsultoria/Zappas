/* ══════════════════════════════════════════════════════════════
   MENU LATERAL ÚNICO DO PAINEL ZAPPAS
   ──────────────────────────────────────────────────────────────
   Este é o ÚNICO lugar para mudar o menu. Toda tela tem, logo depois
   do </aside>, a linha:
       <script src="menu-zappas.js"></script>
   que redesenha o menu com o conteúdo abaixo e marca sozinha a tela
   aberta (grupo aberto + link em destaque).

   PARA INCLUIR / RENOMEAR / TIRAR UMA TELA:
     1. Edite o bloco MENU_ZAPPAS_HTML abaixo (copie um <a>…</a> parecido).
     2. Publique só este arquivo. Todas as telas passam a mostrar o menu novo
        (o navegador pode levar alguns minutos para buscar a versão nova;
        Ctrl+F5 força na hora).
     3. Tela nova também precisa de permissão: em Administracao.html
        (TELA_LABELS/GRUPOS_TELAS) e no AuthGuard.requireScreen da tela.

   O grupo "Administração" continua sendo incluído pelo auth-common.js.
   O menu escrito dentro de cada .html fica só como reserva, caso este
   arquivo não carregue.
══════════════════════════════════════════════════════════════ */
(function () {
  var MENU_ZAPPAS_HTML = `
    <div class="side-item" data-menu="comercial">
      <button class="side-link" type="button" id="side-link-comercial" data-label="Comercial">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 3v18h18M7 15l4-5 3 3 5-7"/></svg>
        <span>Comercial</span>
        <svg class="chev" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
      </button>
      <div class="side-sub">
        <a href="Analise_Comercial.html" id="link-analise-comercial">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 17V9m4 8V5m4 12v-6M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
          Análise Comercial
        </a>
        <a href="Faturamento_Lucro.html">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 17l6-6 4 4 8-8M21 7v6M21 7h-6"/></svg>
          Faturamento x Lucro
        </a>
        <a href="Faturamento_Detalhado.html" id="link-faturamento-detalhado">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
          Faturamento Detalhado
        </a>
        <a href="Curva_ABC_Produto.html">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 19V10m6 9V4m6 15v-6"/><path stroke-linecap="round" stroke-linejoin="round" d="M3 19h18"/></svg>
          Curva ABC Produto
        </a>
      </div>
    </div>

    <div class="side-item" data-menu="financeiro">
      <button class="side-link" type="button" data-label="Financeiro">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
        <span>Financeiro</span>
        <svg class="chev" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
      </button>
      <div class="side-sub">
        <a href="DRE_Gerencial.html">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"/><path stroke-linecap="round" stroke-linejoin="round" d="M14 2v6h6M9 13h6M9 17h6"/></svg>
          Demonstrativo de Resultado
        </a>
        <a href="Orcamento_2027.html">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="17" rx="2"/><path stroke-linecap="round" stroke-linejoin="round" d="M3 9h18M8 2v4M16 2v4M7 13h4M7 17h7"/></svg>
          Orçamento 2027
        </a>
        <a href="Contas_a_Pagar.html">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path stroke-linecap="round" stroke-linejoin="round" d="M12 16V8m-3 3l3-3 3 3"/></svg>
          Contas a Pagar
        </a>
        <a href="#" onclick="return false" style="opacity:0.4;pointer-events:none">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v8m-3-3l3 3 3-3"/></svg>
          Contas a Receber <span style="font-size:10px;margin-left:4px">(em breve)</span>
        </a>
        <a href="#" onclick="return false" style="opacity:0.4;pointer-events:none">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 12h4l2-7 4 14 2-7h6"/></svg>
          Fluxo de Caixa <span style="font-size:10px;margin-left:4px">(em breve)</span>
        </a>
        <a href="Banco_Declaracao.html">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 21h18M4 21V9l8-6 8 6v12M9 21v-6h6v6"/></svg>
          Banco
        </a>
        <a href="Reembolso.html">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 14l-4-4 4-4"/><path stroke-linecap="round" stroke-linejoin="round" d="M20 20v-7a4 4 0 00-4-4H5"/></svg>
          Reembolso entre Lojas
        </a>
        <a href="Ciclo_Financeiro.html">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3M12 3a9 9 0 100 18 9 9 0 000-18z"/></svg>
          Ciclo Financeiro
        </a>
        <a href="Endividamento.html">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/><path stroke-linecap="round" d="M17 7L7 17"/></svg>
          Controle de Endividamento
        </a>
      </div>
    </div>

    <div class="side-item" data-menu="metas">
      <button class="side-link" type="button" data-label="Metas">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>
        <span>Metas</span>
        <svg class="chev" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
      </button>
      <div class="side-sub">
        <a href="Elaboracao_Metas.html">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11 4H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2v-5M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Elaboração de Metas
        </a>
        <a href="Acompanhamento_Metas.html">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path stroke-linecap="round" stroke-linejoin="round" d="M22 4L12 14.01l-3-3"/></svg>
          Acompanhamento de Metas
        </a>
        <a href="Resultado_Meta.html">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 17V9m4 8V5m4 12v-6M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
          Resultado Metas
        </a>
      </div>
    </div>

`;

  // Arquivo da tela aberta (ex.: "DRE_Gerencial.html").
  var atual = decodeURIComponent((location.pathname.split('/').pop() || '')).split('?')[0];

  function aplicar(nav) {
    if (!nav || nav.getAttribute('data-menu-zappas') === '1') return;
    // Mantém grupos que outras partes do sistema já tenham incluído (ex.: Administração).
    var extras = [].slice.call(nav.querySelectorAll('[data-menu-extra], .side-item[data-menu="admin"], .side-item[data-menu="administracao"]'));
    nav.innerHTML = MENU_ZAPPAS_HTML;
    extras.forEach(function (el) { nav.appendChild(el); });
    nav.setAttribute('data-menu-zappas', '1');

    if (!atual) return;
    var links = nav.querySelectorAll('.side-sub a[href]');
    for (var i = 0; i < links.length; i++) {
      if (links[i].getAttribute('href') === atual) {
        links[i].classList.add('active');
        var grupo = links[i].closest('.side-item');
        if (grupo) { grupo.classList.add('active'); grupo.classList.add('open'); }
        break;
      }
    }

    // Telas que não têm o próprio controle de abrir/fechar grupos
    // (marcadas com data-menu-toggle="auto" no <aside>) usam este.
    var aside = nav.closest('aside');
    if (aside && aside.getAttribute('data-menu-toggle') === 'auto') {
      nav.querySelectorAll('.side-item > .side-link').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var it = btn.closest('.side-item'), aberto = it.classList.contains('open');
          nav.querySelectorAll('.side-item.open').forEach(function (x) { x.classList.remove('open'); });
          it.classList.toggle('open', !aberto);
        });
      });
    }
  }

  // Normalmente o script fica logo depois do </aside>: redesenha na hora,
  // antes dos scripts da tela que ligam os cliques do menu.
  var nav = document.querySelector('#sidebar .side-nav, .sidebar .side-nav');
  if (nav) aplicar(nav);
  else document.addEventListener('DOMContentLoaded', function () {
    aplicar(document.querySelector('#sidebar .side-nav, .sidebar .side-nav'));
  });
})();

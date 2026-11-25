/* Hilads back office: the few behaviours every page shares. No framework, no build step. */
(function () {
  'use strict';
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  // ── Theme: system by default, or the one picked with the toggle ──────
  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-theme-toggle]');
    if (!b) return;
    var cur = store.get('admin_theme') || 'system';
    var next = cur === 'system' ? 'light' : cur === 'light' ? 'dark' : 'system';
    store.set('admin_theme', next);
    applyTheme(next);
    toast('Theme: ' + (next === 'system' ? 'same as this computer' : next));
  });

  // ── Toasts (flash messages are turned into toasts) ───────────────────
  function toastBox() {
    var box = document.querySelector('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
    return box;
  }
  function toast(text, kind) {
    var t = document.createElement('div');
    t.className = 'toast' + (kind === 'error' ? ' error' : '');
    var span = document.createElement('span'); span.textContent = text; t.appendChild(span);
    var x = document.createElement('button'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.textContent = '×';
    x.onclick = function () { t.remove(); }; t.appendChild(x);
    toastBox().appendChild(t);
    if (kind !== 'error') setTimeout(function () { t.remove(); }, 6000);
  }
  window.adminToast = toast;

  // ── Confirm dialog: <form data-confirm="Title" data-confirm-text="…" data-phrase="RESET"> ──
  // The typed phrase is also checked on the server; this only saves a round trip.
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f.matches || f.dataset.confirmed === '1') return;
    // The confirm can sit on the form, or on the button that submits it (row actions in a list form).
    var src = e.submitter && e.submitter.dataset && e.submitter.dataset.confirm ? e.submitter : f;
    if (!src.dataset || !src.dataset.confirm) return;
    e.preventDefault();
    var phrase = src.dataset.phrase || '';
    var d = document.createElement('dialog'); d.className = 'confirm';
    d.innerHTML = '<form method="dialog"><div class="dlg-body"><h2></h2><p></p>' +
      (phrase ? '<div class="field"><label>Type <span class="phrase"></span> to confirm</label><input autocomplete="off" spellcheck="false"></div>' : '') +
      '</div><div class="dlg-actions"><button class="btn" value="cancel">Cancel</button><button class="btn ' +
      (src.dataset.danger === '0' ? 'btn-primary' : 'btn-danger-solid') + '" value="ok"></button></div></form>';
    d.querySelector('h2').textContent = src.dataset.confirm;
    d.querySelector('p').textContent = src.dataset.confirmText || '';
    var ok = d.querySelector('button[value=ok]');
    ok.textContent = src.dataset.confirmButton || 'Confirm';
    if (phrase) {
      d.querySelector('.phrase').textContent = phrase;
      var inp = d.querySelector('input');
      ok.disabled = true;
      inp.addEventListener('input', function () { ok.disabled = inp.value.trim().toUpperCase() !== phrase.toUpperCase(); });
    }
    document.body.appendChild(d);
    d.addEventListener('close', function () {
      if (d.returnValue === 'ok') {
        if (phrase) {
          var h = f.querySelector('input[name=confirm_phrase]');
          if (!h) { h = document.createElement('input'); h.type = 'hidden'; h.name = 'confirm_phrase'; f.appendChild(h); }
          h.value = d.querySelector('input').value;
        }
        f.dataset.confirmed = '1';
        if (e.submitter && e.submitter.name) {
          var s = document.createElement('input'); s.type = 'hidden'; s.name = e.submitter.name; s.value = e.submitter.value; f.appendChild(s);
        }
        f.submit();
      }
      d.remove();
    });
    d.showModal();
    if (phrase) d.querySelector('input').focus();
  });

  // ── Phrase inputs on a page (Danger zone): enable the button only when it matches ──
  document.querySelectorAll('input[data-phrase-for]').forEach(function (inp) {
    var btn = document.getElementById(inp.dataset.phraseFor);
    if (!btn) return;
    var check = function () { btn.disabled = inp.value.trim().replace(/\s+/g, ' ').toUpperCase() !== inp.dataset.phrase.toUpperCase(); };
    inp.addEventListener('input', check); check();
  });

  // ── Sidebar: groups remember open/closed; mobile menu ────────────────
  document.querySelectorAll('details.navgroup[data-group]').forEach(function (g) {
    var k = 'admin_nav_' + g.dataset.group, v = store.get(k);
    if (v === 'closed' && !g.querySelector('[aria-current]')) g.removeAttribute('open');
    if (v === 'open') g.setAttribute('open', '');
    g.addEventListener('toggle', function () { store.set(k, g.open ? 'open' : 'closed'); });
  });
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-menu]')) { document.body.classList.toggle('nav-open'); return; }
    if (document.body.classList.contains('nav-open') && !e.target.closest('.sidebar')) document.body.classList.remove('nav-open');
  });

  // ── "/" focuses the search ───────────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    if (e.key !== '/' || e.metaKey || e.ctrlKey) return;
    var t = e.target.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || e.target.isContentEditable) return;
    var s = document.getElementById('admin-search');
    if (s) { e.preventDefault(); s.focus(); s.select(); }
  });

  // ── Filters that apply on change: <select data-autosubmit> ───────────
  document.addEventListener('change', function (e) {
    if (e.target.matches('[data-autosubmit]') && e.target.form) e.target.form.submit();
  });

  // ── Sortable tables: <table data-sortable> with <th data-sort> (client side, current page) ──
  document.querySelectorAll('table[data-sortable]').forEach(function (table) {
    table.querySelectorAll('th[data-sort]').forEach(function (th, idx) {
      th.addEventListener('click', function () {
        var col = Array.prototype.indexOf.call(th.parentNode.children, th);
        var dir = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
        table.querySelectorAll('th[aria-sort]').forEach(function (o) { o.removeAttribute('aria-sort'); });
        th.setAttribute('aria-sort', dir);
        var body = table.tBodies[0];
        var rows = Array.prototype.slice.call(body.rows);
        var num = th.dataset.sort === 'num';
        rows.sort(function (a, b) {
          var x = a.cells[col] ? (a.cells[col].dataset.v || a.cells[col].textContent.trim()) : '';
          var y = b.cells[col] ? (b.cells[col].dataset.v || b.cells[col].textContent.trim()) : '';
          var r = num ? (parseFloat(x.replace(/[^\d.-]/g, '')) || 0) - (parseFloat(y.replace(/[^\d.-]/g, '')) || 0) : x.localeCompare(y);
          return dir === 'ascending' ? r : -r;
        });
        rows.forEach(function (r) { body.appendChild(r); });
      });
    });
  });

  // ── Bulk selection: <table data-bulk> with .sel-all + .sel-row checkboxes, a .bulk bar ──
  document.querySelectorAll('[data-bulk]').forEach(function (scope) {
    var all = scope.querySelector('.sel-all'), bar = scope.querySelector('.bulk');
    var rows = function () { return scope.querySelectorAll('.sel-row'); };
    var sync = function () {
      var n = 0;
      rows().forEach(function (c) { var tr = c.closest('tr'); if (tr) tr.classList.toggle('sel', c.checked); if (c.checked) n++; });
      if (bar) { bar.hidden = n === 0; var c = bar.querySelector('.bulk-count'); if (c) c.textContent = n; }
      if (all) all.checked = n > 0 && n === rows().length;
    };
    if (all) all.addEventListener('change', function () { rows().forEach(function (c) { c.checked = all.checked; }); sync(); });
    scope.addEventListener('change', function (e) { if (e.target.classList.contains('sel-row')) sync(); });
    sync();
  });

  // ── Flash messages ───────────────────────────────────────────────────
  // Success messages become a toast; errors stay in the page where they are hard to miss.
  document.querySelectorAll('.flash-success').forEach(function (f) {
    toast(f.textContent.trim(), 'ok');
    f.remove();
  });
})();

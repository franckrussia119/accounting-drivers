/* ═══════════════════════════════════════════════════════════════════════
   YM-TRANSIT v4.31 — module bureau
   1. Sorties port   : fiches envoyées par l'agent → contrôle → import en voyages
   2. Échanges       : qui conduit quel camion, échanges temporaires
   3. Rapports       : échanges dans le dossier chauffeur et la fiche camion
   4. Formulaire voyage : détection automatique d'échange
   5. Assistant IA   : questions en français / anglais (Google Gemini)
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => (typeof formatFCFA === 'function' ? formatFCFA(n) : `${Math.round(Number(n) || 0).toLocaleString('fr-FR')} FCFA`);
  const num = n => Math.round(Number(n) || 0).toLocaleString('fr-FR');
  const digits = v => parseInt(String(v ?? '').replace(/[^\d]/g, ''), 10) || 0;
  const toast = (m, t) => (typeof showToast === 'function' ? showToast(m, t) : alert(m));
  // `state` est déclaré par le script principal (const global, non attaché à window)
  const ST = () => (typeof state !== 'undefined' ? state : {});
  const role = () => ST().userRole || window.userRole || 'viewer';
  const canWrite = () => ['superadmin', 'editor'].includes(role());
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const dFr = iso => { if (!iso) return '—'; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
  const cap = t => t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
  const dLong = iso => iso ? new Date(String(iso).slice(0, 10) + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) : '—';
  const STATUS = { brouillon: 'Brouillon (chez l\'agent)', soumis: 'À traiter', valide: 'Validée' };
  const ROW_STATUS = { en_attente: 'À importer', importe: 'Importée', rejete: 'Rejetée' };
  const ICON = {
    back: '<svg class="v4-svg" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>',
    print: '<svg class="v4-svg" viewBox="0 0 24 24"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
    phone: '<svg class="v4-svg" viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>',
    swap: '<svg class="v4-svg" viewBox="0 0 24 24"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
    spark: '<svg class="v4-ai-svg" viewBox="0 0 24 24"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>',
    close: '<svg class="v4-ai-svg" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    gear: '<svg class="v4-ai-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    trash: '<svg class="v4-ai-svg" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>',
    mic: '<svg class="v4-ai-svg" viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="18" x2="12" y2="22"/></svg>',
    send: '<svg class="v4-ai-svg" viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>'
  };

  async function api(method, url, body) {
    const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || `Erreur ${r.status}`); e.status = r.status; e.data = j; throw e; }
    return j;
  }

  function modal(title, bodyHtml, footHtml) {
    const m = document.createElement('div');
    m.className = 'v4-modal';
    m.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="hd"><h3>${esc(title)}</h3><button class="btn-icon" data-x aria-label="Fermer">&times;</button></div>
      <div class="bd">${bodyHtml}</div>${footHtml ? `<div class="ft">${footHtml}</div>` : ''}</div>`;
    const close = () => { m.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-x]')) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(m);
    m.close = close;
    return m;
  }
  function confirmV4(title, html, okLabel = 'Confirmer', danger = false) {
    return new Promise(res => {
      const m = modal(title, `<div style="font-size:.88rem;color:var(--text-main);line-height:1.55">${html}</div>`,
        `<button class="btn btn-secondary" data-no>Annuler</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(okLabel)}</button>`);
      m.querySelector('[data-ok]').onclick = () => { m.close(); res(true); };
      m.querySelector('[data-no]').onclick = () => { m.close(); res(false); };
    });
  }

  const driversList = () => ST().drivers || [];
  const trucksList = () => ST().trucks || [];
  const driverOptions = (sel, withEmpty = '— Choisir —') => `<option value="">${withEmpty}</option>` + driversList().filter(d => d.is_active !== false && d.is_active !== 0).map(d => `<option value="${d.id}" ${String(sel) === String(d.id) ? 'selected' : ''}>${esc(d.name)}${d.assigned_truck ? ' (' + esc(d.assigned_truck) + ')' : ''}</option>`).join('');
  const truckOptions = (sel, withEmpty = '— Choisir —') => `<option value="">${withEmpty}</option>` + trucksList().map(t => `<option value="${esc(t.code)}" ${String(sel).toUpperCase() === String(t.code).toUpperCase() ? 'selected' : ''}>${esc(t.code)} · ${esc(t.license_plate)}</option>`).join('');

  // ═════════════════════════════════════════════════════════════════════
  // 1. SORTIES PORT
  // ═════════════════════════════════════════════════════════════════════
  const P = { filter: 'soumis', q: '', sheets: [], sheet: null, subs: [] };

  async function refreshPortBadge() {
    try {
      const r = await api('GET', '/api/port/pending-count');
      const b = $('sidebar-port-badge');
      if (b) { b.textContent = r.sheets; b.style.display = r.sheets > 0 ? '' : 'none'; b.title = `${r.rows} ligne(s) à importer`; }
    } catch (_) {}
  }

  async function loadPortExits() {
    const root = $('view-port-exits');
    if (!root) return;
    P.sheet = null;
    root.innerHTML = `<div class="v4-head"><div><h2>Sorties port</h2><p>Fiches remplies par l'agent au port sur son téléphone. Vérifiez chaque camion, complétez la recette et importez : le voyage est créé au bon chauffeur, avec l'échange de camion et l'avance.</p></div>
      <div class="v4-actions"><button class="btn btn-secondary btn-sm" id="v4-agent-link">${ICON.phone} Application de l'agent</button>${canWrite() ? `<button class="btn btn-secondary btn-sm" id="v4-new-sheet">Saisir une fiche papier</button>` : ''}</div></div>
      <div class="data-card"><div class="v4-toolbar">
        <div class="v4-seg" id="v4-port-seg">
          <button data-f="soumis">À traiter</button><button data-f="brouillon">Chez l'agent</button><button data-f="valide">Validées</button><button data-f="">Toutes</button>
        </div>
        <input class="form-control" id="v4-port-q" placeholder="Rechercher : conteneur, BL, camion, chauffeur, client…" style="max-width:340px" value="${esc(P.q)}">
      </div><div id="v4-port-list" class="v4-sheet-list"><div class="v4-empty">Chargement…</div></div></div>`;
    root.querySelectorAll('#v4-port-seg button').forEach(b => {
      b.classList.toggle('on', b.dataset.f === P.filter);
      b.onclick = () => { P.filter = b.dataset.f; root.querySelectorAll('#v4-port-seg button').forEach(x => x.classList.toggle('on', x === b)); fetchSheets(); };
    });
    let t;
    $('v4-port-q').oninput = e => { clearTimeout(t); t = setTimeout(() => { P.q = e.target.value; fetchSheets(); }, 250); };
    $('v4-agent-link').onclick = showAgentLink;
    if ($('v4-new-sheet')) $('v4-new-sheet').onclick = newPaperSheet;
    fetchSheets();
    refreshPortBadge();
  }

  async function fetchSheets() {
    const list = $('v4-port-list');
    try {
      const qs = new URLSearchParams();
      if (P.filter) qs.set('status', P.filter);
      if (P.q.trim()) qs.set('q', P.q.trim());
      P.sheets = await api('GET', '/api/port/sheets?' + qs);
      // compteur sur le bouton "À traiter"
      const pending = P.filter === 'soumis' ? P.sheets.length : null;
      const segBtn = document.querySelector('#v4-port-seg button[data-f="soumis"]');
      if (segBtn && pending !== null) segBtn.innerHTML = `À traiter${pending ? `<span class="n">${pending}</span>` : ''}`;
      if (!P.sheets.length) {
        list.innerHTML = `<div class="v4-empty"><b>${P.filter === 'soumis' ? 'Rien à traiter' : 'Aucune fiche'}</b>${P.filter === 'soumis' ? 'Les fiches envoyées par l\'agent au port apparaîtront ici.' : 'Changez le filtre ou la recherche.'}</div>`;
        return;
      }
      list.innerHTML = P.sheets.map(s => {
        const t = s.totals || {};
        return `<button class="v4-sheet is-${s.status}" data-id="${s.id}">
          <div class="v4-date"><b>${dFr(s.sheet_date)}</b><span>${esc(cap(dLong(s.sheet_date).split(' ')[0]))}</span></div>
          <div class="who"><b>${esc(s.agent_name || s.created_by || '—')}</b> · <span style="display:inline">${esc(s.port || '')}</span><span>${esc(s.sheet_no)}</span></div>
          <div class="v4-figs"><div><b>${t.rows_total || 0}</b>camions</div><div><b>${t.rows_pending || 0}</b>à importer</div><div><b>${num(t.total_carburant)}</b>carburant</div><div><b>${num(t.total_avance)}</b>avances</div></div>
          <span class="v4-chip ${s.status}">${STATUS[s.status]}</span>
        </button>`;
      }).join('');
      list.querySelectorAll('[data-id]').forEach(b => b.onclick = () => openPortSheet(+b.dataset.id));
    } catch (e) {
      list.innerHTML = `<div class="v4-empty"><b>Erreur</b>${esc(e.message)}</div>`;
    }
  }

  function showAgentLink() {
    const url = `${location.origin}/port`;
    const m = modal("Application de l'agent au port", `<div class="v4-qr">
        <div id="v4-qr-box"></div>
        <div><div style="font-size:.86rem;color:var(--text-main)">L'agent ouvre ce lien sur son téléphone (ou scanne le code) :</div>
        <code>${esc(url)}</code>
        <button class="btn btn-secondary btn-sm" id="v4-copy">Copier le lien</button>
        <ol><li>Créez-lui un compte au rôle <b>agent_port</b> dans Administration.</li><li>Il se connecte, puis menu du navigateur → <b>Ajouter à l'écran d'accueil</b> : l'application s'installe comme une appli.</li><li>Sans réseau, ses saisies restent sur le téléphone et partent toutes seules au retour du réseau.</li></ol></div></div>`);
    m.querySelector('#v4-copy').onclick = () => { navigator.clipboard?.writeText(url).then(() => toast('Lien copié')); };
    const draw = () => { try { new QRCode(m.querySelector('#v4-qr-box'), { text: url, width: 150, height: 150, colorDark: '#13233f', colorLight: '#ffffff' }); } catch (_) {} };
    if (window.QRCode) draw();
    else { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'; s.onload = draw; document.head.appendChild(s); }
  }

  async function newPaperSheet() {
    const m = modal('Saisir une fiche papier', `<p style="font-size:.84rem;color:var(--text-muted);margin:0 0 .8rem">Pour une fiche remplie à la main au port : créez-la ici, ajoutez les lignes, puis importez-les comme d'habitude.</p>
      <div class="form-grid-2"><div class="form-group"><label class="form-label">Date</label><input type="date" class="form-control" id="np-date" value="${todayISO()}"></div>
      <div class="form-group"><label class="form-label">Agent au port</label><input class="form-control" id="np-agent"></div></div>
      <div class="form-group"><label class="form-label">Port / terminal</label><input class="form-control" id="np-port" value="Port Autonome de Douala"></div>`,
      `<button class="btn btn-secondary" data-x>Annuler</button><button class="btn btn-primary" id="np-ok">Créer la fiche</button>`);
    m.querySelector('#np-ok').onclick = async () => {
      try {
        const s = await api('POST', '/api/port/sheets', { sheet_date: m.querySelector('#np-date').value, agent_name: m.querySelector('#np-agent').value, port: m.querySelector('#np-port').value });
        m.close();
        openPortSheet(s.id);
      } catch (e) { toast(e.message, 'danger'); }
    };
  }

  async function openPortSheet(id) {
    try {
      const [sheet, refs] = await Promise.all([api('GET', `/api/port/sheets/${id}`), P.subs.length ? Promise.resolve(null) : api('GET', '/api/port/refs')]);
      if (refs) P.subs = refs.subcontractors;
      P.sheet = sheet;
      renderPortSheet();
    } catch (e) { toast(e.message, 'danger'); }
  }

  function renderPortSheet() {
    const s = P.sheet;
    const t = s.totals;
    const root = $('view-port-exits');
    const pendingRows = s.rows.filter(r => r.status === 'en_attente');
    const staff = canWrite();
    root.innerHTML = `<button class="v4-back" id="v4-back">${ICON.back} Toutes les fiches</button>
      <div class="v4-head"><div><h2>${esc(cap(dLong(s.sheet_date)))}</h2><p>${esc(s.sheet_no)} · <span class="v4-chip ${s.status}">${STATUS[s.status]}</span></p></div>
        <div class="v4-actions">
          <button class="btn btn-secondary btn-sm" id="v4-print">${ICON.print} PDF / Imprimer</button>
          ${staff && s.status !== 'brouillon' && !t.rows_imported ? `<button class="btn btn-secondary btn-sm" id="v4-reopen">Renvoyer à l'agent</button>` : ''}
          ${staff && s.status === 'brouillon' ? `<button class="btn btn-secondary btn-sm" id="v4-addrow">Ajouter une ligne</button><button class="btn btn-secondary btn-sm" id="v4-submit">Marquer comme reçue</button>` : ''}
          ${staff && s.status !== 'brouillon' && pendingRows.length > 1 ? `<button class="btn btn-primary btn-sm" id="v4-import-all">Importer les ${pendingRows.length} lignes</button>` : ''}
        </div></div>
      <div class="data-card">
        <div class="v4-meta"><div><span>Agent au port</span><b>${esc(s.agent_name || s.created_by || '—')}</b></div><div><span>Téléphone</span><b>${s.agent_phone ? `<a href="tel:${esc(s.agent_phone)}" style="color:inherit">${esc(s.agent_phone)}</a>` : '—'}</b></div><div><span>Port / terminal</span><b>${esc(s.port || '—')}</b></div><div><span>Envoyée le</span><b>${s.submitted_at ? esc(String(s.submitted_at).slice(0, 16).replace('T', ' ')) : '—'}</b></div>${s.validated_by ? `<div><span>Validée par</span><b>${esc(s.validated_by)}</b></div>` : ''}</div>
        <div class="v4-kpis"><div><b>${t.rows_total}</b><span>camions sortis</span></div><div><b>${t.containers}</b><span>conteneurs</span></div><div><b>${t.rows_external}</b><span>externes</span></div><div><b>${num(t.total_carburant)}</b><span>carburant (FCFA)</span></div><div><b>${num(t.total_avance)}</b><span>avances (FCFA)</span></div><div><b>${t.rows_imported}/${t.rows_total}</b><span>importées</span></div></div>
        ${s.status === 'brouillon' ? `<div class="v4-warns" style="margin:1rem 1.1rem 0">L'agent n'a pas encore envoyé cette fiche : elle peut encore changer. L'import sera possible dès qu'elle sera envoyée${staff ? ' (ou marquée comme reçue)' : ''}.</div>` : ''}
        <div class="v4-rows">${s.rows.length ? s.rows.map(r => rowHtml(r, s)).join('') : '<div class="v4-empty"><b>Fiche vide</b></div>'}</div>
      </div>`;
    $('v4-back').onclick = loadPortExits;
    $('v4-print').onclick = () => YMTPortPrint.open(s);
    if ($('v4-reopen')) $('v4-reopen').onclick = async () => {
      if (!(await confirmV4("Renvoyer la fiche à l'agent ?", "L'agent pourra de nouveau la modifier sur son téléphone, puis la renvoyer.", 'Renvoyer'))) return;
      try { P.sheet = await api('POST', `/api/port/sheets/${s.id}/reopen`); renderPortSheet(); refreshPortBadge(); } catch (e) { toast(e.message, 'danger'); }
    };
    if ($('v4-submit')) $('v4-submit').onclick = async () => {
      try { P.sheet = await api('POST', `/api/port/sheets/${s.id}/submit`); renderPortSheet(); refreshPortBadge(); } catch (e) { toast(e.message, 'danger'); }
    };
    if ($('v4-addrow')) $('v4-addrow').onclick = () => paperRowModal(s);
    if ($('v4-import-all')) $('v4-import-all').onclick = importAll;
    s.rows.forEach(r => wireRow(r, s));
  }

  function rowHtml(r, s) {
    const ctnState = r.container_check === 'ok' ? '<span class="v4-ok">✓ valide</span>' : (r.container_check === 'cle' || r.container_check === 'format') ? '<span class="v4-bad">à vérifier</span>' : '';
    const top = `<div class="v4-row-top">
      <div class="t">${esc(r.exit_time || '--:--')}</div>
      <div><div class="lbl">${r.is_external ? 'TRANSPORTEUR EXTERNE' : 'CAMION · CHAUFFEUR'}</div>
        <div class="val">${r.is_external ? esc(r.subcontractor_name || r.external_company || '?') : esc(r.matched_truck || r.truck_code || '?')} · ${esc(r.driver_display || r.driver_name || '?')}</div>
        <div class="sub">${r.is_external ? esc(r.truck_code || '') : (r.is_exchange ? `<span class="v431-ex-pill" style="margin-left:0">échange</span> camion de ${esc(r.habitual_driver_name || r.usual_driver_name || '?')}` : (r.habitual_driver_name ? 'chauffeur habituel' : ''))}</div></div>
      <div><div class="lbl">CONTENEUR · BL</div><div class="val ctn">${esc(r.container_number || '—')} ${r.container_size ? `<span class="sub">${esc(r.container_size)}'</span>` : ''} ${ctnState}</div><div class="sub">BL ${esc(r.bl_number || '—')}</div></div>
      <div><div class="lbl">CLIENT → DESTINATION</div><div class="val">${esc(r.client_name || '—')}</div><div class="sub">${esc(r.destination || '—')}</div></div>
      <div style="text-align:right"><span class="v4-chip ${r.status}">${ROW_STATUS[r.status]}</span><div class="sub" style="margin-top:.35rem">Carb. <b>${num(r.carburant)}</b> · Av. <b>${num(r.avance)}</b></div></div>
    </div>`;
    const warn = r.status === 'en_attente' && r.warnings?.length ? `<div class="v4-warns">${r.warnings.map(esc).join('<br>')}</div>` : '';
    const obs = r.observations ? `<div style="padding:0 1rem .7rem;font-size:.8rem;color:var(--text-muted)">Observation agent : ${esc(r.observations)}</div>` : '';
    let bottom = '';
    if (r.status === 'importe') {
      bottom = `<div class="v4-done">${r.trip_id ? `Voyage n°${r.trip_id} créé` : `Voyage sous-traité n°${r.sub_trip_id} créé`}${r.advance_id ? ` · avance de ${money(r.avance)} enregistrée` : ''}
        <span class="push">${r.trip_id ? `<button class="btn btn-secondary btn-sm" data-goto-trip="${r.trip_id}">Voir dans les voyages</button>` : `<button class="btn btn-secondary btn-sm" data-goto-sub>Voir les voyages sous-traités</button>`}
        ${role() === 'superadmin' ? `<button class="btn btn-secondary btn-sm" data-unimport="${r.id}">Annuler l'import</button>` : ''}</span></div>`;
    } else if (r.status === 'rejete') {
      bottom = `<div class="v4-done">Rejetée : ${esc(r.reject_reason || 'sans motif')}<span class="push">${canWrite() ? `<button class="btn btn-secondary btn-sm" data-restore="${r.id}">Restaurer</button>` : ''}</span></div>`;
    } else if (canWrite() && s.status !== 'brouillon') {
      bottom = r.is_external ? `<div class="v4-acc" data-acc="${r.id}">
          <div><label>Sous-traitant</label><select class="form-control" data-f="subcontractor_id"><option value="">${esc(r.external_company ? 'Créer « ' + r.external_company + ' »' : '— Choisir —')}</option>${P.subs.map(x => `<option value="${x.id}" ${x.id === r.subcontractor_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
          <div><label>Trajet</label><input class="form-control" data-f="route" value="${esc(r.destination || '')}"></div>
          <div><label>Recette client (FCFA)</label><input class="form-control num" data-f="recette" inputmode="numeric" placeholder="0"></div>
          <div><label>Coût sous-traitant (FCFA)</label><input class="form-control num" data-f="subcontractor_cost" inputmode="numeric" placeholder="0"></div>
          <div class="v4-acc-foot"><span class="v4-marge">Marge YM-TRANSIT : <b data-marge>—</b></span>
            <span class="push"><button class="btn btn-secondary btn-sm" data-reject="${r.id}">Rejeter</button><button class="btn btn-primary btn-sm" data-import="${r.id}">Importer</button></span></div></div>`
        : `<div class="v4-acc" data-acc="${r.id}">
          <div><label>Chauffeur</label><select class="form-control" data-f="driver_id">${driverOptions(r.driver_id)}</select></div>
          <div><label>Camion</label><select class="form-control" data-f="truck_code">${truckOptions(r.matched_truck || '')}</select></div>
          <div><label>Trajet</label><input class="form-control" data-f="route" value="${esc(r.destination || '')}"></div>
          <div><label>Recette (FCFA)</label><input class="form-control num" data-f="recette" inputmode="numeric" placeholder="0"></div>
          <div><label>Carburant (FCFA)</label><input class="form-control num" data-f="dep_carburant" inputmode="numeric" value="${r.carburant ? num(r.carburant) : ''}" placeholder="0"></div>
          <div><label>Pesée (FCFA)</label><input class="form-control num" data-f="pesee" inputmode="numeric" placeholder="0"></div>
          <div><label>Frais de route (FCFA)</label><input class="form-control num" data-f="peage" inputmode="numeric" placeholder="0"></div>
          <div class="v4-acc-foot"><span class="v4-marge">Remis au chauffeur : <b data-remis>—</b> · Marge nette : <b data-marge>—</b></span>
            ${r.avance ? `<label class="v4-check"><input type="checkbox" data-f="create_advance" checked> Enregistrer l'avance de ${money(r.avance)} au compte du chauffeur</label>` : ''}
            <span class="push"><button class="btn btn-secondary btn-sm" data-reject="${r.id}">Rejeter</button><button class="btn btn-primary btn-sm" data-import="${r.id}">Importer en voyage</button></span></div></div>`;
    } else if (canWrite() && s.status === 'brouillon') {
      bottom = `<div class="v4-done">En attente de l'envoi par l'agent<span class="push"><button class="btn btn-secondary btn-sm" data-delrow="${r.id}">Supprimer</button></span></div>`;
    }
    return `<div class="v4-row st-${r.status}" id="v4-row-${r.id}">${top}${warn}${obs}${bottom}</div>`;
  }

  function accPayload(rowId) {
    const box = document.querySelector(`[data-acc="${rowId}"]`);
    if (!box) return null;
    const p = { id: rowId };
    box.querySelectorAll('[data-f]').forEach(el => {
      const k = el.dataset.f;
      if (el.type === 'checkbox') p[k] = el.checked;
      else if (el.classList.contains('num')) p[k] = digits(el.value);
      else p[k] = el.value;
    });
    return p;
  }

  function wireRow(r, s) {
    const box = document.querySelector(`[data-acc="${r.id}"]`);
    if (box) {
      const calc = () => {
        const p = accPayload(r.id);
        if (r.is_external) {
          const m = (p.recette || 0) - (p.subcontractor_cost || 0);
          box.querySelector('[data-marge]').textContent = p.recette || p.subcontractor_cost ? money(m) : '—';
          box.querySelector('[data-marge]').style.color = m < 0 ? 'var(--danger-text)' : 'var(--success-text)';
        } else {
          const remis = (p.dep_carburant || 0) + (p.pesee || 0) + (p.peage || 0);
          const m = (p.recette || 0) - remis;
          box.querySelector('[data-remis]').textContent = money(remis);
          box.querySelector('[data-marge]').textContent = p.recette ? money(m) : '—';
          box.querySelector('[data-marge]').style.color = m < 0 ? 'var(--danger-text)' : 'var(--success-text)';
        }
      };
      box.querySelectorAll('.num').forEach(el => el.addEventListener('input', () => { const n = digits(el.value); el.value = n ? num(n) : ''; calc(); }));
      calc();
    }
    const q = sel => document.querySelector(`#v4-row-${r.id} ${sel}`);
    if (q('[data-import]')) q('[data-import]').onclick = async e => {
      const p = accPayload(r.id);
      if (!p.recette && !(await confirmV4('Recette vide', 'La recette de ce voyage est à 0 FCFA. Importer quand même ? Vous pourrez la corriger plus tard dans Voyages.', 'Importer'))) return;
      e.target.disabled = true;
      try {
        const res = await api('POST', `/api/port/rows/${r.id}/import`, p);
        P.sheet = res.sheet;
        toast(res.trip_id ? `Voyage n°${res.trip_id} créé${res.advance_id ? ' + avance enregistrée' : ''}` : `Voyage sous-traité n°${res.sub_trip_id} créé`);
        renderPortSheet(); refreshPortBadge();
      } catch (err) { e.target.disabled = false; toast(err.message, 'danger'); }
    };
    if (q('[data-reject]')) q('[data-reject]').onclick = () => {
      const m = modal('Rejeter cette ligne', `<div class="form-group"><label class="form-label">Motif</label><input class="form-control" id="rj-reason" placeholder="Ex : doublon, camion revenu au parc, erreur de saisie…"></div>`,
        `<button class="btn btn-secondary" data-x>Annuler</button><button class="btn btn-danger" id="rj-ok">Rejeter</button>`);
      m.querySelector('#rj-ok').onclick = async () => {
        try { P.sheet = await api('POST', `/api/port/rows/${r.id}/reject`, { reason: m.querySelector('#rj-reason').value }); m.close(); renderPortSheet(); refreshPortBadge(); }
        catch (err) { toast(err.message, 'danger'); }
      };
    };
    if (q('[data-restore]')) q('[data-restore]').onclick = async () => { try { P.sheet = await api('POST', `/api/port/rows/${r.id}/restore`); renderPortSheet(); refreshPortBadge(); } catch (err) { toast(err.message, 'danger'); } };
    if (q('[data-unimport]')) q('[data-unimport]').onclick = async () => {
      if (!(await confirmV4("Annuler l'import ?", 'Le voyage créé (et l\'avance associée) sera supprimé. La ligne repassera « à importer ».', "Annuler l'import", true))) return;
      try { P.sheet = await api('POST', `/api/port/rows/${r.id}/unimport`); renderPortSheet(); refreshPortBadge(); } catch (err) { toast(err.message, 'danger'); }
    };
    if (q('[data-delrow]')) q('[data-delrow]').onclick = async () => { try { P.sheet = await api('DELETE', `/api/port/rows/${r.id}`); renderPortSheet(); } catch (err) { toast(err.message, 'danger'); } };
    if (q('[data-goto-trip]')) q('[data-goto-trip]').onclick = () => { (window.switchTab || switchTab)('trips'); };
    if (q('[data-goto-sub]')) q('[data-goto-sub]').onclick = () => { (window.switchTab || switchTab)('subcontractor-trips'); };
  }

  async function importAll() {
    const rows = P.sheet.rows.filter(r => r.status === 'en_attente');
    const payloads = rows.map(r => accPayload(r.id)).filter(Boolean);
    const noRecette = payloads.filter(p => !p.recette).length;
    const warned = rows.filter(r => r.warnings?.length).length;
    const ok = await confirmV4(`Importer ${payloads.length} ligne(s) ?`,
      `Chaque ligne devient un voyage (ou un voyage sous-traité pour les externes), avec les montants saisis.${noRecette ? `<br><br><b style="color:var(--warning-text)">${noRecette} ligne(s) sans recette</b> seront importées à 0 FCFA.` : ''}${warned ? `<br><b style="color:var(--warning-text)">${warned} ligne(s) ont des points à vérifier</b> (signalés en orange).` : ''}`, 'Tout importer');
    if (!ok) return;
    try {
      const res = await api('POST', `/api/port/sheets/${P.sheet.id}/import-all`, { rows: payloads });
      P.sheet = res.sheet;
      renderPortSheet(); refreshPortBadge();
      if (res.failed) toast(`${res.imported} importée(s), ${res.failed} en erreur : ${res.results.filter(x => !x.ok).map(x => x.error).join(' · ')}`, 'danger');
      else toast(`${res.imported} ligne(s) importée(s)`);
    } catch (e) { toast(e.message, 'danger'); }
  }

  function paperRowModal(s) {
    const m = modal('Ajouter une ligne', `
      <div class="form-grid-2"><div class="form-group"><label class="form-label">Heure</label><input type="time" class="form-control" id="pr-time"></div>
        <div class="form-group"><label class="form-label">Camion</label><select class="form-control" id="pr-truck">${truckOptions('', '— Camion YM-TRANSIT —')}<option value="__ext">Transporteur externe…</option></select></div></div>
      <div class="form-group" id="pr-ext-wrap" style="display:none"><label class="form-label">Société externe</label><input class="form-control" id="pr-ext"></div>
      <div class="form-group"><label class="form-label">Chauffeur</label><select class="form-control" id="pr-driver">${driverOptions('')}</select><input class="form-control" id="pr-driver-txt" placeholder="Nom du chauffeur externe" style="display:none"></div>
      <div class="form-grid-2"><div class="form-group"><label class="form-label">N° conteneur</label><input class="form-control" id="pr-ctn" style="text-transform:uppercase"></div>
        <div class="form-group"><label class="form-label">Taille</label><select class="form-control" id="pr-size"><option>40</option><option>20</option><option>45</option></select></div></div>
      <div class="form-grid-2"><div class="form-group"><label class="form-label">N° BL</label><input class="form-control" id="pr-bl" style="text-transform:uppercase"></div>
        <div class="form-group"><label class="form-label">Client</label><input class="form-control" id="pr-client"></div></div>
      <div class="form-group"><label class="form-label">Destination</label><input class="form-control" id="pr-dest"></div>
      <div class="form-grid-2"><div class="form-group"><label class="form-label">Carburant (FCFA)</label><input class="form-control" id="pr-fuel" inputmode="numeric"></div>
        <div class="form-group"><label class="form-label">Avance (FCFA)</label><input class="form-control" id="pr-adv" inputmode="numeric"></div></div>`,
      `<button class="btn btn-secondary" data-x>Fermer</button><button class="btn btn-primary" id="pr-ok">Ajouter</button>`);
    const tr = m.querySelector('#pr-truck');
    tr.onchange = () => {
      const ext = tr.value === '__ext';
      m.querySelector('#pr-ext-wrap').style.display = ext ? '' : 'none';
      m.querySelector('#pr-driver').style.display = ext ? 'none' : '';
      m.querySelector('#pr-driver-txt').style.display = ext ? '' : 'none';
      if (!ext) { const d = driversList().find(x => String(x.assigned_truck || '').toUpperCase() === tr.value.toUpperCase()); if (d) m.querySelector('#pr-driver').value = d.id; }
    };
    m.querySelector('#pr-ok').onclick = async () => {
      const ext = tr.value === '__ext';
      const v = id => m.querySelector(id).value;
      try {
        P.sheet = await api('POST', `/api/port/sheets/${s.id}/rows`, {
          exit_time: v('#pr-time'), is_external: ext, truck_code: ext ? '' : v('#pr-truck'), external_company: ext ? v('#pr-ext') : null,
          driver_id: ext ? null : v('#pr-driver'), driver_name: ext ? v('#pr-driver-txt') : null,
          container_number: v('#pr-ctn'), container_size: v('#pr-size'), bl_number: v('#pr-bl'), client_name: v('#pr-client'), destination: v('#pr-dest'),
          carburant: digits(v('#pr-fuel')), avance: digits(v('#pr-adv'))
        });
        toast('Ligne ajoutée');
        m.querySelectorAll('input').forEach(i => { if (i.id !== 'pr-dest') i.value = ''; });
        renderPortSheet();
      } catch (e) { toast(e.message, 'danger'); }
    };
  }

  // ═════════════════════════════════════════════════════════════════════
  // 2. ÉCHANGES CAMION / CHAUFFEUR
  // ═════════════════════════════════════════════════════════════════════
  const A = { date: todayISO(), status: '', truck: '', driver: '' };
  const REASONS = { maladie: 'Maladie', panne: 'Camion en panne', conge: 'Congé / absence', remplacement: 'Remplacement', autre: 'Autre' };

  async function loadAssignments() {
    const root = $('view-assignments');
    if (!root) return;
    root.innerHTML = `<div class="v4-head"><div><h2>Échanges camion / chauffeur</h2><p>Quand un chauffeur est malade ou que son camion est en panne, déclarez ici qui conduit quel camion et pour combien de temps. Les voyages, les dépenses du camion et les rapports sont alors attribués au chauffeur qui conduisait vraiment.</p></div>
      <div class="v4-actions">${canWrite() ? `<button class="btn btn-primary btn-sm" id="v4-new-ex">${ICON.swap} Déclarer un échange</button>` : ''}</div></div>
      <div class="data-card"><div class="data-card-header"><div class="data-card-title">Qui conduit quel camion</div>
        <input type="date" class="form-control" id="v4-board-date" value="${A.date}" style="width:auto;margin-left:auto"></div>
        <div id="v4-board" class="v4-board"><div class="v4-empty">Chargement…</div></div><div id="v4-idle" class="v4-idle"></div></div>
      <div class="data-card" style="margin-top:1.25rem"><div class="data-card-header"><div class="data-card-title">Historique des échanges</div></div>
        <div class="v4-toolbar">
          <div class="v4-seg" id="v4-ex-seg"><button data-s="">Tous</button><button data-s="en_cours">En cours</button><button data-s="a_venir">À venir</button><button data-s="termine">Terminés</button></div>
          <select class="form-control" id="v4-ex-truck" style="max-width:180px">${truckOptions(A.truck, 'Tous les camions')}</select>
          <select class="form-control" id="v4-ex-driver" style="max-width:220px">${driverOptions(A.driver, 'Tous les chauffeurs')}</select>
        </div>
        <div class="table-container"><table class="data-table mobile-collapse"><thead><tr><th>Camion</th><th>Chauffeur habituel</th><th>Remplacé par</th><th>Période</th><th>Motif</th><th>Statut</th><th></th></tr></thead><tbody id="v4-ex-body"></tbody></table></div></div>`;
    $('v4-board-date').onchange = e => { A.date = e.target.value || todayISO(); loadBoard(); };
    if ($('v4-new-ex')) $('v4-new-ex').onclick = () => assignmentModal({});
    root.querySelectorAll('#v4-ex-seg button').forEach(b => { b.classList.toggle('on', b.dataset.s === A.status); b.onclick = () => { A.status = b.dataset.s; root.querySelectorAll('#v4-ex-seg button').forEach(x => x.classList.toggle('on', x === b)); loadHistory(); }; });
    $('v4-ex-truck').onchange = e => { A.truck = e.target.value; loadHistory(); };
    $('v4-ex-driver').onchange = e => { A.driver = e.target.value; loadHistory(); };
    loadBoard(); loadHistory();
  }

  async function loadBoard() {
    try {
      const r = await api('GET', `/api/assignments/board?date=${A.date}`);
      $('v4-board').innerHTML = r.board.map(b => `<div class="v4-truck${b.is_exchange ? ' ex' : ''}">
        <div class="hd"><b>${esc(b.truck_code)}</b><span>${esc(b.license_plate)}</span>${b.truck_status && b.truck_status !== 'actif' ? `<span class="v4-chip rejete" style="margin-left:auto">${esc(b.truck_status.replace('_', ' '))}</span>` : ''}</div>
        <div class="drv">${esc(b.current_driver_name || 'Aucun chauffeur')}<small>${b.is_exchange ? `à la place de ${esc(b.habitual_driver_name || '?')}` : b.habitual_elsewhere ? `${esc(b.habitual_driver_name)} conduit ${esc(b.habitual_elsewhere.truck_code)} en ce moment` : (b.habitual_driver_name ? 'chauffeur habituel' : 'pas de chauffeur habituel')}</small></div>
        ${b.is_exchange ? `<div class="why">${esc(b.assignment.reason_label)} · depuis le ${dFr(b.assignment.start_date)}${b.assignment.end_date ? ` jusqu'au ${dFr(b.assignment.end_date)}` : ' · jusqu\'à nouvel ordre'}</div>` : ''}
        ${canWrite() ? `<div class="ft">${b.is_exchange ? `<button class="btn btn-secondary btn-sm" data-end="${b.assignment.id}">Retour du chauffeur habituel</button>` : `<button class="btn btn-secondary btn-sm" data-swap="${esc(b.truck_code)}">${ICON.swap} Changer de chauffeur</button>`}</div>` : ''}
      </div>`).join('') || '<div class="v4-empty">Aucun camion.</div>';
      $('v4-idle').innerHTML = r.idle_drivers.length ? `Sans camion le ${dFr(r.date)} : ${r.idle_drivers.map(d => `<b>${esc(d.name)}</b>${d.assigned_truck ? ` (${esc(d.assigned_truck)} confié à un autre)` : ''}`).join(', ')}` : '';
      $('v4-board').querySelectorAll('[data-swap]').forEach(b => b.onclick = () => assignmentModal({ truck_code: b.dataset.swap, start_date: A.date }));
      $('v4-board').querySelectorAll('[data-end]').forEach(b => b.onclick = () => endAssignment(+b.dataset.end));
    } catch (e) { $('v4-board').innerHTML = `<div class="v4-empty">${esc(e.message)}</div>`; }
  }

  async function loadHistory() {
    const qs = new URLSearchParams();
    if (A.status) qs.set('status', A.status);
    if (A.truck) qs.set('truck', A.truck);
    if (A.driver) qs.set('driver_id', A.driver);
    try {
      const rows = await api('GET', '/api/assignments?' + qs);
      const label = { en_cours: ['valide', 'En cours'], a_venir: ['soumis', 'À venir'], termine: ['brouillon', 'Terminé'] };
      $('v4-ex-body').innerHTML = rows.length ? rows.map(a => `<tr>
        <td data-label="Camion"><span class="badge badge-primary font-mono">${esc(a.truck_code)}</span></td>
        <td data-label="Habituel">${esc(a.habitual_driver_name || '—')}</td>
        <td data-label="Remplacé par"><strong>${esc(a.driver_name)}</strong></td>
        <td data-label="Période" class="font-mono" style="font-size:.8rem">${dFr(a.start_date)} → ${a.end_date ? dFr(a.end_date) : 'en cours'}</td>
        <td data-label="Motif">${esc(a.reason_label)}${a.notes ? `<div style="font-size:.74rem;color:var(--text-muted)">${esc(a.notes)}</div>` : ''}</td>
        <td data-label="Statut"><span class="v4-chip ${label[a.status][0]}">${label[a.status][1]}</span></td>
        <td style="white-space:nowrap">${canWrite() ? `${a.status === 'en_cours' ? `<button class="btn btn-secondary btn-sm" data-end="${a.id}">Terminer</button> ` : ''}<button class="btn btn-secondary btn-sm" data-edit="${a.id}">Modifier</button> <button class="btn-icon" title="Supprimer" data-del="${a.id}">${ICON.trash}</button>` : ''}</td>
      </tr>`).join('') : `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:1.5rem">Aucun échange enregistré${A.status || A.truck || A.driver ? ' pour ce filtre' : ''}.</td></tr>`;
      $('v4-ex-body').querySelectorAll('[data-end]').forEach(b => b.onclick = () => endAssignment(+b.dataset.end));
      $('v4-ex-body').querySelectorAll('[data-edit]').forEach(b => b.onclick = () => assignmentModal(rows.find(x => x.id === +b.dataset.edit)));
      $('v4-ex-body').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
        if (!(await confirmV4('Supprimer cet échange ?', 'Les voyages déjà enregistrés ne changent pas, mais les dépenses camion de cette période seront réattribuées au chauffeur habituel.', 'Supprimer', true))) return;
        try { await api('DELETE', `/api/assignments/${b.dataset.del}`); toast('Échange supprimé'); loadBoard(); loadHistory(); } catch (e) { toast(e.message, 'danger'); }
      });
    } catch (e) { $('v4-ex-body').innerHTML = `<tr><td colspan="7">${esc(e.message)}</td></tr>`; }
  }

  async function endAssignment(id) {
    const m = modal("Fin de l'échange", `<p style="font-size:.86rem;color:var(--text-main);margin:0 0 .8rem">Le chauffeur habituel reprend son camion. Dernier jour de l'échange :</p><input type="date" class="form-control" id="end-date" value="${todayISO()}">`,
      `<button class="btn btn-secondary" data-x>Annuler</button><button class="btn btn-primary" id="end-ok">Terminer l'échange</button>`);
    m.querySelector('#end-ok').onclick = async () => {
      try { await api('POST', `/api/assignments/${id}/end`, { end_date: m.querySelector('#end-date').value }); m.close(); toast('Échange terminé'); if (ST().currentTab === 'assignments') { loadBoard(); loadHistory(); } }
      catch (e) { toast(e.message, 'danger'); }
    };
  }

  function assignmentModal(a = {}) {
    const editing = !!a.id;
    const m = modal(editing ? "Modifier l'échange" : 'Déclarer un échange', `
      <div class="form-grid-2"><div class="form-group"><label class="form-label">Camion</label><select class="form-control" id="as-truck">${truckOptions(a.truck_code || '')}</select></div>
        <div class="form-group"><label class="form-label">Conduit par</label><select class="form-control" id="as-driver">${driverOptions(a.driver_id || '')}</select></div></div>
      <div class="form-grid-2"><div class="form-group"><label class="form-label">À partir du</label><input type="date" class="form-control" id="as-start" value="${a.start_date || todayISO()}"></div>
        <div class="form-group"><label class="form-label">Jusqu'au (inclus)</label><input type="date" class="form-control" id="as-end" value="${a.end_date || ''}"><small style="color:var(--text-muted);font-size:.72rem">Laisser vide : jusqu'à nouvel ordre</small></div></div>
      <div class="form-grid-2"><div class="form-group"><label class="form-label">Motif</label><select class="form-control" id="as-reason">${Object.entries(REASONS).map(([k, v]) => `<option value="${k}" ${a.reason === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label">Note</label><input class="form-control" id="as-notes" value="${esc(a.notes || '')}" placeholder="Facultatif"></div></div>
      <div class="preview" id="as-preview">Choisissez le camion et le chauffeur.</div>`,
      `<button class="btn btn-secondary" data-x>Annuler</button><button class="btn btn-primary" id="as-ok">${editing ? 'Enregistrer' : "Déclarer l'échange"}</button>`);
    const g = id => m.querySelector(id);
    const preview = () => {
      const code = g('#as-truck').value, did = g('#as-driver').value;
      const habitual = driversList().find(d => String(d.assigned_truck || '').toUpperCase() === code.toUpperCase());
      const drv = driversList().find(d => String(d.id) === did);
      if (!code || !drv) { g('#as-preview').textContent = 'Choisissez le camion et le chauffeur.'; return; }
      const per = `du ${dFr(g('#as-start').value)} ${g('#as-end').value ? 'au ' + dFr(g('#as-end').value) : "jusqu'à nouvel ordre"}`;
      let html = habitual && habitual.id === drv.id
        ? `<b>${esc(drv.name)}</b> est déjà le chauffeur habituel de ${esc(code)} : pas besoin d'échange.`
        : `<b>${esc(drv.name)}</b> conduira <b>${esc(code)}</b> ${per}${habitual ? `, à la place de <b>${esc(habitual.name)}</b>` : ''}.`;
      if (drv.assigned_truck && drv.assigned_truck.toUpperCase() !== code.toUpperCase() && !(habitual && habitual.id === drv.id))
        html += `<br><span style="color:var(--warning-text)">Son propre camion ${esc(drv.assigned_truck)} sera sans chauffeur pendant ce temps, sauf si vous déclarez un autre échange.</span>`;
      g('#as-preview').innerHTML = html;
    };
    ['#as-truck', '#as-driver', '#as-start', '#as-end'].forEach(id => g(id).addEventListener('change', preview));
    preview();
    g('#as-ok').onclick = async () => {
      const body = { truck_code: g('#as-truck').value, driver_id: g('#as-driver').value, start_date: g('#as-start').value, end_date: g('#as-end').value, reason: g('#as-reason').value, notes: g('#as-notes').value };
      try {
        await api(editing ? 'PUT' : 'POST', editing ? `/api/assignments/${a.id}` : '/api/assignments', body);
        m.close();
        toast(editing ? 'Échange modifié' : 'Échange enregistré');
        if (ST().currentTab === 'assignments') { loadBoard(); loadHistory(); }
        if (typeof loadTrucks === 'function' && ST().currentTab === 'trucks') loadTrucks();
        if ($('trip-truck')) tripBanner();
      } catch (e) { toast(e.message, 'danger'); }
    };
  }

  // ═════════════════════════════════════════════════════════════════════
  // 3. RAPPORTS : dossier chauffeur & fiche camion
  // ═════════════════════════════════════════════════════════════════════
  function renderDriverExchanges(data) {
    const box = $('v431-driver-exchanges');
    if (!box) return;
    const x = data && data.exchanges;
    if (!x || (!x.tripsOnOtherTrucks.length && !x.othersOnMyTruck.length && !x.assignmentPeriods.length)) { box.innerHTML = ''; return; }
    const name = data.driver.name.split(' ')[0];
    const periods = x.assignmentPeriods.map(a => {
      const mine = a.role === 'remplace';
      return `<div class="v4-period"><span class="d">${dFr(a.start_date)} → ${a.end_date ? dFr(a.end_date) : 'en cours'}</span>
        ${mine ? `<span>${esc(name)} conduit <b>${esc(a.truck_code)}</b></span>` : `<span><b>${esc(a.driver_name)}</b> conduit son camion ${esc(a.truck_code)}</span>`}
        <span class="v4-chip ${mine ? 'soumis' : 'brouillon'}">${esc(REASONS[a.reason] || a.reason)}</span></div>`;
    }).join('');
    const trips = [
      ...x.tripsOnOtherTrucks.map(t => `<div class="v4-period"><span class="d">${dFr(t.trip_date)}</span><span>Voyage sur <b>${esc(t.truck_id)}</b> (camion de ${esc(t.usual_driver_name || '?')}) · ${esc(t.route)}</span><span class="font-mono" style="margin-left:auto">${money(t.recette)}</span></div>`),
      ...x.othersOnMyTruck.map(t => `<div class="v4-period"><span class="d">${dFr(t.trip_date)}</span><span><b>${esc(t.driver_name)}</b> a conduit ${esc(t.truck_id)} · ${esc(t.route)}</span><span class="font-mono" style="margin-left:auto;color:var(--text-muted)">${money(t.recette)}</span></div>`)
    ].join('');
    box.innerHTML = `<div class="data-card v4-xcard"><div class="data-card-header"><div class="data-card-title">${ICON.swap} Échanges de camion sur la période</div></div>
      <div class="v4-xstats">
        <div><b>${x.tripsOnOtherTrucks.length} · ${money(x.recetteOnOtherTrucks)}</b><span>voyages de ${esc(name)} sur d'autres camions (comptés à son compte)</span></div>
        <div><b>${x.othersOnMyTruck.length} · ${money(x.recetteOthersOnMyTruck)}</b><span>voyages d'autres chauffeurs sur son camion (comptés au leur)</span></div>
        <div><b>${money(x.expensesFromExchange)}</b><span>dépenses de camion imputées pendant ses échanges</span></div>
      </div>${periods}${trips}</div>`;
  }

  function renderTruckDrivers(data) {
    const box = $('v431-truck-drivers');
    if (!box) return;
    const b = data.driverBreakdown || [];
    const a = data.assignments || [];
    if (data.current_driver && data.current_driver.is_exchange) {
      const sub = $('truck-hist-subtitle');
      if (sub && !sub.dataset.v4) { sub.dataset.v4 = '1'; }
      if (sub) sub.textContent = sub.textContent.replace(/ • Au volant aujourd'hui : .*$/, '') + ` • Au volant aujourd'hui : ${data.current_driver.name} (échange)`;
    }
    if (!b.length && !a.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<h4 style="font-size:.925rem;font-weight:700;margin-bottom:.65rem">Qui a conduit ce camion</h4>
      <div class="table-container" style="margin-bottom:1rem"><table class="data-table mobile-collapse"><thead><tr><th>Chauffeur</th><th>Voyages</th><th>Recette</th><th>Marge nette</th><th>Période</th></tr></thead><tbody>
      ${b.map(d => `<tr><td data-label="Chauffeur"><strong>${esc(d.driver_name)}</strong> ${d.is_habitual ? '<span class="badge badge-success" style="font-size:.65rem">habituel</span>' : '<span class="v431-ex-pill">échange</span>'}</td>
        <td data-label="Voyages" class="font-mono">${d.trips}</td><td data-label="Recette" class="font-mono">${money(d.recette)}</td><td data-label="Marge" class="font-mono">${money(d.marge)}</td>
        <td data-label="Période" class="font-mono" style="font-size:.78rem">${dFr(d.first_date)} → ${dFr(d.last_date)}</td></tr>`).join('') || '<tr><td colspan="5" style="color:var(--text-muted)">Aucun voyage sur la période.</td></tr>'}
      </tbody></table></div>
      ${a.length ? `<div style="font-size:.8rem;color:var(--text-muted);margin:-.4rem 0 1.25rem">Échanges déclarés : ${a.map(x => `<b style="color:var(--text-main)">${esc(x.driver_name)}</b> ${dFr(x.start_date)} → ${x.end_date ? dFr(x.end_date) : 'en cours'} (${esc(x.reason_label)})`).join(' · ')}</div>` : ''}`;
  }

  // ═════════════════════════════════════════════════════════════════════
  // 4. FORMULAIRE VOYAGE : détection d'échange en direct
  // ═════════════════════════════════════════════════════════════════════
  let tripDriverTouched = false, bannerSeq = 0;
  async function tripBanner(fromTruckChange = false) {
    const box = $('trip-exchange-banner');
    const truck = $('trip-truck') && $('trip-truck').value;
    const date = $('trip-date') && $('trip-date').value;
    if (!box) return;
    if (!truck) { box.innerHTML = ''; return; }
    const seq = ++bannerSeq;
    let r;
    try { r = await api('GET', `/api/assignments/resolve?truck=${encodeURIComponent(truck)}&date=${date || ''}&driver_id=${$('trip-driver').value || ''}`); } catch (_) { return; }
    if (seq !== bannerSeq) return;
    const isNew = !$('trip-id').value;
    if (fromTruckChange && isNew && !tripDriverTouched && r.suggested_driver_id && String($('trip-driver').value) !== String(r.suggested_driver_id)) {
      $('trip-driver').value = r.suggested_driver_id;
      return tripBanner(false);
    }
    const chosen = $('trip-driver').value;
    const chosenName = driversList().find(d => String(d.id) === String(chosen))?.name || '?';
    let html = '';
    if (r.assignment && String(r.assignment.driver_id) === String(chosen)) {
      html = `<div class="v4-banner ex">${ICON.swap}<div><b>Échange en cours :</b> ${esc(r.assignment.driver_name)} conduit ${esc(r.truck)} à la place de ${esc(r.habitual_driver_name || '?')} depuis le ${dFr(r.assignment.start_date)} (${esc(r.assignment.reason_label)}). Ce voyage sera compté à ${esc(r.assignment.driver_name.split(' ')[0])}.</div></div>`;
    } else if (r.assignment && String(r.assignment.driver_id) !== String(chosen)) {
      html = `<div class="v4-banner info">${ICON.swap}<div>À cette date, ${esc(r.truck)} est confié à <b>${esc(r.assignment.driver_name)}</b> (${esc(r.assignment.reason_label)}).<div class="acts"><button type="button" data-use="${r.assignment.driver_id}">Mettre ${esc(r.assignment.driver_name.split(' ')[0])} comme chauffeur</button></div></div></div>`;
    } else if (r.chosen_is_exchange) {
      html = `<div class="v4-banner ex">${ICON.swap}<div><b>Échange de camion :</b> ${esc(r.truck)} est le camion de ${esc(r.habitual_driver_name)}. Le voyage sera compté à ${esc(chosenName)} et marqué « échange » dans les rapports.
        <div class="acts">${canWrite() ? `<button type="button" data-declare>Déclarer un échange sur plusieurs jours</button>` : ''}<button type="button" data-use="${r.habitual_driver_id}">Remettre ${esc((r.habitual_driver_name || '').split(' ')[0])}</button></div></div></div>`;
    }
    if (r.driver_elsewhere) html += `<div class="v4-banner bad"><div>Attention : ${esc(chosenName)} est déclaré sur le camion ${esc(r.driver_elsewhere.truck_code)} à cette date.</div></div>`;
    box.innerHTML = html;
    box.querySelectorAll('[data-use]').forEach(b => b.onclick = () => { $('trip-driver').value = b.dataset.use; tripDriverTouched = true; tripBanner(); });
    const dec = box.querySelector('[data-declare]');
    if (dec) dec.onclick = () => assignmentModal({ truck_code: truck, driver_id: chosen, start_date: date || todayISO(), reason: 'remplacement' });
  }
  function wireTripForm() {
    const t = $('trip-truck'), d = $('trip-driver'), dt = $('trip-date'), modalEl = $('modal-trip-form');
    if (!t || !d) return;
    t.addEventListener('change', () => tripBanner(true));
    d.addEventListener('change', () => { tripDriverTouched = true; tripBanner(); });
    if (dt) dt.addEventListener('change', () => tripBanner());
    if (modalEl) new MutationObserver(() => {
      if (modalEl.classList.contains('open')) { tripDriverTouched = !!$('trip-id').value; setTimeout(() => tripBanner(false), 60); }
      else $('trip-exchange-banner').innerHTML = '';
    }).observe(modalEl, { attributes: true, attributeFilter: ['class'] });
  }

  // ═════════════════════════════════════════════════════════════════════
  // 5. ASSISTANT IA
  // ═════════════════════════════════════════════════════════════════════
  const AI = { open: false, status: null, history: [], busy: false, rec: null, lang: 'fr-FR' };
  const SUGG = [
    'Combien de voyages a fait chaque chauffeur cette semaine ?',
    'Quel camion a rapporté le plus ce mois-ci ?',
    'Quels chauffeurs ont changé de camion ce mois-ci ?',
    'Combien de conteneurs avons-nous sortis du port la semaine dernière ?',
    'Quel est le solde des avances non remboursées par chauffeur ?',
    'How much did we spend on maintenance per truck this month?'
  ];

  function buildAI() {
    if ($('v4-ai')) return;
    const fab = document.createElement('button');
    fab.className = 'v4-ai-fab';
    fab.id = 'v4-ai-fab';
    fab.innerHTML = `${ICON.spark}<span class="lbl">Assistant</span><kbd>Ctrl K</kbd>`;
    fab.setAttribute('aria-label', 'Ouvrir l\'assistant IA');
    fab.onclick = () => toggleAI(true);
    const panel = document.createElement('aside');
    panel.className = 'v4-ai';
    panel.id = 'v4-ai';
    panel.setAttribute('aria-label', 'Assistant IA');
    panel.innerHTML = `<div class="v4-ai-hd"><div class="orb">${ICON.spark}</div><div><h3>Assistant YM-TRANSIT</h3><p>Questions en français ou en anglais</p></div>
        <div class="sp"><button class="v4-ai-ib" id="v4-ai-clear" title="Nouvelle conversation">${ICON.trash}</button><button class="v4-ai-ib" id="v4-ai-gear" title="Réglages" style="display:none">${ICON.gear}</button><button class="v4-ai-ib" id="v4-ai-x" title="Fermer (Échap)">${ICON.close}</button></div></div>
      <div class="v4-ai-body" id="v4-ai-body"></div>
      <div class="v4-ai-ft"><div class="v4-ai-input"><textarea id="v4-ai-q" rows="1" placeholder="Posez votre question…"></textarea>
        <button class="v4-ai-ib" id="v4-ai-mic" title="Dicter la question">${ICON.mic}</button>
        <button class="v4-ai-ib send" id="v4-ai-send" title="Envoyer (Entrée)" disabled>${ICON.send}</button></div>
        <div class="v4-ai-note">Réponses calculées sur vos vraies données. Vérifiez les montants importants dans les rapports.</div></div>`;
    document.body.appendChild(fab);
    document.body.appendChild(panel);
    $('v4-ai-x').onclick = () => toggleAI(false);
    $('v4-ai-clear').onclick = () => { AI.history = []; saveHist(); renderAI(); };
    $('v4-ai-gear').onclick = () => renderSetup(true);
    const q = $('v4-ai-q');
    q.addEventListener('input', () => { q.style.height = 'auto'; q.style.height = Math.min(q.scrollHeight, 120) + 'px'; $('v4-ai-send').disabled = !q.value.trim() || AI.busy; });
    q.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } });
    $('v4-ai-send').onclick = () => ask();
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) $('v4-ai-mic').style.display = 'none';
    else $('v4-ai-mic').onclick = () => {
      if (AI.rec) { AI.rec.stop(); return; }
      const rec = new SR();
      rec.lang = /[a-z]/i.test(q.value) && /\b(how|what|which|who|the)\b/i.test(q.value) ? 'en-US' : 'fr-FR';
      rec.interimResults = true;
      rec.onresult = ev => { q.value = [...ev.results].map(x => x[0].transcript).join(' '); q.dispatchEvent(new Event('input')); };
      rec.onend = () => { AI.rec = null; $('v4-ai-mic').classList.remove('rec'); if (q.value.trim()) ask(); };
      rec.onerror = () => { AI.rec = null; $('v4-ai-mic').classList.remove('rec'); };
      AI.rec = rec; $('v4-ai-mic').classList.add('rec'); rec.start();
    };
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); toggleAI(!AI.open); }
      else if (e.key === 'Escape' && AI.open && !document.querySelector('.v4-modal')) toggleAI(false);
    });
    try { AI.history = JSON.parse(sessionStorage.getItem('v4-ai-hist') || '[]'); } catch (_) { AI.history = []; }
  }
  function saveHist() { try { sessionStorage.setItem('v4-ai-hist', JSON.stringify(AI.history.slice(-30))); } catch (_) {} }

  async function toggleAI(open) {
    AI.open = open;
    document.body.classList.toggle('v4-ai-open', open);
    if (open) {
      if (!AI.status) { try { AI.status = await api('GET', '/api/assistant/status'); } catch (_) { AI.status = { configured: false }; } }
      $('v4-ai-gear').style.display = AI.status.can_configure ? '' : 'none';
      renderAI();
      setTimeout(() => $('v4-ai-q').focus(), 120);
    } else $('v4-ai-fab').focus();
  }

  function renderSetup(force = false) {
    const body = $('v4-ai-body');
    const s = AI.status || {};
    if (!s.can_configure) {
      body.innerHTML = `<div class="v4-ai-setup"><b>L'assistant n'est pas encore activé.</b><p style="color:var(--text-muted);margin:.4rem 0 0">Demandez à l'administrateur (superadmin) de l'activer : il suffit d'une clé Google Gemini gratuite.</p></div>`;
      return;
    }
    body.innerHTML = `<div class="v4-ai-setup"><b>${s.configured && force ? 'Réglages de l\'assistant' : 'Activer l\'assistant (gratuit)'}</b>
      <ol><li>Ouvrez <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> avec un compte Google.</li><li>Cliquez sur <b>Create API key</b>, puis copiez la clé.</li><li>Collez-la ci-dessous et enregistrez.</li></ol>
      <label for="v4-ai-key">Clé API Gemini${s.key_hint ? ` (actuelle : ${esc(s.key_hint)})` : ''}</label><input type="password" class="form-control" id="v4-ai-key" placeholder="AIza…" autocomplete="off">
      <label for="v4-ai-model">Modèle</label><input class="form-control" id="v4-ai-model" value="${esc(s.model || 'gemini-3.8-flash')}"><small style="color:var(--text-muted);font-size:.72rem">Si ce modèle est refusé, l'assistant en essaie automatiquement un autre.</small>
      <div style="display:flex;gap:.5rem;margin-top:.9rem;flex-wrap:wrap"><button class="btn btn-primary btn-sm" id="v4-ai-save">Enregistrer et tester</button>${s.configured ? `<button class="btn btn-secondary btn-sm" id="v4-ai-back">Retour</button>` : ''}</div>
      <div id="v4-ai-test" style="margin-top:.7rem;font-size:.8rem;line-height:1.45"></div>
      <p style="color:var(--text-muted);font-size:.74rem;margin:.8rem 0 0">L'offre gratuite de Google suffit pour un usage normal du bureau. La clé reste sur votre serveur ; les questions et les résultats nécessaires à la réponse sont envoyés à Google.</p></div>`;
    $('v4-ai-save').onclick = async () => {
      const key = $('v4-ai-key').value.trim();
      const body2 = { model: $('v4-ai-model').value.trim() };
      if (key) body2.api_key = key;
      const out = $('v4-ai-test');
      try {
        const r = await api('POST', '/api/assistant/settings', body2);
        AI.status = { ...AI.status, ...r };
        out.innerHTML = '<span style="color:var(--text-muted)">Test de la clé auprès de Google…</span>';
        const t = await api('POST', '/api/assistant/test');
        AI.status.model = t.model;
        toast(`Assistant activé (modèle ${t.model})`);
        renderAI();
      } catch (e) {
        if (out) out.innerHTML = `<div style="color:var(--danger-text);background:var(--danger-light);padding:.55rem .7rem;border-radius:8px">${esc(e.message)}</div>`;
        else toast(e.message, 'danger');
      }
    };
    if ($('v4-ai-back')) $('v4-ai-back').onclick = renderAI;
  }

  function renderAI() {
    const body = $('v4-ai-body');
    if (!AI.status || !AI.status.configured) return renderSetup();
    if (!AI.history.length) {
      body.innerHTML = `<div class="v4-ai-intro"><h4>Que voulez-vous savoir ?</h4><p>Je réponds à partir des voyages, chauffeurs, camions, dépenses, avances, échanges et sorties port enregistrés. Exemples :</p>
        <div class="v4-ai-sugg">${SUGG.map(s => `<button data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`;
      body.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { $('v4-ai-q').value = b.dataset.q; ask(); });
      return;
    }
    body.innerHTML = AI.history.map((m, i) => m.role === 'user'
      ? `<div class="v4-ai-msg user">${esc(m.text)}</div>`
      : `<div class="v4-ai-msg bot${m.error ? ' err' : ''}"><div class="txt">${esc(m.text)}</div>
          ${m.rows && m.rows.length ? `<div class="v4-ai-tools"><button data-tbl="${i}">Voir les données (${m.row_count})</button><button data-xls="${i}">Excel</button>${m.sql ? `<button data-sql="${i}">Détail technique</button>` : ''}</div><div data-tblbox="${i}"></div>` : ''}</div>`).join('');
    if (AI.busy) body.insertAdjacentHTML('beforeend', '<div class="v4-ai-typing" aria-label="L\'assistant réfléchit"><i></i><i></i><i></i></div>');
    body.querySelectorAll('[data-tbl]').forEach(b => b.onclick = () => {
      const i = +b.dataset.tbl, m = AI.history[i], box = body.querySelector(`[data-tblbox="${i}"]`);
      if (box.innerHTML) { box.innerHTML = ''; return; }
      const cols = m.columns;
      box.innerHTML = `<div class="v4-ai-data"><table><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${m.rows.map(r => `<tr>${cols.map(c => typeof r[c] === 'number' ? `<td class="n">${num(r[c])}</td>` : `<td>${esc(r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    });
    body.querySelectorAll('[data-sql]').forEach(b => b.onclick = () => {
      const i = +b.dataset.sql, box = body.querySelector(`[data-tblbox="${i}"]`);
      box.innerHTML = box.innerHTML.includes('v4-ai-sql') ? '' : `<div class="v4-ai-sql">${esc(AI.history[i].sql)}</div>`;
    });
    body.querySelectorAll('[data-xls]').forEach(b => b.onclick = () => {
      const m = AI.history[+b.dataset.xls];
      if (!window.XLSX) return toast('Export Excel indisponible', 'danger');
      const ws = XLSX.utils.json_to_sheet(m.rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Résultat');
      XLSX.writeFile(wb, `assistant_${todayISO()}.xlsx`);
    });
    body.scrollTop = body.scrollHeight;
  }

  async function ask() {
    const q = $('v4-ai-q');
    const text = q.value.trim();
    if (!text || AI.busy) return;
    q.value = ''; q.style.height = 'auto'; $('v4-ai-send').disabled = true;
    const past = AI.history.filter(m => !m.error).slice(-6).map(m => ({ role: m.role, text: m.text }));
    AI.history.push({ role: 'user', text });
    AI.busy = true; renderAI();
    try {
      const r = await api('POST', '/api/assistant/ask', { question: text, history: past });
      AI.history.push({ role: 'assistant', text: r.answer, sql: r.sql, rows: r.rows, columns: r.columns, row_count: r.row_count });
    } catch (e) {
      if (e.data && e.data.code === 'NO_KEY') { AI.status.configured = false; AI.busy = false; AI.history.pop(); return renderAI(); }
      AI.history.push({ role: 'assistant', text: e.message, error: true });
    }
    AI.busy = false; saveHist(); renderAI();
  }

  // ═════════════════════════════════════════════════════════════════════
  // Démarrage
  // ═════════════════════════════════════════════════════════════════════
  function init() {
    wireTripForm();
    // L'assistant et le badge n'apparaissent qu'une fois connecté (personnel du bureau)
    const tryStart = async () => {
      try {
        const me = await fetch('/api/auth/me').then(r => r.ok ? r.json() : null);
        if (!me || !me.authenticated || me.user.role === 'agent_port') return setTimeout(tryStart, 4000);
        buildAI();
        refreshPortBadge();
        setInterval(refreshPortBadge, 60000);
      } catch (_) { setTimeout(tryStart, 5000); }
    };
    tryStart();
  }

  window.V431 = { loadPortExits, loadAssignments, renderDriverExchanges, renderTruckDrivers, openPortSheet, assignmentModal, refreshPortBadge, toggleAI };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

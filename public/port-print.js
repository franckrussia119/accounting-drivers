/**
 * v4.31 — Impression / PDF d'une fiche de sortie port.
 * Reproduit la fiche papier "Rapport journalier de sortie port", remplie.
 * Utilisé par l'application mobile /port ET par l'application bureau.
 *   YMTPortPrint.open(sheet)  → ouvre l'aperçu et la boîte d'impression
 *                               (choisir « Enregistrer en PDF »)
 */
(function () {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fcfa = n => (Number(n) || 0).toLocaleString('fr-FR').replace(/ | /g, ' ');
  const dateFr = d => { if (!d) return ''; const [y, m, j] = String(d).slice(0, 10).split('-'); return `${j}/${m}/${y}`; };
  const STATUS = { brouillon: 'En cours', a_corriger: 'À corriger', soumis: 'Envoyée au bureau', valide: 'Validée par le bureau', valide_partiel: 'Validée avec rejets', rejete: 'Rejetée' };

  function build(sheet) {
    const rows = sheet.rows || [];
    const t = sheet.totals || {};
    const ymt = rows.filter(r => !r.is_external).length;
    const ext = rows.length - ymt;
    const box = on => `<span class="cb${on ? ' on' : ''}">${on ? '✓' : ''}</span>`;
    const minRows = Math.max(rows.length, 12);
    let body = '';
    for (let i = 0; i < minRows; i++) {
      const r = rows[i];
      if (!r) { body += `<tr class="empty"><td class="n">${i + 1}</td>${'<td></td>'.repeat(13)}</tr>`; continue; }
      const obs = [r.is_external ? (r.subcontractor_name || r.external_company || 'Externe') : null, r.observations].filter(Boolean).join(' — ');
      body += `<tr>
        <td class="n">${i + 1}</td>
        <td>${esc(r.exit_time)}</td>
        <td class="b">${esc(r.matched_truck || r.truck_code)}</td>
        <td class="c">${box(!r.is_external)} Y ${box(r.is_external)} E</td>
        <td class="b">${esc(r.driver_display || r.driver_name)}</td>
        <td>${r.is_exchange ? esc(r.habitual_driver_name || r.usual_driver_name || 'Oui') : ''}</td>
        <td class="m">${esc(r.bl_number)}</td>
        <td class="m b">${esc(r.container_number)}</td>
        <td class="c">${r.container_size ? esc(r.container_size) + "'" : ''}</td>
        <td>${esc(r.client_name)}</td>
        <td>${esc(r.destination)}</td>
        <td class="r">${(r.frais_route || r.carburant) ? fcfa((Number(r.frais_route) || 0) + (Number(r.carburant) || 0)) : ''}</td>
        <td class="r">${r.avance ? fcfa(r.avance) : ''}</td>
        <td class="o">${esc(obs)}${r.status === 'rejete' ? ` <em>(rejetée${r.reject_reason ? ' : ' + esc(r.reject_reason) : ''})</em>` : r.status === 'a_corriger' ? ` <em>(à corriger : ${esc(r.reject_reason || '')})</em>` : ''}</td>
      </tr>`;
    }
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>${esc(sheet.sheet_no)} — Rapport de sortie port</title>
<style>
  @page { size: A4 landscape; margin: 9mm; }
  * { box-sizing: border-box; }
  body { font-family: "Helvetica Neue", Arial, sans-serif; color: #1f2937; margin: 0; font-size: 9.5px; }
  .bar { height: 4px; width: 60px; background: #d97706; margin-bottom: 4px; }
  header { display: grid; grid-template-columns: 1fr auto 1fr; align-items: end; margin-bottom: 8px; }
  .brand { font-size: 20px; font-weight: 800; color: #13233f; letter-spacing: -.3px; }
  .brand small { display: block; font-size: 9px; font-weight: 400; color: #6b7280; letter-spacing: 0; }
  h1 { font-size: 16px; margin: 0; color: #13233f; text-align: center; }
  h1 + p { margin: 2px 0 0; text-align: center; color: #6b7280; font-size: 9px; }
  .ref { text-align: right; font-weight: 700; color: #13233f; font-size: 11px; }
  .ref span { display: block; font-size: 9px; color: #d97706; font-weight: 700; }
  .band { display: flex; gap: 22px; background: #e4e9f2; border-radius: 4px; padding: 6px 10px; margin-bottom: 8px; }
  .band b { color: #6b7280; font-weight: 700; margin-right: 4px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th { background: #13233f; color: #fff; font-size: 8.5px; padding: 5px 3px; text-align: center; line-height: 1.15; }
  td { border-bottom: 1px solid #cfd6df; border-right: 1px solid #e3e7ee; padding: 4px 3px; height: 22px; vertical-align: middle; overflow: hidden; word-wrap: break-word; }
  tr:nth-child(even) td { background: #f6f8fb; }
  td.n { text-align: center; color: #6b7280; font-weight: 700; }
  td.c { text-align: center; white-space: nowrap; }
  td.r { text-align: right; font-variant-numeric: tabular-nums; }
  td.m { font-family: "Courier New", monospace; font-size: 9px; }
  td.b { font-weight: 700; }
  td.o { font-size: 8.5px; }
  table { border: 1.2px solid #13233f; }
  .cb { display: inline-block; width: 9px; height: 9px; border: 1px solid #1f2937; font-size: 8px; line-height: 8px; text-align: center; vertical-align: middle; }
  .cb.on { background: #13233f; color: #fff; }
  .foot { display: grid; grid-template-columns: 92mm 1fr; gap: 3mm; margin-top: 7px; page-break-inside: avoid; }
  .recap { background: #fdf3e1; border: 1px solid #d97706; border-radius: 4px; padding: 6px 9px; }
  .recap h3, .sig h3 { margin: 0 0 4px; font-size: 9px; color: #d97706; letter-spacing: .3px; }
  .recap div { display: flex; justify-content: space-between; padding: 2px 0; border-bottom: 1px dotted #e6c48f; }
  .recap div:last-child { border: 0; }
  .sigs { display: grid; grid-template-columns: repeat(3, 1fr); border: 1px solid #13233f; border-radius: 4px; }
  .sig { padding: 6px 9px; min-height: 26mm; border-right: 1px solid #cfd6df; position: relative; }
  .sig:last-child { border: 0; }
  .sig h3 { color: #13233f; }
  .sig p { margin: 0; color: #6b7280; font-size: 8.5px; }
  .sig .line { position: absolute; left: 9px; right: 9px; bottom: 7px; border-top: 1px solid #9aa5b4; padding-top: 2px; font-size: 8px; color: #6b7280; }
  .meta { margin-top: 5px; color: #6b7280; font-size: 8px; display: flex; justify-content: space-between; }
  .toolbar { position: fixed; top: 10px; right: 10px; display: flex; gap: 8px; }
  .toolbar button { font: 600 13px system-ui; padding: 9px 14px; border-radius: 8px; border: 0; background: #13233f; color: #fff; cursor: pointer; }
  .toolbar button.alt { background: #e4e9f2; color: #13233f; }
  @media print { .toolbar { display: none; } }
  @media screen { body { padding: 14px; background: #fff; } }
</style></head><body>
<div class="toolbar"><button onclick="window.print()">Imprimer / Enregistrer en PDF</button><button class="alt" onclick="window.close()">Fermer</button></div>
<div class="bar"></div>
<header>
  <div class="brand">YM-TRANSIT<small>Transport &amp; logistique — Douala</small></div>
  <div><h1>RAPPORT JOURNALIER DE SORTIE PORT</h1><p>Une ligne par camion sorti</p></div>
  <div class="ref"><span>${esc(STATUS[sheet.display_status || sheet.status] || sheet.status)}${(sheet.display_status === 'valide_partiel') ? ` (${t.rows_imported} enregistrée(s), ${t.rows_rejected} rejetée(s))` : ''}</span>N° fiche : ${esc(sheet.sheet_no)}</div>
</header>
<div class="band">
  <div><b>Date :</b>${dateFr(sheet.sheet_date)}</div>
  <div><b>Port / Terminal :</b>${esc(sheet.port || '—')}</div>
  <div><b>Agent au port :</b>${esc(sheet.agent_name || '—')}</div>
  <div><b>Téléphone :</b>${esc(sheet.agent_phone || '—')}</div>
</div>
<table>
  <colgroup>
    <col style="width:2.6%"><col style="width:4.4%"><col style="width:7%"><col style="width:5.2%"><col style="width:10.5%"><col style="width:9%">
    <col style="width:8.6%"><col style="width:9.4%"><col style="width:4%"><col style="width:8.5%"><col style="width:8.5%"><col style="width:6.2%"><col style="width:6.2%"><col>
  </colgroup>
  <thead><tr>
    <th>N°</th><th>Heure sortie</th><th>Camion</th><th>YMT / Ext.</th><th>Chauffeur au volant</th><th>Échange ? chauffeur habituel</th>
    <th>N° BL</th><th>N° Conteneur</th><th>20'/40'</th><th>Client</th><th>Destination</th><th>Frais de route (FCFA)</th><th>Avance (FCFA)</th><th>Observations</th>
  </tr></thead>
  <tbody>${body}</tbody>
</table>
<div class="foot">
  <div class="recap">
    <h3>RÉCAPITULATIF DE LA JOURNÉE</h3>
    <div><span>Camions sortis</span><b>${rows.length}</b></div>
    <div><span>dont YM-TRANSIT / externes</span><b>${ymt} / ${ext}</b></div>
    <div><span>Conteneurs sortis</span><b>${t.containers ?? rows.filter(r => r.container_number).length}</b></div>
    <div><span>Total frais de route</span><b>${fcfa(rows.reduce((s, r) => s + (Number(r.frais_route) || 0) + (Number(r.carburant) || 0), 0))} FCFA</b></div>
    <div><span>Total avances</span><b>${fcfa(t.total_avance ?? rows.reduce((s, r) => s + (Number(r.avance) || 0), 0))} FCFA</b></div>
  </div>
  <div class="sigs">
    <div class="sig"><h3>AGENT AU PORT</h3><p>${esc(sheet.agent_name || '')}</p><p>${sheet.submitted_at ? 'Envoyée le ' + esc(String(sheet.submitted_at).replace('T', ' ').slice(0, 16)) : ''}</p><div class="line">Signature</div></div>
    <div class="sig"><h3>SUPERVISEUR / CHEF DE PARC</h3><p>Vérifié — signature et cachet</p><div class="line">Signature</div></div>
    <div class="sig"><h3 style="color:#d97706">RÉSERVÉ AU BUREAU</h3><p>${sheet.validated_by ? 'Validée par ' + esc(sheet.validated_by) : 'Saisie dans le système : en cours'}</p><p>${sheet.validated_at ? 'le ' + esc(String(sheet.validated_at).slice(0, 16)) : ''}</p><div class="line">Saisi par</div></div>
  </div>
</div>
<div class="meta"><span>Document généré par YM-TRANSIT Gestion de flotte</span><span>Imprimé le ${new Date().toLocaleString('fr-FR')}</span></div>
</body></html>`;
  }

  window.YMTPortPrint = {
    html: build,
    open(sheet, { autoPrint = true } = {}) {
      const w = window.open('', '_blank');
      if (!w) { alert('Autorisez les fenêtres pop-up pour imprimer la fiche.'); return; }
      w.document.open();
      w.document.write(build(sheet));
      w.document.close();
      if (autoPrint) setTimeout(() => { try { w.focus(); w.print(); } catch (_) {} }, 400);
    }
  };
})();

// The standard printed invoice (docs/mockups/invoice-standard.html), the same for every company. Pure: it turns a plain model into
// HTML and touches no screen or database, so tests/invoice-print.test.js and the print check can use it. The styles are in
// css/styles.css under ".invd".
//
// Layout (A4): header (company left, title + status pill right), a strip (number, issued, due, terms, amount due), Bill to and an
// optional Reference, one-line items (bold name · detail) whose header repeats on every page, then ONE block that always stays
// together on the last page: words + notes + totals, then Terms (left) and How to pay (right). Credit, debit and refund notes use
// the same layout without How to pay or Terms. Only Draft and Void invoices carry a watermark.
(function (root) {
  'use strict';
  const STATUS_LABEL = { Draft: 'Draft', Sent: 'Sent', 'Partially paid': 'Partly paid', Paid: 'Paid', Overdue: 'Overdue', Void: 'Void', Issued: 'Issued' };
  const WATERMARK = { Draft: 'DRAFT', Void: 'VOID' };
  // "Name\nDetail…" or "Name · Detail…": the first part is bold, the rest follows on the same line after a dot.
  function splitDesc(desc) {
    const t = String(desc == null ? '' : desc).trim();
    if (!t) return { name: '', detail: '' };
    const nl = t.search(/\r?\n/);
    if (nl >= 0) return { name: t.slice(0, nl).trim(), detail: t.slice(nl).replace(/\s*\r?\n\s*/g, ' ').trim() };
    const dot = t.indexOf(' · ');
    return dot > 0 ? { name: t.slice(0, dot).trim(), detail: t.slice(dot + 3).trim() } : { name: t, detail: '' };
  }
  const L = (en, ms) => `${en} <span class="bm">/ ${ms}</span>`;

  function html(m, esc) {
    const E = esc || ((s) => String(s));
    const note = !m.isInvoice, st = m.status || 'Draft', mark = WATERMARK[st] || '';
    const co = m.company || {}, c = m.customer || {}, tot = m.totals || {};
    const coMeta = [co.reg ? `${E(co.reg)}` : '', ...(co.addr || []).map(E), [co.tel, co.email].filter(Boolean).map(E).join(' · '),
      [co.tin ? `<span>TIN</span> ${E(co.tin)}` : '', co.sst ? `<span>SST</span> ${E(co.sst)}` : ''].filter(Boolean).join(' · ')].filter(Boolean).join('<br>');
    const sch = !note && m.schedule && (m.schedule.rows || []).length ? m.schedule : null;   // instalments: the headline is what is due now
    const strip = note
      ? [[L('Doc no.', 'No.'), m.no], [L('Issued', 'Tarikh'), m.issue], [L('For invoice', 'Untuk invois'), m.forInvoice || '—'], [L('Currency', 'Mata wang'), m.currency || 'MYR']]
      : [[L('Invoice no.', 'No.'), m.no], [L('Issued', 'Tarikh'), m.issue], [L('Due', 'Tamat'), m.due || '—'], [L('Terms', 'Terma'), m.terms || '—']];
    const headLabel = note ? L('Amount', 'Jumlah') : sch ? L('Due now', 'Perlu dibayar sekarang') : L('Amount due', 'Jumlah perlu dibayar');
    const stripHTML = `<section class="invd-strip${sch ? ' sched' : ''}">${strip.map(([k, v]) => `<div><div class="label">${k}</div><div class="v num">${E(v)}</div></div>`).join('')}
      <div><div class="label">${headLabel}</div><div class="due-amt num">${E(m.amountHeadline || '')}</div>${sch ? `<div class="invd-itotal"><span class="label">${L('Invoice total', 'Jumlah invois')}</span><b class="num">${E(sch.invoiceTotal)}</b></div>` : ''}</div></section>`;
    const refLines = String(m.reference || '').trim().split(/\r?\n/).filter(Boolean);
    const refBox = refLines.length ? `<div class="party"><div class="label">${L('Reference', 'Rujukan')}</div><div class="name">${E(refLines[0])}</div>${refLines.length > 1 ? `<div class="addr">${refLines.slice(1).map(E).join('<br>')}</div>` : ''}</div>` : '';
    const billAddr = [...(c.addr || []).map(E), c.tin ? `TIN: ${E(c.tin)}` : '', c.idLine ? E(c.idLine) : '', [c.tel, c.email].filter(Boolean).map(E).join(' · ')].filter(Boolean).join('<br>');
    const rows = (m.items || []).map((it, k) => {
      const d = splitDesc(it.desc);
      return `<tr><td class="no num">${k + 1}</td><td class="desc"><b>${E(d.name)}</b>${d.detail ? ` <span>· ${E(d.detail)}</span>` : ''}</td><td class="r num">${E(it.qty)}${it.unit ? ` <small>${E(it.unit)}</small>` : ''}</td><td class="r num">${E(it.price)}</td><td class="r num">${E(it.amount)}</td></tr>`;
    }).join('');
    const adj = (tot.adj || []).map((a) => `<tr><td>${E(a.label)}</td><td>${a.sign || ''}${E(a.amount)}</td></tr>`).join('');
    const totals = `<table class="totals num"><tr><td>Subtotal</td><td>${E(tot.sub)}</td></tr><tr class="sep"><td>${E(tot.taxLabel || 'Tax')}</td><td>${E(tot.tax)}</td></tr>
      <tr class="grand"><td>Total (${E(m.currency || 'RM')})</td><td>${E(tot.total)}</td></tr>${adj}
      ${!note && tot.hasPays ? `<tr><td>Paid</td><td>-${E(tot.paid)}</td></tr>` : ''}${!note ? `<tr class="due"><td>${sch ? 'Amount due now' : 'Amount due'}</td><td>${E(m.amountHeadline || '')}</td></tr>` : ''}</table>`;
    const after = `<section class="invd-after"><div><div class="words"><span class="label">${L('Amount in words', 'Dalam perkataan')}</span>${E(m.words || '')}</div>
      ${m.notes ? `<div class="notes"><span class="label">${L('Notes', 'Catatan')}</span>${E(m.notes)}</div>` : ''}${st === 'Void' && m.voidReason ? `<div class="notes"><span class="label">Void</span>${E(m.voidReason)}</div>` : ''}${note && m.reason ? `<div class="notes"><span class="label">${L('Reason', 'Sebab')}</span>${E(m.reason)}</div>` : ''}</div>${totals}</section>`;
    // The payment schedule under the totals: each instalment with its amount, due date and status (Paid, Due or Upcoming).
    const SCH = { Paid: ['Paid', 'Dibayar'], Due: ['Due', 'Perlu dibayar'], Upcoming: ['Upcoming', 'Akan datang'] };
    const schedHTML = sch ? `<section class="invd-sched"><div class="label">${L('Payment schedule', 'Jadual bayaran')}</div><table><thead><tr><th class="no">#</th><th>Instalment</th><th class="r">Amount</th><th>Due</th><th>Status</th></tr></thead><tbody>${sch.rows.map((r, k) => `<tr><td class="no num">${k + 1}</td><td>${E(r.label)}</td><td class="r num">${E(r.amount)}</td><td class="num">${E(r.due)}</td><td><span class="sch-${E(String(r.status).toLowerCase())}">${E((SCH[r.status] || [r.status])[0])}${SCH[r.status] ? ` <span class="bm">/ ${SCH[r.status][1]}</span>` : ''}</span></td></tr>`).join('')}</tbody></table></section>` : '';
    // Terms (left) and How to pay (right), invoices only. A QR is printed only when the company uploaded one.
    const p = m.payment, terms = String(m.conditions || '').trim();
    const termLines = terms.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    const termsHTML = !note && termLines.length ? `<div class="invd-terms"><div class="label">${L('Terms', 'Terma')}</div>${termLines.length > 1 ? `<ol>${termLines.map((x) => `<li>${E(x)}</li>`).join('')}</ol>` : `<p>${E(termLines[0])}</p>`}</div>` : '';
    const kv = (k, v) => (v ? `<dt>${k}</dt><dd class="num">${E(v)}</dd>` : '');
    const payHTML = !note && p ? `<div class="invd-pay"><div class="pay-main"><h3>${L('How to pay', 'Cara bayaran')}</h3><dl class="kv">${kv('Bank', p.bank)}${kv('Account name', p.accName)}${kv('Account no.', p.accNo)}</dl>${p.instructions ? `<div class="ref">${E(p.instructions)}</div>` : ''}</div>${p.qr ? `<div class="qr"><img src="${p.qr}" alt="DuitNow QR"><small>DuitNow QR</small></div>` : ''}</div>` : '';
    const bottom = termsHTML || payHTML ? `<section class="invd-bottom${termsHTML && payHTML ? '' : ' one'}">${termsHTML}${payHTML}</section>` : '';
    return `<div class="invd${sch ? ' tight' : ''}">${mark ? `<div class="invd-mark" aria-hidden="true">${mark}</div>` : ''}
      <header class="invd-head"><div class="brand"><div class="logo">${E(co.initial || '')}</div><div><p class="co-name">${E(co.name || '')}</p><div class="co-meta">${coMeta}</div></div></div>
        <div class="invd-doc"><h1>${E(m.title || 'Invoice')}</h1><div class="sub">${E(m.subtitle || '')}</div><div class="invd-pill st-${E(st.replace(/\s+/g, '-').toLowerCase())}">${E(STATUS_LABEL[st] || st)}</div></div></header>
      ${stripHTML}
      <section class="invd-parties${refBox ? '' : ' one'}"><div class="party"><div class="label">${L('Bill to', 'Kepada')}</div><div class="name">${E(m.customerName || '')}</div><div class="addr">${billAddr}</div></div>${refBox}</section>
      <table class="invd-items"><thead><tr><th class="no">#</th><th>Description</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Amount (${E(m.currency || 'RM')})</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="invd-last">${after}${schedHTML}${bottom}</div></div>`;
  }

  const api = { html, splitDesc, STATUS_LABEL };
  root.AllurusInvoicePrint = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

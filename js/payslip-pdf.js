// A payslip as a real PDF file, made in the browser. With a password it is encrypted with AES (docs/SIMPLE-STAFF-HOME-SPEC.md).
// The PDF and the password never leave the phone: no outside service. Uses PDFKit (MIT, js/vendor/pdfkit.standalone.js).
// The lines come from AllurusStatutory.payslipData, the same figures as the printed payslip in js/payroll-docs.js.
//
// Encryption: PDF 1.7, AES-128 (CFM AESV2, revision 4). Chosen over AES-256 because every phone viewer opens it (the
// AES-256 "extension level 3" that PDFKit offers is not read by all of them). RC4 is never used. User password = the IC
// (or passport); the owner password is random per file and is not kept, so nobody can strip the protection with a known one.
(function (root) {
  'use strict';
  const NAVY = '#0f2a3d', TEAL = '#0f766e', INK = '#1f2937', MUTED = '#64748b', LINE = '#d6dde3';
  // The built-in PDF fonts only carry Latin-1: swap the few characters outside it (a true minus sign, curly dashes).
  const lat = (s) => String(s ?? '').replace(/[−–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ]/g, '?');
  const rm = (n) => 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const randomHex = (n = 32) => { const a = new Uint8Array(n); (root.crypto || require('node:crypto').webcrypto).getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); };

  /**
   * p = AllurusStatutory.payslipData(...); head = { company, address, ssm, monthLabel, paidOn, status, position };
   * password = string or null (null makes an unprotected file: the caller only does that when HR turned protection off).
   * Resolves to a Uint8Array.
   */
  function build({ PDFDocument, p, head, password }) {
    return new Promise((resolve, reject) => {
      try {
        const opts = { size: 'A4', margin: 40, info: { Title: lat(`Payslip ${head.monthLabel}`), Author: lat(head.company || 'Allurus HR') } };
        if (password) Object.assign(opts, { userPassword: password, ownerPassword: randomHex(32), pdfVersion: '1.7', permissions: { printing: 'highResolution', copying: true, modifying: false, annotating: false, fillingForms: false, contentAccessibility: true, documentAssembly: false } });
        const doc = new PDFDocument(opts), chunks = [];
        doc.on('data', (c) => chunks.push(c));
        doc.on('end', () => { const len = chunks.reduce((s, c) => s + c.length, 0), out = new Uint8Array(len); let o = 0; chunks.forEach((c) => { out.set(c, o); o += c.length; }); resolve(out); });
        doc.on('error', reject);

        const L = 40, W = 515, R = L + W;
        let y = 40;
        doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(15).text(lat(String(head.company || '').toUpperCase()), L, y, { width: 360 });
        doc.fillColor(MUTED).font('Helvetica').fontSize(8.5).text(lat([head.address, head.ssm].filter(Boolean).join(' · ')), L, doc.y + 1, { width: 360 });
        doc.fillColor(TEAL).font('Helvetica-Bold').fontSize(18).text('Payslip', 400, y, { width: R - 400, align: 'right' });
        doc.fillColor(MUTED).font('Helvetica').fontSize(10).text(lat(head.monthLabel), 400, y + 22, { width: R - 400, align: 'right' });
        y = Math.max(doc.y, y + 44) + 8;
        doc.moveTo(L, y).lineTo(R, y).lineWidth(1.2).strokeColor(TEAL).stroke(); y += 10;

        const acct = p.account ? `${p.bank} ····${String(p.account).slice(-4)}` : 'Not set';
        const kv = [['Name', p.name], ['IC / passport', p.id], ['Position', head.position || p.role], ['EPF no', p.epfNo], ['Income tax no', p.taxNo], ['Paid to', acct], ['Pay date', head.paidOn], ['Status', head.status]];
        kv.forEach(([k, v], i) => {
          const col = i % 2, row = Math.floor(i / 2), x = L + col * (W / 2), yy = y + row * 16;
          doc.fillColor(MUTED).font('Helvetica').fontSize(8.5).text(lat(k), x, yy, { width: 80 });
          doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(lat(v || '-'), x + 84, yy, { width: W / 2 - 92, lineBreak: false });
        });
        y += Math.ceil(kv.length / 2) * 16 + 10;

        const colW = (W - 20) / 2;
        const table = (title, rows, foot, x, top) => {
          let yy = top;
          doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10).text(title, x, yy); yy += 16;
          rows.forEach(([label, amt, note]) => {
            doc.fillColor(INK).font('Helvetica').fontSize(9).text(lat(label), x, yy, { width: colW - 80 });
            doc.text(lat(amt), x + colW - 78, yy, { width: 78, align: 'right' });
            yy = Math.max(doc.y, yy + 12);
            if (note) { doc.fillColor(MUTED).fontSize(7.5).text(lat(note), x, yy - 1, { width: colW - 80 }); yy = doc.y + 1; }
            doc.moveTo(x, yy + 1).lineTo(x + colW, yy + 1).lineWidth(0.4).strokeColor(LINE).stroke(); yy += 4;
          });
          if (foot) {
            doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9.5).text(lat(foot[0]), x, yy, { width: colW - 80 });
            doc.text(lat(foot[1]), x + colW - 78, yy, { width: 78, align: 'right' }); yy += 15;
          }
          return yy;
        };
        const sign = (n) => (n < 0 ? '-' + rm(-n) : rm(n));
        const yE = table('Earnings', p.earnings.map((l) => [l.label, sign(l.amount), l.note]), ['Gross pay', rm(p.gross)], L, y);
        let yD = table('Deductions', p.deductions.map((l) => [l.label, rm(l.amount)]), ['Total deductions', rm(p.totalDeductions)], L + colW + 20, y);
        if (p.reimbursements.length) yD = table('Reimbursements', p.reimbursements.map((l) => [l.label, rm(l.amount)]), null, L + colW + 20, yD + 6);
        y = Math.max(yE, yD) + 10;

        doc.roundedRect(L, y, W, 36, 5).fillColor('#e6f4f1').fill();
        doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11).text('Net pay', L + 14, y + 12, { width: 200 });
        doc.fillColor(TEAL).fontSize(15).text(lat(rm(p.net)), L + W - 214, y + 9, { width: 200, align: 'right' });
        y += 50;

        if (p.employer.length) y = table('Paid by the company on top of your pay', p.employer.map((l) => [l.label, rm(l.amount)]), null, L, y) + 6;
        doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(8).text('This payslip is computer-generated and needs no signature.', L, y + 6, { width: W });
        doc.end();
      } catch (e) { reject(e); }
    });
  }

  // ---------- In the browser ----------
  let loading = null;
  function load(base = '') {
    if (root.PDFDocument) return Promise.resolve(root.PDFDocument);
    if (!loading) loading = new Promise((ok, no) => { const s = document.createElement('script'); s.src = `${base}js/vendor/pdfkit.standalone.js?v=0.17.2`; s.onload = () => (root.PDFDocument ? ok(root.PDFDocument) : no(new Error('PDF library did not start'))); s.onerror = () => { loading = null; no(new Error('Couldn’t load the PDF library. Check your connection.')); }; document.head.appendChild(s); });
    return loading;
  }
  // Opens the phone's share sheet with the file (Print, Save to Files, WhatsApp to yourself); falls back to a download.
  async function deliver(bytes, name, { share = true } = {}) {
    const file = new File([bytes], name, { type: 'application/pdf' });
    if (share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return 'shared'; } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return 'downloaded';
  }

  const api = { build, load, deliver, lat, rm };
  root.AllurusPayslipPdf = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

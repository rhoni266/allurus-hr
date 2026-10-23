// Statutory & Claim Guide: a searchable reference for HR admins. One tab lists what HRD Corp allows companies to
// claim for training (the Allowable Cost Matrix), the other lists the LHDN reliefs and exemptions that matter for
// payroll, plus the employer expense deductions Allurus uses.
//
// The figures were read from the sources named on each row on AS_OF. They are a reference, not advice: HRD Corp and
// LHDN revise them, so every row names its source and the page tells the reader to confirm before relying on a figure.
// Pure data and filter functions first (unit tested in tests/guide.test.js), then the view.
window.AllurusGuide = (function () {
  'use strict';

  const AS_OF = '24 October 2026';

  const ACM_SRC = 'HRD Corp Allowable Cost Matrix guidebook, January 2026 version';
  const ACM_TABLE = 'HRD Corp Allowable Cost Matrix table, August 2025 version';
  const MTD_SRC = 'LHDN MTD (PCB) computerised calculation specification 2026';
  const ALLURUS_SRC = 'Allurus built-in tax rules';
  const GUIDES_SRC = 'Two published employer guides agree (ajobthing, PwC Malaysia tax booklet 2026/27); confirm in LHDN public rulings';

  // level: 'official' = read from the authority's own document; 'check' = from other sources or Allurus's own rules.
  // HRD Corp rows: [group, item, rate, applies to and notes, source, level]
  const HRD = [
    ['Course fees', 'General course fee, in-house (face-to-face)', 'RM10,500 per day per group, RM6,000 per half day', 'A full day is at least 7 training hours, a half day up to 4. Prorated when there are fewer than 5 trainees (RM10,500 ÷ 5 = RM2,100 per trainee). Minimum 2 trainees per face-to-face group, 1 for remote online.', ACM_SRC],
    ['Course fees', 'General course fee, local public course', 'RM1,750 per person per day, RM1,000 per half day', 'Full day is 7 hours, half day 4 hours. Longer courses use the per-day rate.', ACM_SRC],
    ['Course fees', 'Focus area, industry-specific and professional certification courses', 'As charged, quoted per person', 'In-house and public. Prorated by attendance.', ACM_SRC],
    ['Course fees', 'Overseas training, seminar or conference fee', 'As charged, converted to RM', 'Only 50% is paid as financial assistance. Seminars and conferences need at least 4 hours.', ACM_SRC],
    ['Course fees', 'SST on course fees', 'Claimable', 'Only up to the maximum claimable amount for the course.', ACM_SRC],
    ['Trainer allowance', 'Internal trainer allowance, in-house', 'RM1,400 per day per group, RM800 per half day', 'Prorated when there are fewer than 5 trainees. Courses over 7 hours use the full-day rate.', ACM_SRC],
    ['Trainer allowance', 'Overseas trainer daily allowance, in-house', 'RM500 per day', 'For an overseas trainer delivering an in-house course.', ACM_SRC],
    ['Trainee and trainer allowance', 'Allowance, travelling under 100 km one way', 'RM250 per person per day (or the actual amount if lower)', 'Trainees and internal trainers from HQ or branches, and external trainers. In-house or public. Half the rate for a half-day programme (at least 4 hours).', ACM_SRC],
    ['Trainee and trainer allowance', 'Allowance, travelling 100 km or more one way', 'RM500 per person per day, accommodation included (or the actual amount if lower)', 'Same people as above. Claim this or the meal allowance, not both.', ACM_SRC],
    ['Trainee and trainer allowance', 'Extra travel day', 'One extra day, on the employer\'s request', 'In-house only, for trainees 100 km or more from their workplace who must travel a day before or after.', ACM_SRC],
    ['Trainee and trainer allowance', 'Allowance on the organiser\'s own premises', 'Not claimable', 'For trainees and internal trainers based at the employer\'s own premises.', ACM_SRC],
    ['Trainee and trainer allowance', 'Overseas daily allowance, training or seminar', 'RM1,500 per person per day', 'The employer may ask for 2 extra days. Paid at 50% financial assistance.', ACM_SRC],
    ['Meals', 'Meal allowance, in-house', 'RM100 per person per day, RM50 per half day', 'Trainees and internal trainers, minimum 4 hours a day. An employer can claim the meal allowance or the trainee allowance, depending on the venue, not both. The matrix lists no meal allowance for external venues or hotels.', ACM_SRC],
    ['Travel and transport', 'Airfare', 'Actual airfare', 'Includes airport tax, admin fee and fuel surcharge. Needs the e-ticket or receipt and the travel agent\'s invoice. Overseas airfare is paid at 50%.', ACM_SRC],
    ['Travel and transport', 'Chartered transport (buses, vans)', 'As per the transport provider\'s quotation', 'In-house training at an external venue or hotel. Official receipt and invoice are mandatory.', ACM_SRC],
    ['Materials', 'Consumable training materials', 'RM100 per group without a quotation', 'In-house. Above RM100 an itemised quotation or invoice is needed.', ACM_SRC],
    ['Materials', 'Licensed training materials', 'Actual purchase price from the principal', 'Needs HRD Corp pre-approval, valid for 2 years. Self-developed materials are not claimable.', ACM_SRC],
    ['E-learning', 'E-learning course fee', 'RM125 per person per hour, up to RM875 per day', 'For 7 hours or less: 1h RM125, 2h RM250, 3h RM375, 4h RM500, 5h RM625, 6h RM750, 7h RM875. Minimum 1 hour with at least one complete module.', ACM_SRC],
    ['Development programmes', 'Diploma, degree, master\'s and PhD course fees', 'As per quotation', 'Includes registration and exam fees. Financial assistance is 100% for local study and 50% overseas (100% at an overseas private higher education institution).', ACM_SRC],
    ['Development programmes', 'Thesis allowance (full-time)', 'RM600 for a master\'s, RM1,000 for a PhD', '', ACM_SRC],
    ['Development programmes', 'Study allowance', 'RM900 within Malaysia, RM5,000 outside Malaysia', 'Prorated by the day for part months.', ACM_SRC],
    ['Scheme-specific', 'Recognition of Prior Learning (RPL)', 'RM300 per person per level', 'A trainee repeating the same level is not claimable.', ACM_SRC],
    ['Scheme-specific', 'On-the-Job Training (OJT) trainer allowance', 'RM50 per trainee per hour, up to 300 hours', 'Seven hours a day.', ACM_SRC],
    ['Scheme-specific', 'Dual National Training (SLDN)', 'RM100 per person (SKM fee), RM500 a month apprentice allowance', '', ACM_SRC],
    ['Scheme-specific', 'Computer-aided training equipment (IT scheme)', 'Up to RM25,000 for desktop computers', 'One application every 3 years. Other conditions apply, read the guidebook.', ACM_SRC],
    ['Claim rules', 'Minimum attendance', '75% of total training hours', 'Allowances are prorated by attendance. HRD Corp may ask for other documents and approves at its sole discretion.', ACM_TABLE],
    ['Claim rules', 'Documents when a training provider claims', 'JD14, attendance form T3, invoice issued to HRD Corp', 'For online training, the system-generated attendance report, signed and stamped by the provider and the employer.', ACM_TABLE],
  ].map(([group, item, limit, notes, src]) => ({ group, item, limit, notes, src, level: 'official' }));

  // LHDN rows: [group, item, limit, notes, source, level]
  const LHDN = [
    ['Reliefs used in PCB', 'Individual relief', 'RM9,000', 'Applied automatically to every employee.', MTD_SRC, 'official'],
    ['Reliefs used in PCB', 'Spouse relief', 'RM4,000', 'Only for category 2: married, spouse has no income. See the specification for the exceptions.', MTD_SRC, 'official'],
    ['Reliefs used in PCB', 'Child relief', 'RM2,000 per qualifying child', 'A disabled child, or a child in higher education, counts as more than one child. See the specification for the counts.', MTD_SRC, 'official'],
    ['Reliefs used in PCB', 'Disabled individual (additional)', 'RM7,000', '', MTD_SRC, 'official'],
    ['Reliefs used in PCB', 'Disabled spouse (additional)', 'RM6,000', '', MTD_SRC, 'official'],
    ['Reliefs used in PCB', 'EPF and approved scheme contributions', 'Up to RM4,000 a year', 'The yearly cap on the relief for the employee\'s own contributions.', MTD_SRC, 'official'],
    ['Reliefs employees can claim (TP1)', 'Lifestyle', 'Up to RM2,500', 'Books, computer, smartphone, tablet and internet subscription.', ALLURUS_SRC, 'check'],
    ['Reliefs employees can claim (TP1)', 'Sports equipment and activities', 'Up to RM1,000', 'A separate cap from Lifestyle.', ALLURUS_SRC, 'check'],
    ['Reliefs employees can claim (TP1)', 'Medical, health and well-being', 'Up to RM10,000', 'Medical check-ups, dental, vaccination, fertility treatment, serious illness. Needs a registered practitioner.', ALLURUS_SRC, 'check'],
    ['Reliefs employees can claim (TP1)', 'Education and skills training', 'Up to RM7,000', 'Self-enhancement and professional courses for the employee.', ALLURUS_SRC, 'check'],
    ['Reliefs employees can claim (TP1)', 'Medical treatment for parents', 'Up to RM8,000', 'Parents must be Malaysian residents and treated by a certified practitioner.', ALLURUS_SRC, 'check'],
    ['Tax-exempt allowances and benefits', 'Petrol, travel and toll allowance', 'Up to RM6,000 a year', 'For official duties.', GUIDES_SRC, 'check'],
    ['Tax-exempt allowances and benefits', 'Child care allowance', 'Up to RM3,000 a year', 'One guide also lists care subsidies for parents and grandparents under the same limit.', GUIDES_SRC, 'check'],
    ['Tax-exempt allowances and benefits', 'Parking', 'Fully exempt', 'Including parking the employer pays for directly.', GUIDES_SRC, 'check'],
    ['Tax-exempt allowances and benefits', 'Meals', 'Fully exempt', 'Provided regularly and at the same rate to all staff, or for work such as overtime and travel.', GUIDES_SRC, 'check'],
    ['Tax-exempt allowances and benefits', 'Leave passages', 'One overseas trip up to RM3,000 (fares only), or up to 3 local trips', 'Choose one. Local trips cover fares, meals and accommodation.', GUIDES_SRC, 'check'],
    ['Tax-exempt allowances and benefits', 'Employer\'s goods free or at a discount', 'Up to RM1,000 a year', '', GUIDES_SRC, 'check'],
    ['Tax-exempt allowances and benefits', 'Awards', 'Up to RM2,000', 'Long service (over 10 years with the same employer) or excellence, innovation and productivity.', GUIDES_SRC, 'check'],
    ['Tax-exempt allowances and benefits', 'Subsidised loan interest (housing, car, education)', 'Exempt for loans totalling up to RM300,000', 'Above that, a formula applies.', GUIDES_SRC, 'check'],
    ['Tax-exempt allowances and benefits', 'Mobile phone, computer, tablet and broadband', 'One unit per type of asset', 'The phone bill and broadband subscription are also exempt.', GUIDES_SRC, 'check'],
    ['Tax-exempt allowances and benefits', 'Who the exemptions do not cover', 'Directors of controlled companies, sole proprietors, partnerships', 'The perquisite and benefit exemptions above do not extend to them.', 'PwC Malaysia tax booklet 2026/27', 'check'],
  ].map(([group, item, limit, notes, src, level]) => ({ group, item, limit, notes, src, level }));

  // Employer expense deductions come from the same rules the Tax (LHDN) page uses, so the two always agree.
  const employerRows = () => {
    const rules = window.AllurusTax?.BUSINESS || [];
    return rules.map((r) => ({ group: 'Employer deductions (Section 33(1))', item: r.name, limit: r.deductibility, notes: r.trigger, src: ALLURUS_SRC, level: 'check' }));
  };

  const SETS = {
    hrd: { label: 'HRD Corp claims', sub: 'What HRD Corp allows a company to claim for training: the Allowable Cost Matrix.', rows: () => HRD },
    lhdn: { label: 'LHDN tax', sub: 'The reliefs and exemptions that affect payroll and the PCB, and what a company can deduct.', rows: () => [...LHDN, ...employerRows()] },
  };

  // ---------- Search ----------
  const norm = (s) => String(s || '').toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();
  const haystack = (r) => norm(`${r.group} ${r.item} ${r.limit} ${r.notes} ${r.src}`);
  // Every word typed must appear somewhere in the row.
  function filterRows(rows, { q = '', group = '' } = {}) {
    const words = norm(q).split(' ').filter(Boolean);
    return rows.filter((r) => (!group || r.group === group) && words.every((w) => haystack(r).includes(w)));
  }
  const groupsOf = (rows) => [...new Set(rows.map((r) => r.group))];

  // ---------- View ----------
  function install(ctx) {
    const { VIEWS, AFTER, ACTIONS, esc, icon } = ctx;
    const ui = { tab: 'hrd', q: '', group: '' };

    const rowHtml = (r) => `<tr data-g="${esc(r.group)}" data-h="${esc(haystack(r))}">
      <td><strong>${esc(r.item)}</strong><div class="person-sub" style="white-space:normal">${esc(r.group)}</div>${r.notes ? `<div class="guide-note-sm muted">${esc(r.notes)}</div>` : ''}</td>
      <td style="white-space:normal">${esc(r.limit)}</td>
      <td class="muted hide-sm" style="white-space:normal">${esc(r.notes)}</td>
      <td class="hide-sm"><span class="tag ${r.level === 'official' ? 'ok' : 'warn'}">${r.level === 'official' ? 'Official source' : 'Check'}</span><div class="person-sub" style="white-space:normal">${esc(r.src)}</div></td></tr>`;

    VIEWS.guide = () => {
      const set = SETS[ui.tab], rows = set.rows(), groups = groupsOf(rows);
      if (ui.group && !groups.includes(ui.group)) ui.group = '';
      return `
        <div class="page-head"><div><div class="eyebrow">Finance &amp; Accounting · Malaysia</div><h1>Statutory &amp; Claim Guide</h1>
          <p class="sub">${esc(set.sub)}</p></div></div>
        <div class="card card-flush">
          <div class="toolbar">
            <div class="seg" role="group" aria-label="Guide">${Object.entries(SETS).map(([k, s]) => `<button data-act="guide-tab" data-v="${k}" class="${ui.tab === k ? 'on' : ''}">${esc(s.label)}</button>`).join('')}</div>
            <input class="input" id="guide-q" type="search" placeholder="Search, for example meal, airfare, spouse, parking" aria-label="Search the guide" value="${esc(ui.q)}" style="flex:1;min-width:200px">
            <select class="select" id="guide-group" aria-label="Category"><option value="">All categories</option>${groups.map((g) => `<option value="${esc(g)}" ${ui.group === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>
          </div>
          <div class="table-wrap"><table>
            <thead><tr><th>Item</th><th>Limit or rate</th><th class="hide-sm">Applies to and notes</th><th class="hide-sm">Source</th></tr></thead>
            <tbody id="guide-body">${rows.map(rowHtml).join('')}<tr id="guide-empty" hidden><td colspan="4"><div class="empty" style="padding:32px 12px"><strong>No match</strong>Try fewer words or pick All categories.</div></td></tr></tbody>
          </table></div>
          <div class="card-head" style="padding:12px 22px"><span class="hint" id="guide-count" aria-live="polite"></span></div>
        </div>
        <p class="disclaimer">${icon('pin')}<span>Figures read from the sources shown on ${AS_OF}. HRD Corp and LHDN change these, so confirm the current figure with HRD Corp (hrdcorp.gov.my) or LHDN (hasil.gov.my) before you rely on one. Rows marked Check come from Allurus's own rules or from published guides, not from the authority's own document. This is a reference, not tax or legal advice.</span></p>`;
    };

    // Search and the category filter hide rows in place, so typing never re-renders the page or loses focus.
    function apply() {
      const rows = [...ctx.$$('#guide-body tr[data-h]')];
      const words = norm(ui.q).split(' ').filter(Boolean);
      let shown = 0;
      rows.forEach((tr) => {
        const on = (!ui.group || tr.dataset.g === ui.group) && words.every((w) => tr.dataset.h.includes(w));
        tr.hidden = !on; if (on) shown += 1;
      });
      ctx.$('#guide-empty').hidden = shown > 0;
      ctx.$('#guide-count').textContent = `Showing ${shown} of ${rows.length}`;
    }
    AFTER.guide = () => {
      ctx.$('#guide-q').addEventListener('input', (ev) => { ui.q = ev.target.value; apply(); });
      ctx.$('#guide-group').addEventListener('change', (ev) => { ui.group = ev.target.value; apply(); });
      apply();
    };
    ACTIONS['guide-tab'] = (_, v) => { ui.tab = v; ui.group = ''; ctx.render(); };
  }

  return { AS_OF, HRD, LHDN, SETS, employerRows, filterRows, groupsOf, haystack, install };
})();

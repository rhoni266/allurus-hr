// e-Invoice rules (LHDN MyInvois): document types, the builder that maps an Allurus invoice, note or self-billed
// bill into the MyInvois JSON document (UBL 2.1), the check for mandatory fields before submission, the e-Invoice
// statuses and the 72-hour cancellation window. Pure functions with no DOM access, unit tested in
// tests/einvoice.test.js. Nothing here talks to LHDN; see js/myinvois.js for the integration stub.
window.AllurusEInvoiceRules = (function () {
  'use strict';
  const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

  // ---------- Code lists ----------
  // FORMAT: verify every code list below against the LHDN MyInvois SDK (sdk.myinvois.hasil.gov.my → Codes) before
  // production. They are kept here, in one place, so they can be updated without touching the builder.
  const TYPES = {
    invoice: { code: '01', name: 'Invoice', prefix: 'INV' },
    credit: { code: '02', name: 'Credit note', prefix: 'CN' },
    debit: { code: '03', name: 'Debit note', prefix: 'DN' },
    refund: { code: '04', name: 'Refund note', prefix: 'RN' },
    'self-invoice': { code: '11', name: 'Self-billed invoice', prefix: 'SBI', self: true },
    'self-credit': { code: '12', name: 'Self-billed credit note', prefix: 'SBC', self: true },
    'self-debit': { code: '13', name: 'Self-billed debit note', prefix: 'SBD', self: true },
    'self-refund': { code: '14', name: 'Self-billed refund note', prefix: 'SBR', self: true },
  };
  const NEEDS_ORIGINAL = ['credit', 'debit', 'refund', 'self-credit', 'self-debit', 'self-refund'];
  const ID_TYPES = { BRN: 'Business registration (SSM)', NRIC: 'MyKad (NRIC)', PASSPORT: 'Passport', ARMY: 'Army or police ID' };
  const STATES = { '01': 'Johor', '02': 'Kedah', '03': 'Kelantan', '04': 'Melaka', '05': 'Negeri Sembilan', '06': 'Pahang', '07': 'Pulau Pinang', '08': 'Perak', '09': 'Perlis', '10': 'Selangor', '11': 'Sabah', '12': 'Sarawak', '13': 'Terengganu', '14': 'Wilayah Persekutuan Kuala Lumpur', '15': 'Wilayah Persekutuan Labuan', '16': 'Wilayah Persekutuan Putrajaya', '17': 'Not applicable (outside Malaysia)' };
  const TAX_TYPES = { '01': 'Sales tax', '02': 'Service tax', '03': 'Tourism tax', '04': 'High-value goods tax', '05': 'Sales tax on low value goods', '06': 'Not applicable', E: 'Tax exemption' };
  // Classification codes used by Allurus lines; the full list is in the SDK.
  const CLASSES = { '022': 'Others', '008': 'e-Commerce: costs or services', '030': 'Repair and maintenance', '004': 'Consolidated e-Invoice' };
  // General TINs for buyers or suppliers without a Malaysian TIN.
  const GENERAL_TIN = { publicBuyer: 'EI00000000010', foreignBuyer: 'EI00000000020', foreignSupplier: 'EI00000000030', government: 'EI00000000040' };
  const STATUSES = ['Draft', 'Submitted', 'Valid', 'Rejected', 'Cancelled'];
  const CANCEL_WINDOW_HOURS = 72;

  // ---------- Field checks ----------
  const isTIN = (s) => /^[A-Z]{1,2}\d{8,13}$/.test(String(s || '').replace(/\s/g, ''));
  const isMSIC = (s) => /^\d{5}$/.test(String(s || ''));
  const isPostcode = (s, country) => (country && country !== 'MYS' ? !!String(s || '').trim() : /^\d{5}$/.test(String(s || '')));
  const isPhone = (s) => /^\+?[\d\s-]{8,20}$/.test(String(s || ''));
  const isEmail = (s) => !s || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
  const clean = (s) => String(s ?? '').trim();
  const digits = (s) => clean(s).replace(/[^\dA-Z]/gi, '');

  /**
   * Missing or wrong fields on a party (supplier or buyer). role = 'supplier' | 'buyer'.
   * Returns [{ field, label, message }]. Used by the contact form and by validate().
   */
  function partyProblems(p = {}, role = 'buyer') {
    const out = [], add = (field, label, message) => out.push({ field, label, message });
    const a = p.address || {}, foreign = (a.country || 'MYS') !== 'MYS';
    if (!clean(p.name)) add('name', 'Registered name', 'Missing');
    if (!clean(p.tin)) add('tin', 'TIN', foreign ? `Missing (use ${role === 'supplier' ? GENERAL_TIN.foreignSupplier : GENERAL_TIN.foreignBuyer} for a foreign ${role})` : 'Missing');
    else if (!isTIN(p.tin)) add('tin', 'TIN', 'Doesn’t look like a TIN (letters then digits, for example C25845632000)');
    if (!ID_TYPES[p.idType]) add('idType', 'ID type', 'Choose BRN, MyKad, passport or army ID');
    if (!clean(p.idNo)) add('idNo', `${ID_TYPES[p.idType] || 'ID'} number`, 'Missing');
    if (role === 'supplier') {
      if (!isMSIC(p.msic)) add('msic', 'MSIC code', clean(p.msic) ? 'Must be 5 digits' : 'Missing');
      if (!clean(p.activity)) add('activity', 'Business activity', 'Missing');
    }
    if (!clean(a.line1)) add('address.line1', 'Address', 'Missing');
    if (!clean(a.city)) add('address.city', 'City', 'Missing');
    if (!isPostcode(a.postcode, a.country || 'MYS')) add('address.postcode', 'Postcode', clean(a.postcode) ? 'Must be 5 digits' : 'Missing');
    if (!STATES[a.state]) add('address.state', 'State', 'Choose a state');
    if (!clean(p.phone)) add('phone', 'Phone', 'Missing');
    else if (!isPhone(p.phone)) add('phone', 'Phone', 'Doesn’t look like a phone number');
    if (!isEmail(p.email)) add('email', 'Email', 'Doesn’t look like an email address');
    return out;
  }

  // ---------- From Allurus records ----------
  // An Allurus invoice or note becomes a neutral input for the builder: the parties, the lines and the type.
  function fromInvoice(inv, { company, contact, original = null, currency = 'MYR' }) {
    const type = inv.type || 'invoice';
    return {
      type, no: inv.no, issue: inv.issue, time: inv.issueTime || '00:00:00', currency,
      original: original ? { no: original.no, uuid: original.einvoice?.uuid || '' } : null,
      supplier: company, buyer: contact || { name: inv.customer, email: inv.email },
      taxRate: Number(inv.taxRate) || 0, taxType: inv.taxType || (Number(inv.taxRate) ? '02' : '06'),
      lines: inv.items.map((it) => ({ desc: it.desc, qty: Number(it.qty) || 0, price: Number(it.price) || 0, classification: it.classification || '022',
        // The line's unit (kg, pcs…) as its LHDN / UN code (js/invoice-rules.js); lines without one are C62 ("one").
        unit: window.AllurusInvoiceRules ? window.AllurusInvoiceRules.unitOf(it.unit).lhdn : (it.unit || 'C62') })),
      note: inv.reason || '',
    };
  }
  // A self-billed bill: the supplier on the document is the vendor, and the buyer is the company.
  function fromBill(bill, { company, contact, currency = 'MYR' }) {
    const rate = bill.amount ? r2((bill.tax / bill.amount) * 100) : 0;
    return {
      type: 'self-invoice', no: bill.selfNo || `SBI-${bill.ref}`, issue: bill.issue, time: '00:00:00', currency, original: null,
      supplier: contact || { name: bill.supplier }, buyer: company,
      taxRate: rate, taxType: rate ? '02' : '06',
      lines: [{ desc: bill.note || bill.category, qty: 1, price: Number(bill.amount) || 0, classification: bill.classification || '022', unit: 'C62' }],
      note: '',
    };
  }

  // ---------- Totals ----------
  // Line amounts and tax; the document tax is worked out on the subtotal (as on Allurus invoices) and any
  // rounding difference goes on the last line so the lines add up to the document.
  function totals(input) {
    const lines = input.lines.map((l) => ({ ...l, amount: r2(l.qty * l.price) }));
    const sub = r2(lines.reduce((s, l) => s + l.amount, 0)), tax = r2((sub * input.taxRate) / 100);
    let given = 0;
    lines.forEach((l, i) => { l.tax = i === lines.length - 1 ? r2(tax - given) : r2((l.amount * input.taxRate) / 100); given = r2(given + l.tax); });
    return { lines, sub, tax, total: r2(sub + tax) };
  }

  // ---------- Validation ----------
  /** Everything missing before a document can be submitted: [{ section, field, label, message }]. Empty = ready. */
  function validate(input, today = '') {
    const out = [], add = (section, field, label, message) => out.push({ section, field, label, message });
    const t = TYPES[input.type];
    if (!t) add('Document', 'type', 'Document type', 'Unknown type');
    if (!clean(input.no)) add('Document', 'no', 'Number', 'Missing');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.issue || '')) add('Document', 'issue', 'Issue date', 'Missing');
    else if (today && input.issue > today) add('Document', 'issue', 'Issue date', 'Can’t be in the future');
    if (!/^[A-Z]{3}$/.test(input.currency || '')) add('Document', 'currency', 'Currency', 'Missing');
    if (NEEDS_ORIGINAL.includes(input.type) && !clean(input.original?.no)) add('Document', 'original', 'Original invoice', 'A note must refer to the invoice it changes');
    if (!TAX_TYPES[input.taxType]) add('Document', 'taxType', 'Tax type', 'Choose a tax type');
    if (!(input.lines || []).length) add('Lines', 'lines', 'Lines', 'Add at least one line');
    (input.lines || []).forEach((l, i) => {
      if (!clean(l.desc)) add('Lines', `lines.${i}.desc`, `Line ${i + 1} description`, 'Missing');
      if (!(l.qty > 0)) add('Lines', `lines.${i}.qty`, `Line ${i + 1} quantity`, 'Must be more than 0');
      if (!(l.price >= 0)) add('Lines', `lines.${i}.price`, `Line ${i + 1} unit price`, 'Can’t be negative');
      if (!CLASSES[l.classification] && !/^\d{3}$/.test(l.classification || '')) add('Lines', `lines.${i}.classification`, `Line ${i + 1} classification`, 'Missing');
    });
    partyProblems(input.supplier, 'supplier').forEach((p) => add('Supplier', `supplier.${p.field}`, p.label, p.message));
    partyProblems(input.buyer, 'buyer').forEach((p) => add('Buyer', `buyer.${p.field}`, p.label, p.message));
    return out;
  }
  // Recommended but not required: shown as warnings.
  function warnings(input, today = '') {
    const out = [];
    // FORMAT: verify against the LHDN MyInvois SDK: documents are accepted only within 72 hours of their issue date and time.
    if (today && input.issue && (Date.parse(today) - Date.parse(input.issue)) / 36e5 > CANCEL_WINDOW_HOURS) out.push({ section: 'Document', label: 'Issue date', message: 'Issued more than 72 hours ago; MyInvois expects submission within 72 hours of issue. Re-date it to the submission date if your policy allows.' });
    if (NEEDS_ORIGINAL.includes(input.type) && input.original && !input.original.uuid) out.push({ section: 'Document', label: 'Original e-Invoice UUID', message: 'The original invoice has no e-Invoice UUID yet; submit it first.' });
    if (!clean(input.buyer?.email)) out.push({ section: 'Buyer', label: 'Email', message: 'The buyer gets the validated e-Invoice link by email.' });
    if (!clean(input.supplier?.sst)) out.push({ section: 'Supplier', label: 'SST number', message: 'Use NA if the supplier is not SST-registered.' });
    return out;
  }

  // ---------- The document ----------
  const v = (x, attrs = {}) => [{ _: x, ...attrs }];
  const amt = (x, cur) => [{ _: r2(x), currencyID: cur }];
  function party(p, cur) {
    const a = p.address || {};
    const ids = [{ ID: v(digits(p.tin).toUpperCase(), { schemeID: 'TIN' }) }, { ID: v(clean(p.idNo), { schemeID: p.idType || 'BRN' }) }, { ID: v(clean(p.sst) || 'NA', { schemeID: 'SST' }) }, { ID: v(clean(p.ttx) || 'NA', { schemeID: 'TTX' }) }];
    return [{
      ...(p.msic ? { IndustryClassificationCode: v(p.msic, { name: clean(p.activity) }) } : {}),
      PartyIdentification: ids,
      PostalAddress: [{
        CityName: v(clean(a.city)), PostalZone: v(clean(a.postcode)), CountrySubentityCode: v(a.state || ''),
        AddressLine: [a.line1, a.line2, a.line3].filter((x) => clean(x)).map((x) => ({ Line: v(clean(x)) })),
        Country: [{ IdentificationCode: v(a.country || 'MYS', { listID: 'ISO3166-1', listAgencyID: '6' }) }],
      }],
      PartyLegalEntity: [{ RegistrationName: v(clean(p.name)) }],
      Contact: [{ Telephone: v(clean(p.phone)), ElectronicMail: v(clean(p.email) || 'NA') }],
    }];
  }
  /**
   * Builds the MyInvois document for an invoice, note or self-billed invoice.
   * FORMAT: verify against the LHDN MyInvois SDK (sdk.myinvois.hasil.gov.my → Document types → JSON, version 1.0 and
   * 1.1) before production. Version 1.1 also needs the issuer's digital signature (UBLExtensions and Signature),
   * which must be added server-side with the company's certificate, never in the browser.
   */
  function build(input) {
    const t = TYPES[input.type] || TYPES.invoice, cur = input.currency || 'MYR', tot = totals(input);
    const taxCat = (rate) => [{ ID: v(input.taxType || (rate ? '02' : '06')), ...(input.taxType === 'E' ? { TaxExemptionReason: v(input.note || 'Exempt') } : {}), TaxScheme: [{ ID: v('OTH', { schemeID: 'UN/ECE 5153', schemeAgencyID: '6' }) }] }];
    const doc = {
      ID: v(input.no),
      IssueDate: v(input.issue),
      IssueTime: v(`${(input.time || '00:00:00').slice(0, 8)}Z`),
      InvoiceTypeCode: v(t.code, { listVersionID: '1.0' }),
      DocumentCurrencyCode: v(cur),
      TaxCurrencyCode: v(cur),
      ...(input.original ? { BillingReference: [{ InvoiceDocumentReference: [{ ID: v(input.original.no), UUID: v(input.original.uuid || 'NA') }] }] } : {}),
      AccountingSupplierParty: [{ Party: party(input.supplier, cur) }],
      AccountingCustomerParty: [{ Party: party(input.buyer, cur) }],
      TaxTotal: [{ TaxAmount: amt(tot.tax, cur), TaxSubtotal: [{ TaxableAmount: amt(tot.sub, cur), TaxAmount: amt(tot.tax, cur), Percent: [{ _: input.taxRate }], TaxCategory: taxCat(input.taxRate) }] }],
      LegalMonetaryTotal: [{ LineExtensionAmount: amt(tot.sub, cur), TaxExclusiveAmount: amt(tot.sub, cur), TaxInclusiveAmount: amt(tot.total, cur), PayableAmount: amt(tot.total, cur) }],
      InvoiceLine: tot.lines.map((l, i) => ({
        ID: v(String(i + 1)),
        InvoicedQuantity: [{ _: l.qty, unitCode: l.unit || 'C62' }],
        LineExtensionAmount: amt(l.amount, cur),
        TaxTotal: [{ TaxAmount: amt(l.tax, cur), TaxSubtotal: [{ TaxableAmount: amt(l.amount, cur), TaxAmount: amt(l.tax, cur), Percent: [{ _: input.taxRate }], TaxCategory: taxCat(input.taxRate) }] }],
        Item: [{ CommodityClassification: [{ ItemClassificationCode: v(l.classification || '022', { listID: 'CLASS' }) }], Description: v(clean(l.desc)) }],
        Price: [{ PriceAmount: amt(l.price, cur) }],
        ItemPriceExtension: [{ Amount: amt(l.amount, cur) }],
      })),
    };
    return {
      _D: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
      _A: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
      _B: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
      Invoice: [doc],
    };
  }

  // ---------- Status and cancellation ----------
  const hoursBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 36e5;
  /**
   * Whether the issuer can still cancel: only a Valid document, and only within 72 hours of validation.
   * Returns { ok, hoursLeft, deadline, reason }. now is an ISO date-time.
   */
  function canCancel(e = {}, now) {
    if (e.status !== 'Valid') return { ok: false, hoursLeft: 0, deadline: '', reason: e.status === 'Cancelled' ? 'Already cancelled' : 'Only a valid e-Invoice can be cancelled' };
    if (!e.validatedAt) return { ok: false, hoursLeft: 0, deadline: '', reason: 'No validation time recorded' };
    const deadline = new Date(Date.parse(e.validatedAt) + CANCEL_WINDOW_HOURS * 36e5).toISOString();
    const left = r2(CANCEL_WINDOW_HOURS - hoursBetween(e.validatedAt, now));
    return left > 0 ? { ok: true, hoursLeft: left, deadline, reason: '' } : { ok: false, hoursLeft: 0, deadline, reason: 'The 72-hour cancellation window has passed. Issue a credit note instead.' };
  }
  /** Allowed next statuses in this app (the API sets Valid or Rejected after validation). */
  const NEXT = { Draft: ['Submitted'], Submitted: ['Valid', 'Rejected'], Valid: ['Cancelled'], Rejected: ['Draft'], Cancelled: [] };
  const canMove = (from, to) => (NEXT[from] || []).includes(to);
  /**
   * The public validation link printed on the e-Invoice (as a QR code).
   * FORMAT: placeholder; verify the share-link pattern in the LHDN MyInvois SDK before production.
   */
  const validationLink = (uuid, longId, env = 'sandbox') => (uuid && longId ? `https://${env === 'production' ? '' : 'preprod.'}myinvois.hasil.gov.my/${uuid}/share/${longId}` : '');

  return { TYPES, NEEDS_ORIGINAL, ID_TYPES, STATES, TAX_TYPES, CLASSES, GENERAL_TIN, STATUSES, CANCEL_WINDOW_HOURS, isTIN, isMSIC, partyProblems, fromInvoice, fromBill, totals, validate, warnings, build, canCancel, canMove, validationLink };
})();

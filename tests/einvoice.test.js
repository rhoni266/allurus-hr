// Unit tests for the e-Invoice rules: the MyInvois document built from seeded invoices, notes and a self-billed
// bill; validation of missing mandatory fields; and the 72-hour cancellation window.
// Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sb = { console };
sb.window = sb;
vm.createContext(sb);
for (const f of ['utils', 'leave-rules', 'attendance-rules', 'statutory', 'claims-rules', 'notify-rules', 'appraisal-rules', 'hr-rules', 'talent-rules', 'einvoice-rules', 'myinvois', 'invoice-rules', 'finance', 'tax', 'claims', 'planner', 'seed']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'), sb, { filename: f + '.js' });
const E = sb.AllurusEInvoiceRules, F = sb.AllurusFinance;
const seed = sb.AllurusSeed.create();
const fin = seed.finance, cfg = seed.settings.einvoice;
const deq = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, msg);
const company = { name: seed.settings.company, tin: cfg.tin, idType: 'BRN', idNo: cfg.brn, sst: cfg.sst, ttx: cfg.ttx, msic: cfg.msic, activity: cfg.activity, email: cfg.email, phone: cfg.phone, address: cfg.address };
const contactOf = (r) => fin.contacts.find((c) => c.id === r.contactId);
const inputFor = (inv) => E.fromInvoice(inv, { company, contact: contactOf(inv), original: inv.ref ? fin.invoices.find((x) => x.id === inv.ref) : null });
const val = (node) => node[0]._;

test('the seeded company and complete customers pass validation; the incomplete one is reported', () => {
  deq(E.partyProblems(company, 'supplier'), []);
  const ready = fin.invoices.filter((i) => i.type === 'invoice' && contactOf(i)?.tin);
  assert.ok(ready.length > 20);
  // Validate as of today: the seed always issues one invoice today.
  const today = sb.U.today();
  ready.forEach((inv) => deq(E.validate(inputFor(inv), today), [], inv.no));
  const incomplete = fin.invoices.find((i) => i.customer.startsWith('Sinar Fresh Mart'));
  const p = E.validate(inputFor(incomplete), today).map((x) => x.field);
  deq(p, ['buyer.tin', 'buyer.idNo', 'buyer.address.postcode', 'buyer.address.state']);
});

test('builder: every seeded invoice maps to a MyInvois document with matching totals and parties', () => {
  fin.invoices.filter((i) => i.type === 'invoice').forEach((inv) => {
    const doc = E.build(inputFor(inv)), d = doc.Invoice[0], t = F.invoiceTotals(inv);
    assert.equal(doc._D, 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2');
    assert.equal(val(d.ID), inv.no);
    assert.equal(val(d.IssueDate), inv.issue);
    assert.equal(val(d.InvoiceTypeCode), '01');
    assert.equal(val(d.DocumentCurrencyCode), 'MYR');
    assert.equal(val(d.LegalMonetaryTotal[0].TaxExclusiveAmount), t.sub, inv.no);
    assert.equal(val(d.TaxTotal[0].TaxAmount), t.tax, inv.no);
    assert.equal(val(d.LegalMonetaryTotal[0].PayableAmount), t.total, inv.no);
    assert.equal(d.InvoiceLine.length, inv.items.length);
    // Line amounts and taxes add up exactly to the document.
    assert.equal(Math.round(d.InvoiceLine.reduce((s, l) => s + val(l.TaxTotal[0].TaxAmount), 0) * 100) / 100, t.tax);
    const sup = d.AccountingSupplierParty[0].Party[0], ids = Object.fromEntries(sup.PartyIdentification.map((x) => [x.ID[0].schemeID, x.ID[0]._]));
    deq(ids, { TIN: 'C25845632000', BRN: '202101023456', SST: 'W10-2108-32000187', TTX: 'NA' });
    assert.equal(val(sup.IndustryClassificationCode), '62010');
    assert.equal(val(sup.PostalAddress[0].CountrySubentityCode), '13');
    assert.equal(val(d.AccountingCustomerParty[0].Party[0].PartyLegalEntity[0].RegistrationName), inv.customer);
    assert.equal(val(d.InvoiceLine[0].Item[0].CommodityClassification[0].ItemClassificationCode), '022');
    assert.ok(!d.BillingReference, 'an invoice has no billing reference');
  });
});

test('builder: the credit note refers to its invoice; tax type follows the rate', () => {
  const cn = fin.invoices.find((i) => i.type === 'credit'), orig = fin.invoices.find((i) => i.id === cn.ref);
  const d = E.build(inputFor(cn)).Invoice[0];
  assert.equal(val(d.InvoiceTypeCode), '02');
  assert.equal(val(d.BillingReference[0].InvoiceDocumentReference[0].ID), orig.no);
  assert.equal(val(d.BillingReference[0].InvoiceDocumentReference[0].UUID), orig.einvoice.uuid);
  assert.equal(val(d.TaxTotal[0].TaxSubtotal[0].TaxCategory[0].ID), '02');
  // The note reduces what is owed on the original invoice.
  assert.equal(F.invoiceTotals(orig).balance, Math.round((F.invoiceTotals(orig).total - F.invoiceTotals(cn).total) * 100) / 100);
  const zero = E.build({ ...inputFor(orig), taxRate: 0, taxType: '06' }).Invoice[0];
  assert.equal(val(zero.TaxTotal[0].TaxSubtotal[0].TaxCategory[0].ID), '06');
  assert.equal(val(zero.TaxTotal[0].TaxAmount), 0);
});

test('builder: a self-billed bill puts the vendor as supplier and the company as buyer', () => {
  const b = fin.bills.find((x) => x.selfBilled), c = fin.contacts.find((x) => x.id === b.contactId);
  const input = E.fromBill(b, { company, contact: c });
  deq(E.validate(input, '2026-10-19'), []);
  const d = E.build(input).Invoice[0];
  assert.equal(val(d.InvoiceTypeCode), '11');
  assert.equal(val(d.AccountingSupplierParty[0].Party[0].PartyLegalEntity[0].RegistrationName), 'Ahmad Fauzi bin Hassan');
  deq(d.AccountingSupplierParty[0].Party[0].PartyIdentification.map((x) => x.ID[0].schemeID + ':' + x.ID[0]._).slice(0, 2), ['TIN:IG23456789010', 'NRIC:880214065123']);
  assert.equal(val(d.AccountingCustomerParty[0].Party[0].PartyLegalEntity[0].RegistrationName), seed.settings.company);
  assert.equal(val(d.LegalMonetaryTotal[0].PayableAmount), 1200);
});

test('validation lists each missing mandatory field', () => {
  const inv = fin.invoices.find((i) => i.type === 'invoice' && contactOf(i)?.tin);
  const base = inputFor(inv);
  const fields = (x) => E.validate(x, '2026-10-19').map((p) => p.field);
  deq(fields({ ...base, supplier: { ...company, tin: '', msic: '6201', activity: '' } }), ['supplier.tin', 'supplier.msic', 'supplier.activity']);
  deq(fields({ ...base, supplier: { ...company, tin: '12345' } }), ['supplier.tin']);
  deq(fields({ ...base, buyer: { ...base.buyer, address: { ...base.buyer.address, postcode: '2500', city: '' }, phone: '' } }), ['buyer.address.city', 'buyer.address.postcode', 'buyer.phone']);
  deq(fields({ ...base, no: '', lines: [{ desc: '', qty: 0, price: 10, classification: '022' }] }), ['no', 'lines.0.desc', 'lines.0.qty']);
  deq(fields({ ...base, lines: [] }), ['lines']);
  deq(fields({ ...base, type: 'credit', original: null }), ['original']);
  deq(fields({ ...base, issue: '2026-10-25' }), ['issue']);
  // A foreign buyer can use a non-Malaysian postcode and the general TIN.
  deq(fields({ ...base, buyer: { ...base.buyer, tin: E.GENERAL_TIN.foreignBuyer, address: { line1: '1 Raffles Place', city: 'Singapore', postcode: '048616', state: '17', country: 'SGP' } } }), []);
  // Warnings: an old issue date and a note whose invoice has no UUID yet.
  assert.ok(E.warnings({ ...base, issue: '2026-10-10' }, '2026-10-19').some((w) => w.label === 'Issue date'));
  assert.ok(E.warnings({ ...base, type: 'credit', original: { no: 'INV-1', uuid: '' } }).some((w) => /UUID/.test(w.label)));
});

test('cancellation is allowed only for a valid e-Invoice and only within 72 hours', () => {
  const at = '2026-10-16T09:00:00.000Z';
  const ok = E.canCancel({ status: 'Valid', validatedAt: at }, '2026-10-19T08:59:00.000Z');
  assert.equal(ok.ok, true);
  assert.equal(ok.hoursLeft, 0.02);
  assert.equal(ok.deadline, '2026-10-19T09:00:00.000Z');
  assert.equal(E.canCancel({ status: 'Valid', validatedAt: at }, '2026-10-19T09:00:00.000Z').ok, false);
  assert.match(E.canCancel({ status: 'Valid', validatedAt: at }, '2026-10-20T00:00:00.000Z').reason, /credit note/);
  assert.equal(E.canCancel({ status: 'Submitted', validatedAt: '' }, at).ok, false);
  assert.equal(E.canCancel({ status: 'Cancelled', validatedAt: at }, at).reason, 'Already cancelled');
  // Seeded: the newest valid invoice is still cancellable on 19 October; older ones are not.
  const valid = fin.invoices.filter((i) => i.einvoice?.status === 'Valid' && i.type === 'invoice').sort((a, b) => b.einvoice.validatedAt.localeCompare(a.einvoice.validatedAt));
  assert.equal(E.canCancel(valid[0].einvoice, '2026-10-19T10:00:00.000Z').ok, true);
  assert.equal(E.canCancel(valid[valid.length - 1].einvoice, '2026-10-19T10:00:00.000Z').ok, false);
});

test('status moves and the stub', async () => {
  assert.equal(E.canMove('Draft', 'Submitted'), true);
  assert.equal(E.canMove('Submitted', 'Valid'), true);
  assert.equal(E.canMove('Valid', 'Cancelled'), true);
  assert.equal(E.canMove('Draft', 'Valid'), false);
  assert.equal(E.canMove('Cancelled', 'Draft'), false);
  assert.equal(E.validationLink('ABC', 'XYZ', 'sandbox'), 'https://preprod.myinvois.hasil.gov.my/ABC/share/XYZ');
  assert.equal(E.validationLink('', 'XYZ'), '');
  const M = sb.AllurusMyInvois;
  const r = await M.submitToMyInvois({});
  assert.equal(r.ok, false);
  assert.equal(r.connected, false);
  const s = M.simulate({ valid: true, now: '2026-10-19T02:00:00.000Z', seed: 'INV-1' });
  assert.equal(s.status, 'Valid');
  assert.equal(s.uuid.length, 26);
  assert.equal(M.simulate({ valid: false }).status, 'Rejected');
});

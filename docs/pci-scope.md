# Allurus POS and PCI DSS scope

Status: design rule for every phase of the point of sale (`js/pos.js`, `js/pos-rules.js`, and later `functions/` and the Android shell). **⚠ verify** items need confirmation from the chosen acquirer or a QSA.

## The rule

Allurus never receives, stores, logs or transmits cardholder data or sensitive authentication data:

- card number (PAN), expiry date, cardholder name taken from the card, service code;
- CVV/CVC, PIN or PIN block, magnetic stripe or chip track data, EMV tags or cryptograms.

Card acceptance happens entirely inside a **PCI MPoC-certified SoftPOS app or SDK** (tap on phone) or a **separate certified terminal**, under a licensed acquirer. Allurus receives only the outcome.

## What we do keep

| Field | Example | Why |
|---|---|---|
| status | approved, declined, cancelled, refunded | to settle the bill |
| amount | 1290 (sen) | to settle the bill |
| cardBrand | Visa | receipt, reconciliation |
| cardLast4 | 4242 | receipt, finding a transaction |
| approvalCode | 834221 | reconciliation with the acquirer |
| providerTxnId | from the provider | refunds, status queries |
| idempotencyKey | our own id | recovering a payment after the app is killed |

## How the code enforces it

- `AllurusPosRules.safeResult()` keeps only the fields above from anything a provider or native bridge returns, and drops anything else (for example `pan`, `track2` or `cvv`). This is tested in `tests/pos.test.js`.
- `cardLast4` must be exactly 4 digits.
- `AllurusPosRules.looksLikePan()` refuses free text (approval code, reference) that contains a Luhn-valid 13–19 digit number, so a cashier can't paste a card number into a "Card (terminal)" record.
- No Web NFC and no custom NFC code. Web NFC can't do EMV payments, and reading cards ourselves would break PCI and acquirer rules.
- Card tap and DuitNow QR can only be approved by the server: by a verified provider callback or status query in Cloud Functions. The browser can't approve them (`canTransition`, and `pos_payments` is `write: if false` for clients in the proposed rules).
- Logs: Cloud Functions log payment ids and statuses, never request bodies from the provider and never full QR payloads that carry tokens.
- Secrets (gateway and SDK keys) go in Google Secret Manager only, never in the repo or the client bundle.

## Resulting scope

Allurus is a merchant-facing software platform that never touches card data. Card capture happens in a certified third-party component, so the merchant's self-assessment should be the lightest available (SAQ A-style, or the acquirer's SoftPOS-specific questionnaire). **⚠ verify** the exact SAQ type with the acquirer once the provider is chosen. Some SoftPOS programmes have their own attestation instead of an SAQ.

## What would put us in scope (never do these)

- Taking a card number in any Allurus form, chat, note or import.
- Logging the native bridge's raw response.
- Proxying the provider's SDK traffic through our servers.
- Storing provider screenshots or receipts that show more than the last 4 digits.

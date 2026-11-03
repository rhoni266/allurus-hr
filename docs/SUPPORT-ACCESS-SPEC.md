# Allurus HR: Support Access (superadmin edits client data on the client's behalf)

## Goal
The owner (superadmin, rhoni.ent@gmail.com) needs to help clients who cannot set up their own data (employees, leave, attendance, settings). Give the superadmin a safe way to **view and edit a client company's data**, with the client's permission, a clear label on every change, and a full log the client can see. Do not weaken tenant isolation for anyone else.

## First, study before coding (do not skip)
1. Read how superadmin works today (custom claim, audit, `firestore.rules`, `superadmin` code in `js/cloud.js` / `js/app.js`). Summarise in 10 lines: what a superadmin can read and write now, how the claim is set, and what is logged.
2. Say what is missing for "edit a client's data as that company". Show a short plan and a sketch. Show any `firestore.rules` diff and wait for my OK. Do not publish rules.

## What to build
1. **Client grant (default OFF).** In the client's Settings: "Allow Allurus support to edit our data" with a duration (24 hours, 7 days, 30 days; default 7 days). It turns itself off at the end. The client admin can turn it off at any time. Without a grant, the superadmin can open the company only in **read-only** (or not at all; tell me what exists today).
2. **Support mode for the superadmin.** The superadmin picks a company and enters "Support mode". A permanent banner shows: "Support mode: you are editing {company} as Allurus support." Edits are allowed only while the grant is active.
3. **Every change is labelled and logged.** Each write by the superadmin is recorded in the company audit log as: who (named superadmin account), when, what record, old value to new value, and the line "by Allurus support". Never log passwords, PINs, join keys, links or full IC numbers.
4. **Client can see the log.** Settings → "Support access log": list of sessions and changes, newest first. The client cannot edit or delete it.
5. **Notify the client.** When support mode starts, show an in-app notice to the company admin: "Allurus support opened your company." (Email too only if the client has email notices on.)
6. **Sensitive data.** While in support mode, payroll amounts, bank details, full IC numbers and password/PIN resets are **hidden or masked by default**. Showing or changing them needs a second explicit client switch: "Also allow support to see pay and ID data" (default OFF, same time limit). Support can never read anyone's password or PIN, and can only use the normal "Reset sign-in" action.
7. **The superadmin account itself.** One named account (mine), not shared. Require a strong sign-in method (Google 2-step verification) and tell me how to confirm it. The superadmin claim is set only by a command I run with the Firebase Admin tools, never from the browser, and never by a link, form or the join page. Tell me the exact command, and how to remove the claim.
8. **Do not** give the superadmin role to any client, staff member or the join page, and do not add a way for a company admin to grant superadmin.

## Tests (run before saying it works)
- Without a grant: superadmin cannot write a client's data (rules test).
- With a grant: can write; after expiry or when the client turns it off: cannot.
- Another company's admin, or a normal user, cannot read or write another company, cannot use support mode, and cannot create or set the superadmin claim.
- Every superadmin write creates an audit entry with the right fields; no secret values appear in it.
- Pay/ID data is masked unless the second switch is on.
- Client sees the support log and the notice; cannot edit the log.
- Existing tests pass (`npm test`) and `tests-rules/` (`npm run test:rules`).

## Working style
- Small steps; say exactly what to run or open after each.
- No commit, push, merge or deploy without my go-ahead. Pull request, preview link, test result, then wait.
- Show rules/functions changes first; do not publish them.
- Bump the cache version in `sw.js`.

## Also for me (not for the agent)
- Put this in the client terms: Allurus acts for the client when it edits their data (PDPA processor role), only with their permission, and every change is logged. Get a short written OK from each real client before the first support session.
- Tell clients when the free trial or demo is only for testing, so they do not put real staff data in before terms are agreed.

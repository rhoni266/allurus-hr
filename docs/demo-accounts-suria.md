# Demo accounts: Suria Enterprise

Open **https://allurus.my/app?demo=suria**. You can also open `?demo` and choose **Suria Enterprise** on the sign-in card. Either click a role under **Explore the demo company**, or type an email below with the demo password.

**Demo password:** the same one as the Seri Maju demo, given in [`demo-accounts.md`](demo-accounts.md). It is stored only as a hash.

Suria Enterprise is a made-up cili boh (chilli paste) factory in Muar, Johor. It has 28 staff, a Monday-to-Saturday week and two production shifts (7:00–15:00 and 15:00–23:00, with a longer break for Friday prayers). It makes four products, sells to 15 shops and wholesalers, and delivers with a van and a lorry. All client and vendor names are invented.

The company has its own copy in the browser, separate from Seri Maju's. **Settings → Reset demo workspace** resets only the company you are in.

| Login | Person | Access | Show |
|---|---|---|---|
| `rosli@suriaenterprise.my` | Rosli bin Hamzah, Owner | Owner (everything) + employee | **Operations today** with the month so far: sales, output, raw materials bought, payroll cost |
| `norhayati@suriaenterprise.my` | Norhayati binti Ismail, Admin Manager | Admin manager: people, time, payroll, claims, finance, operations, settings | **Operations today**, approving POs, invoicing the drivers' deliveries, payroll with overtime |
| `meifong@suriaenterprise.my` | Mei Fong Tan, Account Clerk | Finance + employee | Invoices (cash on delivery and 30-day terms, some overdue), vendor bills, claims |
| `azman@suriaenterprise.my` | Azman bin Yusof, Production Supervisor | Employee (approver) | Leave and overtime approvals for the production crews |
| `halim@suriaenterprise.my` | Halim bin Saad, Storekeeper | Operations (stock and production pages only) + employee | Stock, **Make PO**, receiving a partly delivered PO, batches and QC |
| `shahrul@suriaenterprise.my` | Shahrul Nizam bin Ahmad, Technician | Operations (machines page only) + employee | The filling machine that is down, services due, **Mark fixed** with parts |
| `siewling@suriaenterprise.my` | Siew Ling Lee, Sales Executive | Operations (sales page only) + employee | Today's deliveries by route, a new order picked oldest expiry first |
| `ismail@suriaenterprise.my` | Ismail bin Daud, Lorry Driver | Employee | On a phone, opens **My deliveries**: stops in order, *Delivered* with a photo and cash collected |
| `nurulhuda@suriaenterprise.my` | Nurul Huda binti Salleh, Machine Operator | Employee | Check in for the shift, **Report a breakdown** from the phone |

On a computer, people with a console role start in the console; on a phone, they start in the employee app. They can switch views from the menu under their name.

The storekeeper, technician and sales executive see only their own Operations pages. This limit is in the app's menus only. In the cloud they can still read and change all operations data. See *Not done yet* below.

## A 10-minute walkthrough

1. **Admin manager (Norhayati), 3 min.** She lands on **Operations today**. Walk through the cards:
   - *Manpower*: who is in, on leave or not in yet, by department, and overtime this month.
   - *Stock*: garlic, cooking oil and 500 g jars are below their reorder level. Use *Make PO*.
   - *Production*: one batch is on QC hold.
   - *Deliveries and cash*: six stops today, two delivered.
   - *Money in*: aging, and the five clients who owe the most.
   - *Money out*: bills overdue and due this week.
   - *Machines*: the filling machine is down, waiting for a part.
   - *Expiring soon*: a typhoid jab, a food handler card, a driver's GDL, and the van's road tax and insurance.

   Then go to **Stock & purchasing → Purchase orders**. Approve the draft PO and receive the partly delivered one. The bill appears in **Bills**.
2. **Driver (Ismail), on a phone or a narrow window, 2 min.** He opens straight on **My deliveries today**. Mark a stop *Delivered*: add a photo, a name and the cash collected. A driver can't touch the books, so the delivery waits for the office.
3. **Back as Norhayati, 1 min.** **Sales & delivery** shows *Invoice 1 delivery*. One click creates the invoice in Finance. A cash-on-delivery stop is marked paid at the same time.
4. **Operator (Nurul Huda), 1 min.** On Home, tap **Report a breakdown**, pick the capping machine and describe the fault. The technician and the admin manager get a notification.
5. **Technician (Shahrul), 1 min.** Open **Machines → Breakdowns**, choose *Mark fixed*, add a part and its cost, and tick *add their bill to Finance*. The machine shows as running, and the downtime counts in this month's total.
6. **Storekeeper (Halim), 1 min.** **Production**:
   - *Plan a batch*: the stock check warns if the recipe needs more than the store has.
   - *Record output*: the raw materials come off stock by the recipe.
   - Under *Finished goods*, each batch is shown with its expiry and days of sales.
7. **Owner (Rosli), 1 min.** **Operations today** has the month so far on top: sales, units made, raw materials bought and payroll cost.

## Not done yet

- **Johor public and state holidays** are not built into the leave calendar, so the demo uses the federal list. (TODO in `js/seed-suria.js`.)
- **Overtime eligibility (RM4,000 a month)** uses the app's existing overtime settings. Check the wage limit against the Employment Act First Schedule before using it with a real company.
- **Page limits for the storekeeper, technician and sales executive** (`opsScope`) are applied in the menus only. In the cloud, the Firestore rules give them the whole operations area.
- **The Firestore rules for operations** are in `firestore.rules` but have **not been published**. Publish them, and test them in the Firebase emulator, before a real company uses Operations in the cloud.

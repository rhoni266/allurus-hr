# Deploying Allurus to https://allurus.my (Firebase Hosting)

Allurus is plain HTML, CSS and JavaScript with no build step. It talks to Firebase (Auth and Firestore) straight
from the browser, so it is a static site and Firebase Hosting serves it as is. The site root is the repository root;
`firebase.json` leaves out `.git`, `docs/`, `tests/`, the Markdown files, the zip and `firestore.rules`.

The project is **allurus-hr**, owned by **rhoni.ent@gmail.com**. Every Firebase step below must be done signed in as
that account, or as an account it has made Owner or Editor of the project.

## 1. First deploy (from a computer)

```bash
npm install -g firebase-tools
firebase login                     # opens the browser: sign in as the project owner
cd allurus-hr                      # this repository
npm test
firebase deploy --only hosting     # project allurus-hr comes from .firebaserc
```

Then open **https://allurus-hr.web.app**. The sign-in screen should load, and `?demo` should open the demo company.

## 2. Connect allurus.my

1. In the Firebase console, open **allurus-hr → Hosting → Add custom domain**.
2. Enter `allurus.my`. Leave *Redirect* off. Click **Continue**.
3. Firebase shows the DNS records to add: usually a **TXT** record to verify the domain and one or two **A**
   records. **Copy the exact values from that screen.** They are specific to this project.
4. Add a second custom domain, `www.allurus.my`. This time tick **Redirect to an existing website** and choose
   `allurus.my`. Firebase shows its records too.

### In Namecheap (Domain List → allurus.my → Manage → Advanced DNS)

1. **Delete** the records Namecheap added by default: the `CNAME` record for `www` pointing to
   `parkingpage.namecheap.com`, and any `URL Redirect Record` for `@`. They conflict with Firebase's records.
2. Add each record Firebase showed:

| Type | Host | Value | TTL |
|---|---|---|---|
| TXT | `@` | the `hosting-site=…` text Firebase shows | Automatic |
| A | `@` | first IP address Firebase shows | Automatic |
| A | `@` | second IP address, if Firebase shows one | Automatic |
| A (or CNAME) | `www` | what Firebase shows for `www.allurus.my` | Automatic |

In Namecheap, the host for the bare domain is `@`, not `allurus.my`.

3. Save. Back in Firebase, click **Verify**. Verification usually takes minutes, but can take up to 24 hours.
   Firebase then issues the HTTPS certificate itself, which can take a few more hours.

To check from a terminal: `dig +short allurus.my A` should show only Firebase's IP addresses, and
`dig +short allurus.my TXT` should include the `hosting-site=` value.

## 3. Firebase settings for the live domain

- **Authentication → Settings → Authorized domains → Add domain:** add `allurus.my`, then `www.allurus.my`.
  Email and password sign-in works without this today, but Firebase needs it as soon as a sign-in or email link
  points back to the site, so add both now.
- The app signs in with email and password only (no Google or other OAuth sign-in), so there are no OAuth
  redirect URIs to add.
- **API key restrictions:** in Google Cloud console → **APIs & Services → Credentials**, open the *Browser key*
  for allurus-hr. If **Application restrictions** is set to *HTTP referrers*, add `https://allurus.my/*` and
  `https://www.allurus.my/*`, and keep `https://allurus-hr.web.app/*` and `https://rhoni266.github.io/*`. If it says
  *None*, there is nothing to change.

## 4. Firestore security rules

The rules in `firestore.rules` have **not been published** yet. Publish them, either with
`firebase deploy --only firestore:rules` (signed in as the owner) or by pasting the file into
**Firestore Database → Rules → Publish**. They replace whatever rules are live now.

What the rules allow:

- **Nothing is open to everyone**, and nothing expires. Each company's data can be read and written only by its own
  signed-in members. Payroll, the books, operations and staff records are limited to admins with that area.
- **`demoZones`** (the demo's shared check-in point) can be read and written without signing in, for the three demo
  companies only, and only coordinates, radius, name and field staff. Anyone using the public demo can move the demo
  point; no real data is stored there.
- **Known gap, already reported:** within a company, the shared lists (leave, claims, attendance and other
  every-member buckets) are one document per list. So any signed-in employee can technically change a colleague's
  record in those lists by calling the database directly. The app never does this, but the rules don't prevent it.
  Fixing it needs the server backend in `docs/backend-plan.md`, not a rules change. **Until then, don't hold real
  employee data in the cloud version.**

## 5. Automatic deploys from GitHub

`.github/workflows/firebase-hosting-merge.yml` runs the tests and deploys to the live site on every push to `main`.
`.github/workflows/firebase-hosting-pull-request.yml` posts a temporary preview link on each pull request. Both skip
the deploy step until this secret exists:

1. Signed in as the owner, run `firebase init hosting:github` in this repository and answer:
   - repository: `rhoni266/allurus-hr`;
   - **No** to running a build script;
   - **No** to overwriting the two workflow files.

   It creates a service account and saves the GitHub secret for you.
2. Check that the secret is named **`FIREBASE_SERVICE_ACCOUNT_ALLURUS_HR`**, under GitHub → the repository →
   **Settings → Secrets and variables → Actions**. If the command used a different name, rename the secret or the
   workflow line to match.

Never commit the service-account key file. `.gitignore` already excludes `*service-account*.json`.

## Redeploying

- Merge to `main`: deploys automatically once the secret is set.
- By hand: `firebase deploy --only hosting`.
- Rules only: `firebase deploy --only firestore:rules`.

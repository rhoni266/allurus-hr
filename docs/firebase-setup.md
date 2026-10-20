# Switching Allurus to the cloud (Firebase)

Out of the box Allurus runs in **demo mode**: every browser keeps its own copy of the data. Connecting a Firebase project gives real sign-in and one shared, live copy of each company's data, so a leave request made on Daniel's phone appears on HR's laptop within a second.

Firebase's free **Spark** plan covers a pilot: 50,000 document reads and 20,000 writes a day, and email sign-in at no cost. No card is needed.

## 1. Create the project (about 10 minutes)

1. Go to <https://console.firebase.google.com> and sign in with the Google account that should own the data.
2. **Create a project**, for example `allurus-hr`. Google Analytics is not needed.
3. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable** (leave "Email link" off) → Save.
4. **Authentication → Settings → Authorized domains**: add the domain the app is served from, for example `rhoni266.github.io`. `localhost` is there already.
5. **Build → Firestore Database → Create database**: choose **Production mode**, and a location near your users, for example `asia-southeast1 (Singapore)`. The location can't be changed later.
6. **Firestore → Rules**: replace everything with the contents of [`firestore.rules`](../firestore.rules) and **Publish**.
7. **Project settings (gear) → General → Your apps → Web (`</>`)**: give it a nickname such as `Allurus web`. Hosting is not needed. Copy the `firebaseConfig` object it shows.

## 2. Connect the app

Paste the config into [`js/firebase-config.js`](../js/firebase-config.js):

```js
window.ALLURUS_FIREBASE = {
  apiKey: '…',
  authDomain: 'allurus-hr.firebaseapp.com',
  projectId: 'allurus-hr',
  storageBucket: 'allurus-hr.appspot.com',
  messagingSenderId: '…',
  appId: '…',
};
```

These values only identify the project; they are not passwords. Who can read what is decided by `firestore.rules` on Google's servers. Commit and push, and GitHub Pages serves the cloud version.

## 3. First use

1. Open the app and choose **Register company**. That makes you the Company Admin of a new workspace in the cloud, with the sample team if you tick it.
2. **Settings → Team access**: invite people by their work email, one by one or **Invite all**. Pick **Company Admin** for anyone else in HR.
3. Each person opens the app, chooses **First time here? Set up your account**, uses the invited email, opens the confirmation link Firebase emails them, and signs in.

The demo accounts (`admin@allurus.com` and the others) do not exist in the cloud. To try the sample team, give a sample employee your own second email address on their profile, invite them, and sign in as them in another browser.

## Who sees what

| Data | Company Admins | The employee | Colleagues |
|---|---|---|---|
| Their full record (salary, IC, bank, EPF, face reference) | Yes | Yes | No: name, role, team, contact details and phone registrations only |
| Their payslips and EA form | Yes | Yes | No |
| Payroll runs, finance, loans, insurance, pay changes | Yes | No | No |
| Financial planner and tax reliefs | No | Yes | No |
| Leave, attendance, claims, notifications, training, rooms | Yes | Yes | Yes |
| Settings, departments, appraisal cycles | Change | Read | Read |

Employees can change their own registered phones and face reference from their phone; HR changes everything else. Everyone in one company is invisible to every other company.

## Limits to know

- **Shared within a company**: leave, attendance (with selfies), claims (with receipts) and notifications are readable by every member of the company, because managers approve their team's requests. A manager-only split is the next step.
- **Free-plan reads**: each time someone opens the app it reads the company's documents (about 100–200 for a company of 20 with a year of attendance). 50,000 a day covers roughly 250 openings. Move to the Blaze plan (pay as you go, a few dollars a month at this size) when you grow.
- **Size**: each attendance month is one document of up to 1 MiB, which fits about 150 staff with selfies stored separately. Photos and files over 1 MB stay on the device that added them.
- **Kiosk tablets** need a Company Admin signed in, because they check in many people.
- **Platform console** (Super Admin): still shows the demo companies; the cloud list of companies is a later step.
- The statutory files and LHDN MyInvois connection are unchanged by this: check file formats against the official specs before filing.

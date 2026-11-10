# Allurus mockups (owner's Design canvas "Allurus macOS-style UI", 9-10 Nov 2026)

These are the **source files** of the owner's approved mockup. Open them in a text editor: each is plain HTML with
inline styles (the layout and exact colours, sizes, radii and spacing), plus a small `class Component` script
with the demo data and the click behaviour. They need the Design canvas runtime (`support.js`) to render, so
they don't open as pages on their own: read them, don't serve them. Demo data only; nothing here is real.

| File | Screen | Spec |
|---|---|---|
| `Main.dc.html` | Admin Home on a computer: window, translucent sidebar, toolbar, 4-column widget grid | MACOS-STYLE-UI-SPEC.md |
| `Launcher.dc.html` | All apps: Launchpad-style module grid, search, dock | MACOS-STYLE-UI-SPEC.md |
| `Employees.dc.html` | Employees: table + inspector, filters, teal selected row | MACOS-STYLE-UI-SPEC.md |
| `PhoneEmployee.dc.html` | Employee on a phone: check-in card, leave and payslip widgets, quick actions, my requests, tabs | DEVICE-RULES-SPEC.md |
| `PhoneAdmin.dc.html` | Admin on a phone: Approvals with filter, Approve/Decline, tabs | DEVICE-RULES-SPEC.md |
| `LaptopBlocked.dc.html` | Employee on a computer: "Please use your phone" + QR + Sign out | DEVICE-RULES-SPEC.md |

`{{name}}` in the markup is filled from `renderVals()` in the script at the bottom of each file.
The `docs/**` folder isn't deployed, so these stay out of allurus.my.

/* The connected-business flow diagram, driven entirely by this config.
   - nodes: one per department. x/y = desktop position (viewBox 1000 x 500); mx/my = mobile position (viewBox 420 x 690).
   - edges: from -> to. `label` is an i18n key shown on the line; `money: true` draws it in gold (cash moments).
     `bend` curves the line (positive = bulge to the right of travel direction) so two-way links don't overlap.
   - scenarios: guided walk-throughs; `edges` are indexes into EDGES, played in order.
   Every user-visible string is an i18n key (see js/i18n.js). */

export const NODES = [
  { id: "marketing",  title: "node_marketing",  sub: "node_marketing_sub",  x: 120, y: 150, mx: 110, my: 70 },
  { id: "sales",      title: "node_sales",      sub: "node_sales_sub",      x: 380, y: 150, mx: 310, my: 70 },
  { id: "inventory",  title: "node_inventory",  sub: "node_inventory_sub",  x: 640, y: 150, mx: 310, my: 250 },
  { id: "operations", title: "node_operations", sub: "node_operations_sub", x: 890, y: 150, mx: 310, my: 430 },
  { id: "commission", title: "node_commission", sub: "node_commission_sub", x: 890, y: 420, mx: 310, my: 610 },
  { id: "payroll",    title: "node_payroll",    sub: "node_payroll_sub",    x: 640, y: 420, mx: 110, my: 610 },
  { id: "finance",    title: "node_finance",    sub: "node_finance_sub",    x: 380, y: 420, mx: 110, my: 430, core: true },
  { id: "owner",      title: "node_owner",      sub: "node_owner_sub",      x: 120, y: 420, mx: 110, my: 250, core: true },
];

export const EDGES = [
  /* 0 */ { from: "marketing",  to: "sales",      label: "edge_leads" },
  /* 1 */ { from: "sales",      to: "inventory",  label: "edge_reserve" },
  /* 2 */ { from: "finance",    to: "inventory",  label: "edge_po", bend: 40, money: true },
  /* 3 */ { from: "inventory",  to: "operations", label: "edge_stock_in" },
  /* 4 */ { from: "inventory",  to: "finance",    label: "edge_grn", bend: 40, money: true },
  /* 5 */ { from: "operations", to: "commission", label: "edge_output" },
  /* 6 */ { from: "commission", to: "payroll",    label: "edge_comm" },
  /* 7 */ { from: "payroll",    to: "finance",    label: "edge_payroll_cost", money: true },
  /* 8 */ { from: "operations", to: "finance",    label: "edge_invoice", bend: -70, money: true },
  /* 9 */ { from: "finance",    to: "owner",      label: "edge_cash" },
  /* 10 */ { from: "marketing", to: "owner",      label: "edge_roi" },
  /* 11 */ { from: "sales",     to: "operations", label: "edge_order", bend: -190 },
];

export const SCENARIOS = [
  { id: "po",    label: "scn_po",    steps: "scn_po_steps",    edges: [2, 3, 4] },
  { id: "sale",  label: "scn_sale",  steps: "scn_sale_steps",  edges: [0, 11, 1, 8, 9] },
  { id: "pay",   label: "scn_pay",   steps: "scn_pay_steps",   edges: [5, 6, 7, 9] },
];

// Notification rules: what each event says (in the app and by email), who gets it through which channel under their
// preferences, and the daily reminders (probation, contracts, passports and work permits, birthdays, work
// anniversaries, statutory deadlines, appraisals). Pure functions with no DOM access, unit tested in
// tests/notify.test.js.
window.AllurusNotifyRules = (function () {
  'use strict';
  const parse = (s) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
  const days = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const fmt = (d) => (d ? `${+d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}` : '');
  const fmtMonth = (mk) => `${MONTHS[+mk.slice(5, 7) - 1]} ${mk.slice(0, 4)}`;
  const inDays = (n) => (n < 0 ? `${-n} day${n === -1 ? '' : 's'} ago` : n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);

  // Categories people can set a channel for.
  const CATEGORIES = {
    requests: 'Requests and approvals', pay: 'Payroll and payslips', announcements: 'Announcements and policies',
    schedule: 'Roster changes', attendance: 'Flagged check-ins', appraisals: 'Appraisals and feedback', reminders: 'Reminders',
  };
  const CHANNELS = { both: 'In the app and by email', inapp: 'In the app only', email: 'By email only', off: 'Off' };
  const defaultPrefs = () => Object.fromEntries(Object.keys(CATEGORIES).map((k) => [k, k === 'reminders' ? 'inapp' : 'both']));
  const route = (prefs, category) => { const c = (prefs || {})[category] || defaultPrefs()[category] || 'both'; return { inApp: c === 'both' || c === 'inapp', email: c === 'both' || c === 'email' }; };

  const KIND = { leave: 'leave', claim: 'claim', ot: 'overtime', waiver: 'lateness waiver', correction: 'attendance correction' };
  const what = (d) => `${KIND[d.kind] || 'request'}${d.summary ? ` (${d.summary})` : ''}`;
  // Each event: category, icon, and the text for the app and for email. data carries names and links.
  const TYPES = {
    'request.submitted': { cat: 'requests', icon: 'check', text: (d) => [`${d.who} asked for ${what(d)}`, 'Waiting for your decision.'] },
    'request.step': { cat: 'requests', icon: 'check', text: (d) => [`${d.who}’s ${what(d)} needs you`, `Approved by ${d.by}. You decide next.`] },
    'request.approved': { cat: 'requests', icon: 'check', text: (d) => [`Your ${what(d)} was approved`, d.note ? `${d.by}: “${d.note}”` : `Approved by ${d.by}.`] },
    'request.rejected': { cat: 'requests', icon: 'x', text: (d) => [`Your ${what(d)} was declined`, d.note ? `${d.by}: “${d.note}”` : `Declined by ${d.by}.`] },
    'payroll.paid': { cat: 'pay', icon: 'wallet', text: (d) => [`${fmtMonth(d.month)} payroll was paid`, `${d.count} people, ${d.net} net. Statutory files are ready.`] },
    'payslip.ready': { cat: 'pay', icon: 'wallet', text: (d) => [`Your ${fmtMonth(d.month)} payslip is ready`, `Net pay ${d.net}.`] },
    'announcement.new': { cat: 'announcements', icon: 'doc', text: (d) => [d.policy ? `New policy: ${d.title}` : d.title, d.policy ? 'Please read and acknowledge it.' : d.excerpt || 'A new announcement from HR.'] },
    'announcement.remind': { cat: 'announcements', icon: 'doc', text: (d) => [`Reminder: acknowledge “${d.title}”`, 'HR is waiting for your acknowledgement.'] },
    'roster.changed': { cat: 'schedule', icon: 'calendar', text: (d) => [`Your roster changed`, d.detail || `Week of ${fmt(d.week)}.`] },
    'checkin.flagged': { cat: 'attendance', icon: 'shield', text: (d) => [`${d.who}’s check-in needs a look`, d.reason] },
    'appraisal.launched': { cat: 'appraisals', icon: 'trend', text: (d) => [`${d.cycle} appraisals have started`, `Rate yourself and add your goals. Your self-review is due ${fmt(d.date)}.`] },
    'appraisal.toscore': { cat: 'appraisals', icon: 'trend', text: (d) => [`Score ${d.who}’s ${d.cycle} appraisal`, d.note ? `Sent back by HR: “${d.note}”` : 'Their part is done. Rate each item and add your recommendation.'] },
    'appraisal.final': { cat: 'appraisals', icon: 'trend', text: (d) => [`${d.who}’s appraisal is ready for HR final`, `${d.cycle}: approve or edit the recommendation.`] },
    'appraisal.done': { cat: 'appraisals', icon: 'star', text: (d) => [`Your ${d.cycle} appraisal is complete`, d.grade ? `Final grade ${d.grade}. Open it to see the details.` : 'Open it to see the details.'] },
    'appraisal.peer': { cat: 'appraisals', icon: 'people', text: (d) => [`${d.who} asked for your feedback`, `${d.cycle} 360° feedback. Your answers are anonymous.`] },
    'appraisal.overdue': { cat: 'appraisals', icon: 'trend', text: (d) => [d.self ? `Your ${d.cycle} ${d.step} is overdue` : `${d.who}’s appraisal is overdue with you`, `The ${d.step} step was due ${fmt(d.date)}.`] },
    'profile.request': { cat: 'requests', icon: 'edit', text: (d) => [`${d.who} asked to update their details`, `Changes to ${d.fields}. Check and approve them.`] },
    'profile.decided': { cat: 'requests', icon: 'check', text: (d) => [d.approved ? 'Your details were updated' : 'Your detail change was declined', d.note ? `HR: “${d.note}”` : d.approved ? 'HR approved the change.' : 'Check with HR.'] },
    'profile.document': { cat: 'requests', icon: 'doc', text: (d) => [`${d.who} added a document`, `“${d.title}” is on their employee file.`] },
    'task.assigned': { cat: 'reminders', icon: 'userplus', text: (d) => [`${d.count} ${d.kind} task${d.count === 1 ? '' : 's'} for ${d.self ? 'you' : d.who}`, `First: ${d.first}, due ${fmt(d.date)}.`] },
    'task.overdue': { cat: 'reminders', icon: 'userplus', text: (d) => [`${d.count} onboarding or offboarding task${d.count === 1 ? ' is' : 's are'} overdue`, `${d.first} (${d.who})${d.count > 1 ? ' and more' : ''}.`] },
    'reminder.document': { cat: 'reminders', icon: 'doc', text: (d) => [`${d.self ? 'Your ' : ''}${d.title}${d.who && !d.self ? ` for ${d.who}` : ''} ${d.left < 0 ? 'has expired' : 'expires ' + inDays(d.left)}`, `Expiry ${fmt(d.date)}. Renew it or upload the new one.`] },
    'reminder.probation': { cat: 'reminders', icon: 'people', text: (d) => [`Confirm ${d.who}’s probation`, `Probation ends ${fmt(d.date)} (${inDays(d.left)}).`] },
    'reminder.contract': { cat: 'reminders', icon: 'doc', text: (d) => [`${d.who}’s contract ends ${inDays(d.left)}`, `Contract end date ${fmt(d.date)}. Renew it or plan the handover.`] },
    'reminder.passport': { cat: 'reminders', icon: 'doc', text: (d) => [`${d.who}’s passport ${d.left < 0 ? 'has expired' : 'expires ' + inDays(d.left)}`, `Expiry ${fmt(d.date)}. A valid passport is needed to renew the work permit.`] },
    'reminder.permit': { cat: 'reminders', icon: 'doc', text: (d) => [`${d.who}’s work permit ${d.left < 0 ? 'has expired' : 'expires ' + inDays(d.left)}`, `Expiry ${fmt(d.date)}. Start the renewal early.`] },
    'reminder.birthday': { cat: 'reminders', icon: 'star', text: (d) => [d.self ? `Happy birthday, ${d.first}!` : `It’s ${d.who}’s birthday today`, d.self ? 'Everyone at the company wishes you a great day.' : 'Send them your wishes.'] },
    'reminder.anniversary': { cat: 'reminders', icon: 'star', text: (d) => [d.self ? `Happy ${d.years}-year work anniversary!` : `${d.who} has been with us ${d.years} year${d.years === 1 ? '' : 's'} today`, d.self ? 'Thank you for everything you do.' : 'A good day to say thank you.'] },
    'reminder.statutory': { cat: 'reminders', icon: 'shield', text: (d) => [d.title, d.detail] },
    'reminder.appraisal': { cat: 'reminders', icon: 'trend', text: (d) => [`Your ${d.cycle} appraisal is due ${inDays(d.left)}`, `It is ${d.status.toLowerCase()}. Update your goals by ${fmt(d.date)}.`] },
    'reminder.appraisals': { cat: 'reminders', icon: 'trend', text: (d) => [`${d.count} appraisal${d.count === 1 ? ' is' : 's are'} not submitted`, `${d.cycle} appraisals are due ${fmt(d.date)} (${inDays(d.left)}): ${d.names}.`] },
  };
  // The message for an event: in-app title and text, plus an email subject and body.
  function build(type, data = {}) {
    const t = TYPES[type];
    if (!t) throw new Error(`Unknown notification type ${type}`);
    const [title, body] = t.text(data);
    const company = data.company || 'Allurus';
    return {
      type, cat: t.cat, icon: t.icon, title, body, href: data.href || '',
      subject: `${title} · ${company}`,
      email: `Hi ${data.toFirst || 'there'},\n\n${title}.\n${body}\n\n${data.link ? `Open it in ${company}: ${data.link}\n\n` : ''}You get this email because of your notification settings in ${company}. Change them under Settings → Notifications.`,
    };
  }
  /**
   * Plans delivery to several people. recipients = [{ id, email, first, prefs }]. Skips the person who caused the
   * event (from) unless self is true. Returns { notifications: [...], emails: [...] } to add to state.
   */
  function deliver(type, data, recipients, { from = '', self = false, at = '', key = '', ids = () => Math.random().toString(36).slice(2) } = {}) {
    const notifications = [], emails = [], seen = new Set();
    recipients.forEach((r) => {
      if (!r?.id || seen.has(r.id) || (!self && r.id === from)) return;
      seen.add(r.id);
      const m = build(type, { ...data, toFirst: r.first });
      const ch = route(r.prefs, m.cat);
      if (ch.inApp) notifications.push({ id: `n-${ids()}`, to: r.id, type, cat: m.cat, icon: m.icon, title: m.title, body: m.body, href: m.href, at, read: false, from, key });
      if (ch.email && r.email) emails.push({ id: `m-${ids()}`, to: r.email, toId: r.id, type, subject: m.subject, body: m.email, at, status: 'queued', key });
    });
    return { notifications, emails };
  }
  const unread = (list, to) => list.filter((n) => n.to === to && !n.read).length;
  const markRead = (list, to, id) => list.map((n) => (n.to === to && (!id || n.id === id) ? { ...n, read: true } : n));
  // Keeps the newest n per person so storage doesn't grow forever.
  function trim(list, n = 100) {
    const per = {};
    return [...list].sort((a, b) => (b.at || '').localeCompare(a.at || '')).filter((x) => (per[x.to] = (per[x.to] || 0) + 1) <= n);
  }

  // ---------- Reminders ----------
  // Windows in days before the date: when a reminder starts showing.
  const WINDOWS = { probation: 30, contract: 30, passport: 180, permit: 90, appraisal: 14, document: 60 };
  const fullName = (e) => `${e.first} ${e.last}`.trim();
  // Same month and day this year (29 February counts on 28 February in other years).
  const sameDay = (date, today) => { const md = date.slice(5); return md === today.slice(5) || (md === '02-29' && today.slice(5) === '02-28' && +today.slice(0, 4) % 4 !== 0); };
  /**
   * Reminders due today. Each has a stable key, so running twice on the same day (or again later in the window)
   * doesn't repeat it: probation, contract and document reminders repeat at most weekly, birthdays once a year.
   * Returns [{ type, key, data, to: 'hr' | empId | ['hr', empId] }].
   */
  function reminders({ employees, today, reviews = [], statutory = [], documents = [], windows = WINDOWS }) {
    const out = [], W = { ...WINDOWS, ...windows };
    const week = (d) => Math.floor(days('2020-01-06', d) / 7);
    employees.filter((e) => e.status !== 'Inactive').forEach((e) => {
      const who = fullName(e);
      const dated = (field, type, win, extra = {}) => {
        const d = e[field]; if (!d) return;
        const left = days(today, d);
        if (left <= win && left >= -30) out.push({ type, key: `${type}:${e.id}:${d}:${week(today)}`, to: 'hr', data: { who, date: d, left, empId: e.id, ...extra } });
      };
      if (!e.confirmedOn) dated('probationEnd', 'reminder.probation', W.probation);
      dated('contractEnd', 'reminder.contract', W.contract);
      dated('passportExpiry', 'reminder.passport', W.passport);
      dated('permitExpiry', 'reminder.permit', W.permit);
      if (e.birthday && sameDay(e.birthday, today)) out.push({ type: 'reminder.birthday', key: `birthday:${e.id}:${today.slice(0, 4)}`, to: ['hr', e.id], data: { who, first: e.first, empId: e.id } });
      if (e.start && e.start < today && sameDay(e.start, today)) {
        const years = +today.slice(0, 4) - +e.start.slice(0, 4);
        if (years > 0) out.push({ type: 'reminder.anniversary', key: `anniversary:${e.id}:${today.slice(0, 4)}`, to: ['hr', e.id], data: { who, first: e.first, years, empId: e.id } });
      }
    });
    // Each person gets their own appraisal reminder; HR gets one summary per due date.
    const late = {};
    reviews.filter((r) => r.due && r.status !== 'Completed').forEach((r) => {
      const e = employees.find((x) => x.id === r.empId); if (!e || e.status === 'Inactive') return;
      const left = days(today, r.due);
      if (left > W.appraisal || left < -30) return;
      out.push({ type: 'reminder.appraisal', key: `appraisal:${r.id}:${week(today)}`, to: e.id, data: { first: e.first, cycle: r.cycle, status: r.status, date: r.due, left, empId: e.id } });
      (late[r.due] = late[r.due] || { cycle: r.cycle, left, names: [] }).names.push(e.first);
    });
    Object.entries(late).forEach(([due, x]) => out.push({ type: 'reminder.appraisals', key: `appraisals:${due}:${week(today)}`, to: 'hr', data: { count: x.names.length, cycle: x.cycle, date: due, left: x.left, names: x.names.slice(0, 6).join(', ') + (x.names.length > 6 ? ` and ${x.names.length - 6} more` : '') } }));
    // Documents on employee files and company policies with an expiry date: HR, plus the employee for their own.
    documents.filter((x) => x.expiry).forEach((x) => {
      const e = x.empId && employees.find((y) => y.id === x.empId);
      if (x.empId && (!e || e.status === 'Inactive')) return;
      const left = days(today, x.expiry);
      if (left > W.document || left < -30) return;
      out.push({ type: 'reminder.document', key: `doc:${x.id}:${x.expiry}:${left < 0 ? 'late' : left <= 14 ? 'soon' : 'due'}`, to: e ? ['hr', e.id] : 'hr', data: { title: x.title, who: e ? `${e.first} ${e.last}` : '', date: x.expiry, left, ...(e ? { empId: e.id } : {}) } });
    });
    statutory.forEach((s) => out.push({ type: 'reminder.statutory', key: `statutory:${s.key}:${today}`, to: 'hr', data: { title: s.title, detail: s.detail } }));
    return out;
  }

  return { CATEGORIES, CHANNELS, TYPES, WINDOWS, defaultPrefs, route, build, deliver, unread, markRead, trim, reminders };
})();

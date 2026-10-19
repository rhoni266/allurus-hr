// Meeting rooms: rooms with seats and equipment, a day calendar per room, bookings with a conflict check, and
// "My bookings". Interviews booked from Recruitment show here too. Rules: js/talent-rules.js.
window.AllurusRooms = (function () {
  'use strict';
  const R = window.AllurusTalentRules;
  let ctx = null;
  const st = () => ctx.state;
  const esc = (s) => ctx.esc(s);
  const icon = (n) => ctx.icon(n);
  const T = () => U.today();
  const rooms = () => (st().rooms = st().rooms || []);
  const bookings = () => (st().bookings = st().bookings || []);
  const room = (id) => rooms().find((r) => r.id === id);
  const emp = (id) => ctx.emp(id);
  const actor = () => (ctx.role() === 'admin' ? ctx.account()?.empId || 'e1' : ctx.me()?.id);
  const fmt = (d, o = { weekday: 'short', day: 'numeric', month: 'short' }) => (d ? U.fmtDate(d, o) : '—');
  const nowISO = () => { const d = new Date(); return `${T()}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const ui = { tab: 'calendar', day: '' };
  const OPEN = 8, CLOSE = 19; // calendar hours
  const pct = (hm) => ((R.toMin(hm) - OPEN * 60) / ((CLOSE - OPEN) * 60)) * 100;
  const live = () => bookings().filter((b) => b.status !== 'Cancelled');

  function bookingForm({ id = '', roomId = '', date = '', start = '' } = {}) {
    const b = id ? bookings().find((x) => x.id === id) : { roomId: roomId || rooms().find((r) => r.active !== false)?.id, date: date || ui.day || T(), start: start || '10:00', end: start ? `${String(+start.slice(0, 2) + 1).padStart(2, '0')}:${start.slice(3)}` : '11:00', title: '', people: 4 };
    ctx.openModal({
      title: id ? 'Change booking' : 'Book a room', submit: id ? 'Save' : 'Book',
      body: `<div class="form-grid"><div class="field full"><label for="bk-t">What for</label><input class="input" id="bk-t" name="title" required value="${esc(b.title)}" placeholder="e.g. Weekly sales meeting"></div>
        <div class="field"><label for="bk-r">Room</label><select class="select" id="bk-r" name="roomId">${rooms().filter((r) => r.active !== false).map((r) => `<option value="${r.id}" ${b.roomId === r.id ? 'selected' : ''}>${esc(r.name)} (${r.capacity})</option>`).join('')}</select></div>
        <div class="field"><label for="bk-d">Date</label><input class="input" id="bk-d" name="date" type="date" required min="${T()}" value="${b.date}"></div>
        <div class="field"><label for="bk-s">From</label><input class="input" id="bk-s" name="start" type="time" step="900" required value="${b.start}"></div>
        <div class="field"><label for="bk-e">To</label><input class="input" id="bk-e" name="end" type="time" step="900" required value="${b.end}"></div>
        <div class="field"><label for="bk-p">People</label><input class="input num" id="bk-p" name="people" type="number" min="1" max="200" value="${b.people}"></div></div>
        <div id="bk-check" class="bk-check" role="status" aria-live="polite"></div>`,
      onSubmit(d) {
        const x = { id: id || U.uid('bk'), roomId: d.roomId, date: d.date, start: d.start, end: d.end, title: d.title.trim(), people: +d.people || 1, by: id ? b.by : actor(), status: 'Booked', ref: b.ref || '' };
        const p = R.bookingProblems(x, { rooms: rooms(), bookings: bookings(), now: nowISO() });
        if (p.length) { ctx.toast(p[0], 'error'); return false; }
        if (id) Object.assign(b, x); else bookings().push(x);
        ui.day = x.date;
        ctx.commit(`${room(x.roomId).name} booked ${fmt(x.date)} ${x.start}–${x.end}`);
      },
    });
    const f = ctx.$('#overlay-root form');
    const check = () => {
      const x = { id: id || 'new', roomId: f.roomId.value, date: f.date.value, start: f.start.value, end: f.end.value, people: +f.people.value || 1 };
      const p = R.bookingProblems(x, { rooms: rooms(), bookings: bookings(), now: nowISO() });
      const r = room(x.roomId);
      const free = p.length ? rooms().filter((o) => o.active !== false && o.id !== x.roomId && !R.bookingProblems({ ...x, roomId: o.id }, { rooms: rooms(), bookings: bookings(), now: nowISO() }).length) : [];
      ctx.$('#bk-check').innerHTML = p.length ? `<div class="bk-bad">${icon('x')}${p.map(esc).join('. ')}.</div>${free.length ? `<div class="faint">Free then: ${free.map((o) => `<button type="button" class="link-btn" data-bk-swap="${o.id}">${esc(o.name)}</button>`).join(', ')}</div>` : ''}` : `<div class="bk-ok">${icon('check')}${esc(r?.name || '')} is free.${r?.equipment?.length ? ` <span class="faint">${esc(r.equipment.join(', '))}</span>` : ''}</div>`;
    };
    f.addEventListener('input', check); f.addEventListener('change', check);
    ctx.$('#bk-check').addEventListener('click', (ev) => { const s = ev.target.closest('[data-bk-swap]'); if (s) { f.roomId.value = s.dataset.bkSwap; check(); } });
    check();
  }
  function roomForm(id = '') {
    const r = id ? room(id) : { name: '', floor: '', capacity: 6, equipment: [], active: true };
    ctx.openModal({
      title: id ? `Edit ${r.name}` : 'Add a room', submit: 'Save room',
      body: `<div class="form-grid"><div class="field"><label for="rm-n">Name</label><input class="input" id="rm-n" name="name" required value="${esc(r.name)}"></div>
        <div class="field"><label for="rm-f">Where</label><input class="input" id="rm-f" name="floor" value="${esc(r.floor)}" placeholder="e.g. Level 2"></div>
        <div class="field"><label for="rm-c">Seats</label><input class="input num" id="rm-c" name="capacity" type="number" min="1" max="500" value="${r.capacity}"></div>
        <div class="field full"><label for="rm-e">Equipment (comma separated)</label><input class="input" id="rm-e" name="equipment" value="${esc(r.equipment.join(', '))}" placeholder="TV screen, Video call, Whiteboard"></div>
        <label class="check field full"><input type="checkbox" name="active" ${r.active !== false ? 'checked' : ''}><span>Bookable</span></label></div>`,
      onSubmit(d) {
        const x = { name: d.name.trim(), floor: d.floor.trim(), capacity: Math.max(1, +d.capacity || 1), equipment: d.equipment.split(',').map((s) => s.trim()).filter(Boolean), active: d.active === 'on' };
        if (rooms().some((o) => o.id !== id && o.name.toLowerCase() === x.name.toLowerCase())) { ctx.toast('A room has that name', 'error'); return false; }
        if (id) Object.assign(r, x); else rooms().push({ id: U.uid('rm'), ...x });
        ctx.commit('Room saved');
      },
    });
  }
  function detail(id) {
    const b = bookings().find((x) => x.id === id), mine = b.by === actor(), r = room(b.roomId), past = `${b.date}T${b.end}` <= nowISO();
    ctx.openModal({
      title: b.title, submit: null,
      body: `<dl class="kv"><dt>Room</dt><dd>${esc(r?.name || '')}${r?.floor ? ` · ${esc(r.floor)}` : ''}</dd><dt>When</dt><dd>${fmt(b.date, { weekday: 'long', day: 'numeric', month: 'long' })}, ${esc(b.start)}–${esc(b.end)}</dd><dt>Booked by</dt><dd>${esc(ctx.fullName(emp(b.by)))}</dd><dt>People</dt><dd>${b.people}</dd>${b.ref ? '<dt>From</dt><dd>Recruitment (interview)</dd>' : ''}</dl>
        ${(mine || ctx.role() === 'admin') && !past && b.status !== 'Cancelled' ? `<div class="ci-actions" style="justify-content:flex-end">${!b.ref ? `<button type="button" class="btn" data-act="bk-edit" data-id="${b.id}">Change</button>` : ''}<button type="button" class="btn btn-danger" data-act="bk-cancel" data-id="${b.id}">Cancel booking</button></div>` : ''}`,
    });
  }

  // ---------- Views ----------
  function calendar() {
    const day = ui.day || T(), hours = Array.from({ length: CLOSE - OPEN }, (_, i) => OPEN + i), rs = rooms().filter((r) => r.active !== false);
    const nowLine = day === T() ? (() => { const n = nowISO().slice(11); return R.toMin(n) >= OPEN * 60 && R.toMin(n) <= CLOSE * 60 ? `<i class="rm-now" style="left:${pct(n)}%" aria-hidden="true"></i>` : ''; })() : '';
    return `<div class="rm-bar"><div class="row-actions"><button class="btn btn-sm btn-icon" data-act="bk-day" data-v="-1" aria-label="Previous day">${icon('left')}</button><input class="input" type="date" id="bk-day" value="${day}" aria-label="Day"><button class="btn btn-sm btn-icon" data-act="bk-day" data-v="1" aria-label="Next day">${icon('right')}</button>${day !== T() ? '<button class="btn btn-sm btn-ghost" data-act="bk-day" data-v="0">Today</button>' : ''}</div><strong>${fmt(day, { weekday: 'long', day: 'numeric', month: 'long' })}</strong></div>
      <div class="card card-flush rm-cal-card"><div class="rm-cal" style="--hours:${hours.length}">
        <div class="rm-row rm-hours"><div class="rm-name"></div><div class="rm-track">${hours.map((h) => `<span style="left:${pct(`${String(h).padStart(2, '0')}:00`)}%">${h <= 12 ? h : h - 12}${h < 12 ? 'am' : 'pm'}</span>`).join('')}</div></div>
        ${rs.map((r) => `<div class="rm-row"><div class="rm-name"><strong>${esc(r.name)}</strong><span class="faint">${r.capacity} seats${r.floor ? ` · ${esc(r.floor)}` : ''}</span></div><div class="rm-track">${hours.map((h) => `<button type="button" class="rm-slot" style="left:${pct(`${String(h).padStart(2, '0')}:00`)}%" data-act="bk-new" data-id="${r.id}" data-v="${day}|${String(h).padStart(2, '0')}:00" aria-label="Book ${esc(r.name)} at ${h}:00"></button>`).join('')}
          ${live().filter((b) => b.roomId === r.id && b.date === day).map((b) => `<button type="button" class="rm-bk ${b.by === actor() ? 'mine' : ''} ${b.ref ? 'iv' : ''}" style="left:${Math.max(0, pct(b.start))}%;width:${Math.min(100, pct(b.end)) - Math.max(0, pct(b.start))}%" data-act="bk-open" data-id="${b.id}" title="${esc(b.title)} ${esc(b.start)}–${esc(b.end)}"><strong>${esc(b.title)}</strong><span>${esc(b.start)}–${esc(b.end)} · ${esc(emp(b.by)?.first || '')}</span></button>`).join('')}${nowLine}</div></div>`).join('')}
      </div></div>
      <p class="faint">Tap an empty hour to book it. Your bookings are highlighted.</p>`;
  }
  function myBookings() {
    const me = actor(), up = bookings().filter((b) => b.by === me && b.status !== 'Cancelled' && `${b.date}T${b.end}` > nowISO()).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    const past = bookings().filter((b) => b.by === me && (b.status === 'Cancelled' || `${b.date}T${b.end}` <= nowISO())).sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start)).slice(0, 8);
    const row = (b) => `<div class="list-item"><div class="rm-date"><strong>${+b.date.slice(8)}</strong><span>${U.fmtDate(b.date, { month: 'short' })}</span></div><div class="grow"><div class="person-name">${esc(b.title)}</div><div class="person-sub">${esc(room(b.roomId)?.name || '')} · ${fmt(b.date, { weekday: 'short' })} ${esc(b.start)}–${esc(b.end)}${b.status === 'Cancelled' ? ' · cancelled' : ''}</div></div><button class="btn btn-sm" data-act="bk-open" data-id="${b.id}">Open</button></div>`;
    return `<div class="card card-flush"><div class="card-head" style="padding-bottom:12px"><h3>Coming up</h3></div>${up.length ? `<div class="list">${up.map(row).join('')}</div>` : '<div class="empty"><strong>No bookings</strong>Book a room from the calendar.</div>'}</div>
      ${past.length ? `<div class="card card-flush"><div class="card-head" style="padding-bottom:12px"><h3>Past and cancelled</h3></div><div class="list">${past.map(row).join('')}</div></div>` : ''}`;
  }
  function roomsTab() {
    const week = U.addDays(T(), 7);
    return `<div class="card card-flush"><div class="table-wrap"><table><thead><tr><th>Room</th><th class="r">Seats</th><th class="hide-sm">Equipment</th><th class="r">Bookings next 7 days</th><th></th></tr></thead><tbody>
      ${rooms().map((r) => `<tr><td><strong>${esc(r.name)}</strong><div class="person-sub">${esc(r.floor || '')}${r.active === false ? ' · not bookable' : ''}</div></td><td class="r num">${r.capacity}</td><td class="hide-sm muted">${esc(r.equipment.join(', ') || '—')}</td><td class="r num">${live().filter((b) => b.roomId === r.id && b.date >= T() && b.date <= week).length}</td><td><div class="row-actions"><button class="btn btn-sm" data-act="rm-edit" data-id="${r.id}">Edit</button></div></td></tr>`).join('')}</tbody></table></div></div>`;
  }
  function view() {
    const admin = ctx.role() === 'admin', mine = bookings().filter((b) => b.by === actor() && b.status !== 'Cancelled' && `${b.date}T${b.end}` > nowISO()).length;
    const tabs = [['calendar', 'Calendar'], ['mine', `My bookings${mine ? ` (${mine})` : ''}`], ...(admin ? [['rooms', 'Rooms']] : [])];
    if (!tabs.some(([k]) => k === ui.tab)) ui.tab = 'calendar';
    return `<div class="page-head"><div><h1>Meeting rooms</h1><p class="sub">${rooms().filter((r) => r.active !== false).length} rooms. ${live().filter((b) => b.date === T()).length} bookings today.</p></div><div class="actions">${admin ? `<button class="btn" data-act="rm-edit" data-id="">${icon('plus')}Add room</button>` : ''}<button class="btn btn-primary" data-act="bk-new">${icon('calendar')}Book a room</button></div></div>
      <div class="seg rc-tabs" role="tablist" aria-label="Meeting rooms">${tabs.map(([k, l]) => `<button role="tab" data-act="bk-tab" data-v="${k}" class="${ui.tab === k ? 'on' : ''}" aria-selected="${ui.tab === k}">${l}</button>`).join('')}</div>
      ${ui.tab === 'mine' ? myBookings() : ui.tab === 'rooms' ? roomsTab() : calendar()}`;
  }
  function insights() {
    const me = actor(), next = bookings().filter((b) => b.by === me && b.status !== 'Cancelled' && b.date === T() && `${b.date}T${b.end}` > nowISO()).sort((a, b) => a.start.localeCompare(b.start))[0];
    return next ? [{ tone: 'info', icon: 'calendar', title: `${next.title} at ${next.start}`, detail: `${room(next.roomId)?.name || ''}, until ${next.end}.`, action: { label: 'Rooms', href: '#rooms' }, prio: 1 }] : [];
  }

  function install(c) {
    ctx = c;
    ctx.VIEWS.rooms = view;
    ctx.AFTER.rooms = () => ctx.$('#bk-day')?.addEventListener('change', (ev) => { if (ev.target.value) { ui.day = ev.target.value; ctx.render(); } });
    Object.assign(ctx.ACTIONS, {
      'bk-tab': (_, v) => { ui.tab = v; ctx.render(); },
      'bk-day': (_, v) => { ui.day = +v === 0 ? T() : U.addDays(ui.day || T(), +v); ctx.render(); },
      'bk-new': (id, v) => { const [date, start] = (v || '').split('|'); if (date && `${date}T${start}` < nowISO().slice(0, 14) + '00') { ctx.toast('That hour has passed', 'error'); return; } bookingForm({ roomId: id, date, start }); },
      'bk-open': (id) => detail(id),
      'bk-edit': (id) => { ctx.closeOverlay(); setTimeout(() => bookingForm({ id }), 40); },
      'bk-cancel': (id) => {
        const b = bookings().find((x) => x.id === id); b.status = 'Cancelled';
        if (b.by !== actor()) ctx.notify?.event('booking.cancelled', { room: room(b.roomId)?.name || '', date: b.date, time: `${b.start}–${b.end}`, note: 'Cancelled by HR', href: '#rooms' }, b.by, { from: actor() });
        if (b.ref) st().candidates.forEach((cd) => (cd.interviews || []).forEach((iv) => { if (iv.id === b.ref) iv.where = ''; }));
        ctx.closeOverlay(); ctx.commit('Booking cancelled');
      },
      'rm-edit': (id) => roomForm(id),
    });
    return { insights, nextFor: (id) => live().filter((b) => b.by === id && b.date >= T()).length };
  }
  return { install };
})();

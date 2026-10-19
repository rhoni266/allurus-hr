// Maps for the check-in zone: a picker in Settings and a small preview when a check-in is outside the zone.
// Leaflet (BSD-2, js/vendor/leaflet) with OpenStreetMap tiles and Nominatim search: free, no API key.
window.AllurusMap = (function () {
  'use strict';
  let loading = null;
  function load() {
    if (window.L) return Promise.resolve(window.L);
    if (!loading) {
      loading = new Promise((resolve, reject) => {
        const css = document.createElement('link');
        css.rel = 'stylesheet'; css.href = 'js/vendor/leaflet/leaflet.css?v=1.9.4';
        document.head.appendChild(css);
        const s = document.createElement('script');
        s.src = 'js/vendor/leaflet/leaflet.js?v=1.9.4';
        s.onload = () => resolve(window.L);
        s.onerror = () => { loading = null; reject(new Error('The map could not load.')); };
        document.head.appendChild(s);
      });
    }
    return loading;
  }
  const brand = () => getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() || '#0F766E';
  const tiles = (L) => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  });
  const pin = (L, cls = '') => L.divIcon({ className: `map-pin ${cls}`, html: '<span></span>', iconSize: [30, 40], iconAnchor: [15, 38] });
  const dot = (L) => L.divIcon({ className: 'map-dot', html: '<span></span>', iconSize: [18, 18], iconAnchor: [9, 9] });

  // Interactive picker. onPick({ lat, lng }, how) fires when the pin is dropped by a tap or a drag.
  async function picker(el, { lat, lng, radius, approx, onPick }) {
    const L = await load();
    if (!el.isConnected) return null;
    const map = L.map(el, { scrollWheelZoom: false, zoomSnap: 0.5 }).setView([lat, lng], approx ? 13 : 17);
    tiles(L).addTo(map);
    const color = brand();
    const circle = L.circle([lat, lng], { radius, color, weight: 2, fillColor: color, fillOpacity: 0.14, interactive: false }).addTo(map);
    const marker = L.marker([lat, lng], { draggable: true, autoPan: true, keyboard: true, icon: pin(L, approx ? 'approx' : ''), title: 'Check-in point. Drag to move.', alt: 'Check-in point' }).addTo(map);
    marker.on('drag', (e) => circle.setLatLng(e.latlng));
    marker.on('dragend', () => { const p = marker.getLatLng(); onPick({ lat: p.lat, lng: p.lng }, 'drag'); });
    map.on('click', (e) => { marker.setLatLng(e.latlng); circle.setLatLng(e.latlng); onPick({ lat: e.latlng.lat, lng: e.latlng.lng }, 'tap'); });
    // Containers that change size (mobile rotation, sidebar) need Leaflet to re-measure.
    const ro = window.ResizeObserver ? new ResizeObserver(() => map.invalidateSize()) : null;
    ro?.observe(el);
    return {
      map,
      setPoint(p, { zoom } = {}) {
        marker.setLatLng([p.lat, p.lng]); circle.setLatLng([p.lat, p.lng]);
        el.querySelector('.map-pin')?.classList.remove('approx');
        map.setView([p.lat, p.lng], zoom || Math.max(map.getZoom(), 16));
      },
      setRadius(r) { circle.setRadius(r); },
      view: (p, zoom) => map.setView([p.lat, p.lng], zoom),
      destroy() { ro?.disconnect(); map.remove(); },
    };
  }

  // Read-only preview: the zone circle, the employee's position and the gap between them.
  async function preview(el, zone, pos) {
    const L = await load();
    if (!el.isConnected) return null;
    const map = L.map(el, { scrollWheelZoom: false, attributionControl: true }).setView([zone.lat, zone.lng], 16);
    tiles(L).addTo(map);
    const color = brand();
    L.circle([zone.lat, zone.lng], { radius: zone.radius, color, weight: 2, fillColor: color, fillOpacity: 0.14 }).addTo(map);
    const zoneBounds = L.latLng(zone.lat, zone.lng).toBounds(zone.radius * 2);
    L.marker([zone.lat, zone.lng], { icon: pin(L), title: zone.label, keyboard: false }).addTo(map);
    if (pos?.lat != null) {
      L.marker([pos.lat, pos.lng], { icon: dot(L), title: 'You', keyboard: false }).addTo(map);
      if (pos.accuracy) L.circle([pos.lat, pos.lng], { radius: pos.accuracy, color: '#2F6AD0', weight: 1, fillOpacity: 0.08, interactive: false }).addTo(map);
      L.polyline([[pos.lat, pos.lng], [zone.lat, zone.lng]], { color, weight: 2, dashArray: '6 6', interactive: false }).addTo(map);
      map.fitBounds(L.latLngBounds([[pos.lat, pos.lng], [zone.lat, zone.lng]]).extend(zoneBounds), { padding: [28, 28], maxZoom: 17 });
    } else map.fitBounds(zoneBounds, { padding: [28, 28] });
    return map;
  }

  // Place search with Nominatim. Called only when the person submits a search (their usage policy forbids
  // search-as-you-type), so it stays well under one request per second.
  async function search(q) {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=0&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json', 'Accept-Language': navigator.language || 'en' } });
    if (!res.ok) throw new Error(`Search failed (${res.status})`);
    return (await res.json()).map((x) => ({ lat: +x.lat, lng: +x.lon, name: x.display_name }));
  }

  return { load, picker, preview, search };
})();

'use strict';
/* 제다 실사 PWA · 데이터는 이 기기 IndexedDB 에만 저장하고 서버로 보내지 않음 */
const APP_VERSION = '0.1.1';
const QS = new URLSearchParams(location.search);
const DEMO = QS.get('demo') === '1';
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IS_ANDROID = /Android/i.test(navigator.userAgent);

const APPS = {
  balady: { label: 'Balady+', file: 'Balady' },
  google: { label: '구글', file: 'Google' },
  hudhud: { label: 'HudHud', file: 'HudHud' },
  field: { label: '현장', file: 'Field' },
};
const NAV_APPS = ['balady', 'google', 'hudhud'];
const CATS = ['표지판 디자인', '방향 · 차로 표기', '유턴 방식', '단속 카메라', '진입 불가 (왕궁 · 별장)', '안내 좌표 · 입출구',
  '공사 · 철거', '지도 미현행화', '일방 · 회전 규제', '랜드마크 · POI', '경로 안내 오류', '기타'];
const VERDICT = { ok: '정상', bad: '오류', none: '없음' };

const BALADY_PRESETS = {
  default: { label: '기본 (balady.plus 유니버설 링크)', tpl: 'https://balady.plus/open?ct=routeCar&slat={slat}&slng={slng}&sname={sname}&dlat={lat}&dlng={lng}&dname={name}' },
  alt1: { label: '대안 1 (baladyplus.sa)', tpl: 'https://baladyplus.sa/open?ct=routeCar&slat={slat}&slng={slng}&sname={sname}&dlat={lat}&dlng={lng}&dname={name}' },
  alt2: { label: '대안 2 (bplusmaps:// 스킴)', tpl: 'bplusmaps://route/car?slat={slat}&slng={slng}&sname={sname}&dlat={lat}&dlng={lng}&dname={name}&appname=jeddah.survey' },
  custom: { label: '사용자 정의', tpl: '' },
};
const GOOGLE_PRESETS = {
  ios: { label: 'iOS 앱 스킴 (comgooglemaps://)', tpl: 'comgooglemaps://?daddr={lat},{lng}&directionsmode=driving' },
  android: { label: '안드로이드 인텐트', tpl: 'intent://maps.google.com/maps?daddr={lat},{lng}&directionsmode=driving#Intent;scheme=https;package=com.google.android.apps.maps;end' },
  web: { label: '웹 링크 (google.com/maps/dir)', tpl: 'https://www.google.com/maps/dir/?api=1&destination={lat},{lng}&travelmode=driving&dir_action=navigate' },
  custom: { label: '사용자 정의', tpl: '' },
};
const HUDHUD_MODES = {
  share: '① 공유 시트로 보내기 (지도 링크 → HudHud 선택)',
  intent: '② 링크 복사 후 HudHud 열기 (안드로이드) · 검색창에 붙여넣기',
  custom: '③ 사용자 정의 링크',
};
const DEFAULT_SETTINGS = {
  author: '', role: 'all', basemap: 'osm',
  baladyPreset: 'default', baladyCustom: '',
  googlePreset: IS_IOS ? 'ios' : (IS_ANDROID ? 'android' : 'web'), googleCustom: '',
  hudhudMode: 'share', hudhudCustom: 'https://maps.google.com/?q={lat},{lng}',
};

const $ = (s, el = document) => el.querySelector(s);
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
const pad = (n, w = 2) => String(n).padStart(w, '0');
const nowIso = () => new Date().toISOString();
function localStamp(d = new Date()) { return `${pad(d.getFullYear() % 100)}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`; }
function hhmmss(iso) { const d = new Date(iso); return `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`; }
function hm(iso) { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function km(a, b) {
  const R = 6371, toR = Math.PI / 180, dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function fmtKm(d) { return d == null ? '' : (d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1)} km`); }

/* ---------- IndexedDB ---------- */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('jeddah-survey', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('kv');
        d.createObjectStore('records', { keyPath: 'id' });
        const m = d.createObjectStore('media', { keyPath: 'id' }); m.createIndex('recordId', 'recordId');
        d.createObjectStore('visits', { keyPath: 'id', autoIncrement: true });
        d.createObjectStore('tracks', { keyPath: 'id' });
      };
      r.onsuccess = () => { DB.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  done(t) { return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('abort')); }); },
  req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  get(store, key) { return DB.req(DB.db.transaction(store).objectStore(store).get(key)); },
  all(store) { return DB.req(DB.db.transaction(store).objectStore(store).getAll()); },
  async put(store, val, key) {
    const t = DB.db.transaction(store, 'readwrite'); const s = t.objectStore(store);
    const r = key === undefined ? s.put(val) : s.put(val, key); await DB.done(t); return r.result;
  },
  async putMany(store, vals) { const t = DB.db.transaction(store, 'readwrite'); const s = t.objectStore(store); vals.forEach(v => s.put(v)); await DB.done(t); },
  async del(store, key) { const t = DB.db.transaction(store, 'readwrite'); t.objectStore(store).delete(key); await DB.done(t); },
  async clearAll() { const names = ['kv', 'records', 'media', 'visits', 'tracks']; const t = DB.db.transaction(names, 'readwrite'); names.forEach(n => t.objectStore(n).clear()); await DB.done(t); },
  async count(store) { return DB.req(DB.db.transaction(store).objectStore(store).count()); },
};
const kvGet = k => DB.get('kv', k);
const kvSet = (k, v) => DB.put('kv', v, k);

/* ---------- state ---------- */
const S = {
  settings: { ...DEFAULT_SETTINGS }, pack: null, plan: [], planBySeq: new Map(), status: {}, currentSeq: null,
  records: [], gps: null, follow: true, tracking: false, track: null, wakeLock: null, deviceId: null,
  lastExportAt: null, opened: {}, map: null, L: {}, lastZip: null, dayFilter: null,
};

/* ---------- toast ---------- */
let toastTimer = null;
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}

/* ---------- visits log ---------- */
function logVisit(type, extra = {}) {
  const v = { t: nowIso(), type, seq: S.currentSeq, ...extra };
  if (S.gps) { v.lat = +S.gps.lat.toFixed(6); v.lng = +S.gps.lng.toFixed(6); }
  DB.put('visits', v).catch(e => console.warn('visit', e));
}

/* ---------- pack ---------- */
function parsePack(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('JSON 형식이 아닙니다');
  const range = obj.range && obj.range.type === 'FeatureCollection' ? obj.range : null;
  const planFc = obj.plan && obj.plan.type === 'FeatureCollection' ? obj.plan : null;
  if (!range && !planFc) throw new Error('range · plan 이 없는 파일입니다');
  const plan = [];
  for (const f of (planFc ? planFc.features : [])) {
    if (!f.geometry || f.geometry.type !== 'Point') continue;
    const p = f.properties || {}; const [lng, lat] = f.geometry.coordinates;
    if (p.seq == null || !isFinite(lat) || !isFinite(lng)) continue;
    plan.push({ seq: Number(p.seq), name: String(p.name || `지점 ${p.seq}`), cat: p.cat || '', cats: p.cats || '', reason: p.reason || '',
      priority: p.priority || '', mesh: p.mesh || '', day: p.day || '', fc: p.fc ?? '', survey: p.survey || '', build: p.build || '', lat: +lat, lng: +lng });
  }
  plan.sort((a, b) => a.seq - b.seq);
  return { version: String(obj.version ?? ''), name: obj.name || '실사 패키지', created: obj.created || '', range, plan, loadedAt: nowIso() };
}
async function installPack(pack, quiet) {
  const prev = S.pack;
  S.pack = pack; S.plan = pack.plan; S.planBySeq = new Map(pack.plan.map(p => [p.seq, p]));
  if (prev && prev.version !== pack.version) {
    for (const k of Object.keys(S.status)) { const p = S.planBySeq.get(+k); if (!p) delete S.status[k]; }
  }
  if (S.currentSeq == null || !S.planBySeq.has(S.currentSeq)) S.currentSeq = pack.plan.length ? pack.plan[0].seq : null;
  await kvSet('pack', pack); await kvSet('status', S.status); await kvSet('currentSeq', S.currentSeq);
  if (S.currentSeq != null && (!prev || prev.version !== pack.version || prev.loadedAt !== pack.loadedAt)) logVisit('set', { seq: S.currentSeq, reason: 'pack' });
  renderRange(); renderPlan(); renderCard(); updateAppLinks();
  if (pack.range) { try { S.map.fitBounds(S.L.range.getBounds(), { padding: [10, 10] }); } catch (e) { } }
  if (!quiet) { await setDayFilter(autoDay()); toast(`「${pack.name}」 불러옴 · 지점 ${pack.plan.length}곳`); }
}
function pickPack() { $('#filePack').value = ''; $('#filePack').click(); }

/* ---------- map ---------- */
function initMap() {
  const map = L.map('map', { zoomControl: false, attributionControl: true, preferCanvas: false }).setView([21.55, 39.17], 11);
  L.control.zoom({ position: 'topright' }).addTo(map);
  S.L.base = {
    osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, crossOrigin: true, attribution: '© OpenStreetMap' }),
    sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, crossOrigin: true, attribution: 'Esri World Imagery' }),
  };
  (S.L.base[S.settings.basemap] || S.L.base.osm).addTo(map);
  S.L.range = L.featureGroup().addTo(map);
  S.L.meshLbl = L.layerGroup();
  S.L.track = L.polyline([], { color: '#ff3b30', weight: 4, opacity: .85, dashArray: '8 6' }).addTo(map);
  S.L.plan = L.layerGroup().addTo(map);
  S.L.rec = L.layerGroup().addTo(map);
  let lastTier = null;
  map.on('zoomend', () => {
    if (map.getZoom() >= 13) { if (!map.hasLayer(S.L.meshLbl)) S.L.meshLbl.addTo(map); }
    else if (map.hasLayer(S.L.meshLbl)) map.removeLayer(S.L.meshLbl);
    const t = zoomTier(); if (t !== lastTier) { lastTier = t; if (S.plan.length) renderPlan(); }
  });
  map.on('dragstart', () => { if (S.follow) setFollow(false); });
  S.map = map;
}
function setBasemap(k) {
  for (const l of Object.values(S.L.base)) if (S.map.hasLayer(l)) S.map.removeLayer(l);
  (S.L.base[k] || S.L.base.osm).addTo(S.map);
}
function polyCenter(geom) {
  let minx = 999, miny = 999, maxx = -999, maxy = -999;
  const rings = geom.type === 'MultiPolygon' ? geom.coordinates.map(p => p[0]) : [geom.coordinates[0]];
  rings.forEach(r => r.forEach(([x, y]) => { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }));
  return [(miny + maxy) / 2, (minx + maxx) / 2];
}
function mmdd(s) { if (!s) return ''; const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[2]}/${m[3]}` : String(s); }
function renderRange() {
  S.L.range.clearLayers(); S.L.meshLbl.clearLayers();
  const rng = S.pack && S.pack.range; if (!rng) return;
  L.geoJSON(rng, {
    style: () => ({ color: '#1f2937', weight: 1, opacity: .7, fillColor: '#4da3ff', fillOpacity: .05 }),
    onEachFeature: (f, layer) => {
      const p = f.properties || {};
      layer.bindPopup(`<b>메시 ${p.mesh ?? ''}</b><br>조사 ${p['조사일정'] || '미정'} · 구축 ${p['구축일정'] || '미정'}<br>도로 ${p['전체'] ?? '-'} km (주요 ${p['주요도로'] ?? '-'} · 레지덴셜 ${p['레지덴셜'] ?? '-'})`);
      const lbl = mmdd(p['조사일정']);
      if (lbl) L.marker(polyCenter(f.geometry), { interactive: false, icon: L.divIcon({ className: '', html: `<div class="meshlbl">${lbl}</div>`, iconSize: [40, 14], iconAnchor: [20, 7] }) }).addTo(S.L.meshLbl);
    },
  }).eachLayer(l => S.L.range.addLayer(l));
}
function zoomTier() { const z = S.map ? S.map.getZoom() : 13; return z >= 14 ? 2 : (z >= 12 ? 1 : 0); }
function planIcon(p) {
  const st = S.status[p.seq] || {}; const cur = p.seq === S.currentSeq;
  const cls = cur ? 'cur' : (st.visited ? 'done' : (st.skipped ? 'skip' : ''));
  const tier = zoomTier();
  if (!cur && tier === 0) return L.divIcon({ className: '', html: `<div class="pdot ${cls}"></div>`, iconSize: [12, 12], iconAnchor: [6, 6] });
  if (!cur && tier === 1) return L.divIcon({ className: '', html: `<div class="pm sm ${cls}">${p.seq}</div>`, iconSize: [28, 18], iconAnchor: [14, 9] });
  return L.divIcon({ className: '', html: `<div class="pm ${cls}">${p.seq}</div>`, iconSize: [44, 30], iconAnchor: [22, 15] });
}
function renderPlan() {
  S.L.plan.clearLayers();
  for (const p of vis()) {
    const m = L.marker([p.lat, p.lng], { icon: planIcon(p), zIndexOffset: p.seq === S.currentSeq ? 1000 : 0 });
    m.bindPopup(() => planPopup(p));
    m.addTo(S.L.plan);
  }
}
function planPopup(p) {
  const st = S.status[p.seq] || {};
  const box = h('div', null,
    h('div', null, h('b', null, `P${pad(p.seq, 3)} ${p.name}`)),
    h('div', null, [p.day, p.cat, p.priority && `우선 ${p.priority}`, p.fc !== '' && `FC${p.fc}`].filter(Boolean).join(' · ')),
    (p.survey || p.build) ? h('div', { class: 'muted' }, `N1 조사 ${mmdd(p.survey) || '-'} · 구축 ${mmdd(p.build) || '-'} · 메시 ${p.mesh}`) : null,
    p.reason ? h('div', null, p.reason) : null,
    h('div', { class: 'muted' }, st.visited ? `방문 ${hm(st.visitedAt)}` : (st.skipped ? '건너뜀' : '미방문')),
    h('div', { class: 'pbtns' },
      h('button', { onclick: () => { S.map.closePopup(); goTo(p.seq, true); } }, '여기로 가기 ▶'),
      h('button', { onclick: () => { S.map.closePopup(); openRecord(null, p.seq); } }, '＋ 기록')));
  return box;
}
function recIcon(r) {
  return L.divIcon({ className: '', html: `<div class="rm ${r.urgent ? 'urg' : ''}">${r.no}</div>`, iconSize: [34, 34], iconAnchor: [17, 17] });
}
function renderRecords() {
  S.L.rec.clearLayers();
  for (const r of S.records) {
    if (r.lat == null) continue;
    L.marker([r.lat, r.lng], { icon: recIcon(r), zIndexOffset: 500 }).on('click', () => openRecord(r.id)).addTo(S.L.rec);
  }
}

/* ---------- GPS & track ---------- */
let meMarker = null, meCircle = null, gpsWatch = null, demoTimer = null;
function startGPS() {
  if (!('geolocation' in navigator)) { $('#gpsStat').textContent = 'GPS 없음'; return; }
  gpsWatch = navigator.geolocation.watchPosition(onPos, err => {
    $('#gpsStat').textContent = err.code === 1 ? 'GPS 거부됨' : 'GPS 오류';
    if (DEMO && !S.gps) demoGps();
  }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  if (DEMO) demoTimer = setTimeout(() => { if (!S.gps) demoGps(); }, 2500);
}
function demoGps() { onPos({ coords: { latitude: 21.5433, longitude: 39.1728, accuracy: 12 }, timestamp: Date.now(), demo: true }); }
function onPos(pos) {
  const c = pos.coords;
  S.gps = { lat: c.latitude, lng: c.longitude, acc: c.accuracy, t: pos.timestamp };
  $('#gpsStat').textContent = `GPS ±${Math.round(c.accuracy)}m${pos.demo ? ' (데모)' : ''}`;
  const ll = [c.latitude, c.longitude];
  if (!meMarker) {
    meCircle = L.circle(ll, { radius: c.accuracy, color: '#1e88ff', weight: 1, fillOpacity: .12, interactive: false }).addTo(S.map);
    meMarker = L.marker(ll, { interactive: false, zIndexOffset: 2000, icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [24, 24], iconAnchor: [12, 12] }) }).addTo(S.map);
  } else { meMarker.setLatLng(ll); meCircle.setLatLng(ll).setRadius(c.accuracy); }
  if (S.follow) S.map.panTo(ll, { animate: true });
  if (S.tracking) addTrackPoint(c.latitude, c.longitude, pos.timestamp);
  updateCardDistance(); updateAppLinks();
}
function setFollow(on) {
  S.follow = on; const b = $('#btnFollow'); b.setAttribute('aria-pressed', on); b.textContent = on ? '따라가기 켬' : '따라가기 끔';
  if (on && S.gps) S.map.panTo([S.gps.lat, S.gps.lng]);
}
async function requestWake() {
  try { if ('wakeLock' in navigator && S.tracking) S.wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { console.warn('wakeLock', e); }
}
async function toggleTrack() {
  if (!S.tracking) {
    S.tracking = true; S.track = { id: uid('t_'), startedAt: nowIso(), endedAt: null, pts: [] };
    S.L.track.setLatLngs([]); await requestWake(); toast('주행 궤적 기록 시작 · 화면을 켜 두세요');
  } else {
    S.tracking = false; S.track.endedAt = nowIso();
    if (S.track.pts.length) await DB.put('tracks', S.track);
    try { if (S.wakeLock) await S.wakeLock.release(); } catch (e) { }
    S.wakeLock = null; toast(`궤적 저장 · ${S.track.pts.length}점`);
  }
  const b = $('#btnTrack'); b.setAttribute('aria-pressed', S.tracking); b.textContent = S.tracking ? '● 궤적 기록 중' : '궤적 꺼짐';
}
function addTrackPoint(lat, lng, ts) {
  const t = S.track; if (!t) return;
  const last = t.pts[t.pts.length - 1];
  if (last) { const d = km({ lat: last[1], lng: last[0] }, { lat, lng }) * 1000; if (d < 12 && ts - last[3] < 10000) return; }
  t.pts.push([+lng.toFixed(6), +lat.toFixed(6), new Date(ts).toISOString(), ts]);
  S.L.track.addLatLng([lat, lng]);
  if (t.pts.length % 15 === 0) DB.put('tracks', t).catch(() => { });
}

/* ---------- deep links ---------- */
function baladyTpl() { const s = S.settings; return s.baladyPreset === 'custom' ? s.baladyCustom : (BALADY_PRESETS[s.baladyPreset] || BALADY_PRESETS.default).tpl; }
function googleTpl() { const s = S.settings; return s.googlePreset === 'custom' ? s.googleCustom : (GOOGLE_PRESETS[s.googlePreset] || GOOGLE_PRESETS.web).tpl; }
function fillTpl(tpl, p) {
  if (!tpl) return '';
  const hasStart = !!S.gps;
  const name = p.name ? `P${pad(p.seq, 3)} ${p.name}` : `P${pad(p.seq, 3)}`;
  const vars = { lat: p.lat.toFixed(6), lng: p.lng.toFixed(6), name, slat: hasStart ? S.gps.lat.toFixed(6) : null, slng: hasStart ? S.gps.lng.toFixed(6) : null, sname: hasStart ? 'Current location' : null };
  let url = tpl;
  if (!hasStart && /\{s(lat|lng|name)\}/.test(url)) {
    const qi = url.indexOf('?');
    if (qi >= 0) {
      const head = url.slice(0, qi + 1); let rest = url.slice(qi + 1); let hash = '';
      const hi = rest.indexOf('#'); if (hi >= 0) { hash = rest.slice(hi); rest = rest.slice(0, hi); }
      rest = rest.split('&').filter(kv => !/\{s(lat|lng|name)\}/.test(kv)).join('&');
      url = head + rest + hash;
    }
  }
  return url.replace(/\{(lat|lng|name|slat|slng|sname)\}/g, (_, k) => encodeURIComponent(vars[k] ?? ''));
}
function linkFor(app, p) {
  if (app === 'balady') return fillTpl(baladyTpl(), p);
  if (app === 'google') return fillTpl(googleTpl(), p);
  if (app === 'hudhud') return S.settings.hudhudMode === 'custom' ? fillTpl(S.settings.hudhudCustom, p) : '';
  return '';
}
function mapShareUrl(p) { return `https://maps.google.com/?q=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`; }
function navigateTo(url) {
  const a = document.createElement('a'); a.href = url; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
}
async function openApp(app, viaAnchor) {
  const p = S.planBySeq.get(S.currentSeq); if (!p) return;
  S.opened[app] = true; logVisit('open', { app }); renderAppRow();
  if (app === 'hudhud' && S.settings.hudhudMode !== 'custom') {
    const text = `P${pad(p.seq, 3)} ${p.name}`; const url = mapShareUrl(p);
    if (S.settings.hudhudMode === 'share' && navigator.share) {
      try { await navigator.share({ title: text, text, url }); } catch (e) { if (e.name !== 'AbortError') { await copyText(url); toast('공유가 안 돼 링크를 복사했습니다 · HudHud 검색창에 붙여넣기'); } }
      return;
    }
    await copyText(url);
    if (IS_ANDROID) { toast('지도 링크 복사됨 · HudHud 검색창에 붙여넣기'); navigateTo('intent://#Intent;package=sa.hudhud.maps;end'); }
    else toast('지도 링크 복사됨 · HudHud 를 열고 검색창에 붙여넣기', 4000);
    return;
  }
  const url = linkFor(app, p);
  if (!url) { toast('설정에서 링크 형식을 먼저 정하세요'); return; }
  if (app === 'balady' && !S.gps && /\{s(lat|lng|name)\}/.test(baladyTpl())) toast('출발지 없음 : 길찾기 홈으로 열림', 3500);
  if (!viaAnchor) navigateTo(url);
  const t0 = Date.now();
  setTimeout(() => { if (document.visibilityState === 'visible' && Date.now() - t0 < 3000) toast(`${APPS[app].label} 가 안 열렸으면 설정에서 링크 형식을 바꿔 보세요`, 3500); }, 1800);
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch (e) {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' }); ta.value = t; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); } catch (e2) { } ta.remove(); return false;
  }
}

/* ---------- destination navigation ---------- */
function days() { return [...new Set(S.plan.map(p => p.day).filter(Boolean))]; }
function vis() { return S.dayFilter && S.dayFilter !== 'all' ? S.plan.filter(p => p.day === S.dayFilter) : S.plan; }
function idxOf(seq, L = vis()) { return L.findIndex(p => p.seq === seq); }
function nextOpenSeq(fromSeq) {
  const L = vis(); const i = idxOf(fromSeq, L);
  for (let j = i + 1; j < L.length; j++) { const st = S.status[L[j].seq] || {}; if (!st.visited && !st.skipped) return L[j].seq; }
  for (let j = 0; j < (i < 0 ? L.length : i); j++) { const st = S.status[L[j].seq] || {}; if (!st.visited && !st.skipped) return L[j].seq; }
  return null;
}
function autoDay() {
  const d = new Date(); const tag = `${d.getMonth() + 1}/${d.getDate()}`;
  return days().find(x => x.startsWith(tag)) || 'all';
}
async function setDayFilter(v) {
  S.dayFilter = v; await kvSet('dayFilter', v);
  const L = vis();
  if (!L.some(p => p.seq === S.currentSeq)) { const first = L.find(p => { const st = S.status[p.seq] || {}; return !st.visited && !st.skipped; }) || L[0]; if (first) setCurrent(first.seq, 'set'); }
  renderPlan(); renderCard(); updateAppLinks();
}
function daySelect() {
  const sel = h('select', { class: 'daySel', 'aria-label': '일자 필터' });
  sel.append(h('option', { value: 'all', selected: !S.dayFilter || S.dayFilter === 'all' }, `전체 ${S.plan.length}`));
  days().forEach(d => sel.append(h('option', { value: d, selected: S.dayFilter === d }, `${d} ${S.plan.filter(p => p.day === d).length}`)));
  sel.onchange = () => setDayFilter(sel.value);
  return sel;
}
function setStatus(seq, patch) { S.status[seq] = { ...(S.status[seq] || {}), ...patch }; kvSet('status', S.status); }
function setCurrent(seq, type) {
  S.currentSeq = seq; S.opened = {}; kvSet('currentSeq', seq); logVisit(type, { seq });
  renderPlan(); renderCard(); updateAppLinks();
  const p = S.planBySeq.get(seq); if (p && !S.follow) S.map.panTo([p.lat, p.lng]);
}
function autoOpenRole() {
  const role = S.settings.role;
  if (role !== 'all' && NAV_APPS.includes(role)) {
    if (role === 'balady' || role === 'google') { const a = $(`#card a[data-app="${role}"]`); if (a && a.href) { const url = a.href; S.opened[role] = true; logVisit('open', { app: role }); renderAppRow(); navigateTo(url); return; } }
    openApp(role);
  }
}
function doNext(skip) {
  if (!S.plan.length) return pickPack();
  const cur = S.currentSeq;
  if (cur != null) setStatus(cur, skip ? { skipped: true, skippedAt: nowIso() } : { visited: true, visitedAt: nowIso() });
  const nx = nextOpenSeq(cur);
  if (nx == null) { renderPlan(); renderCard(); toast('남은 지점이 없습니다'); return; }
  setCurrent(nx, skip ? 'skip' : 'next');
  autoOpenRole();
}
function doPrev() {
  if (!S.plan.length) return;
  const L = vis(); const i = idxOf(S.currentSeq, L); if (i <= 0) { toast('첫 지점입니다'); return; }
  setCurrent(L[i - 1].seq, 'prev');
}
function goTo(seq, open) { setCurrent(seq, 'set'); if (open) autoOpenRole(); }

/* ---------- card ---------- */
function renderCard() {
  const card = $('#card'); card.innerHTML = '';
  if (!S.pack || !S.plan.length) {
    card.append(
      h('div', { class: 'info' }, h('div', { class: 'name', style: 'grid-column:1/-1' }, '실사 패키지를 불러오세요'),
        h('div', { class: 'sub' }, '웍스로 받은 실사 패키지 파일(.json)을 고르면 실사 범위와 가볼 지점이 들어옵니다.')),
      h('div', { class: 'row', style: 'grid-template-columns:2fr 1fr' },
        h('button', { class: 'b primary', onclick: pickPack }, '패키지 불러오기'),
        h('button', { class: 'b', onclick: () => openRecord(null, null) }, '＋ 자유 기록')));
    return;
  }
  const p = S.planBySeq.get(S.currentSeq) || vis()[0] || S.plan[0];
  const st = S.status[p.seq] || {};
  const done = vis().filter(x => (S.status[x.seq] || {}).visited).length;
  const recN = S.records.filter(r => r.seq === p.seq).length;
  card.append(
    h('div', { class: 'info' },
      h('div', { class: 'seq' }, `P${pad(p.seq, 3)}`),
      h('div', { class: 'name' }, p.name),
      days().length ? daySelect() : h('span'),
      h('div', { class: 'sub', id: 'cardSub' }, subLine(p, st, done, recN)),
      p.reason ? h('div', { class: 'sub' }, p.reason) : null),
    h('div', { class: 'row nav' },
      h('button', { class: 'b', onclick: doPrev }, '◀ 이전'),
      h('button', { class: 'b', onclick: () => doNext(true) }, '건너뛰기'),
      h('button', { class: 'b primary', onclick: () => doNext(false) }, '다음 ▶')),
    h('div', { class: 'row apps', id: 'appRow' }),
    h('div', { class: 'row act' },
      h('button', { class: 'b big', onclick: () => openRecord(null, p.seq) }, '＋ 기록'),
      h('button', { class: 'b', onclick: quickCapture }, '캡처 붙이기'),
      h('button', { class: 'b', onclick: openList }, '목록')));
  renderAppRow();
}
function subLine(p, st, done, recN) {
  const d = S.gps ? fmtKm(km(S.gps, p)) : '거리 ?';
  const state = st.visited ? `방문 ${hm(st.visitedAt)}` : (st.skipped ? '건너뜀' : '미방문');
  return `${p.day ? p.day + ' · ' : ''}${p.cat || '기준 없음'} · 직선 ${d} · ${state} · 진행 ${done}/${vis().length} · 기록 ${recN}`;
}
function updateCardDistance() {
  const el = $('#cardSub'); const p = S.planBySeq.get(S.currentSeq); if (!el || !p) return;
  const st = S.status[p.seq] || {}; const done = vis().filter(x => (S.status[x.seq] || {}).visited).length;
  el.textContent = subLine(p, st, done, S.records.filter(r => r.seq === p.seq).length);
}
function renderAppRow() {
  const row = $('#appRow'); if (!row) return; row.innerHTML = '';
  const role = S.settings.role; const p = S.planBySeq.get(S.currentSeq); if (!p) return;
  const apps = role === 'all' ? NAV_APPS : [role];
  row.classList.toggle('single', apps.length === 1);
  const firstUnopened = apps.find(a => !S.opened[a]);
  apps.forEach((a, i) => {
    const label = role === 'all' ? `${'①②③'[i]} ${APPS[a].label}` : `${APPS[a].label} 다시 열기`;
    const cls = 'b' + (S.opened[a] ? ' done' : (a === firstUnopened && role === 'all' ? ' next' : ''));
    const url = linkFor(a, p);
    if ((a === 'balady' || a === 'google' || (a === 'hudhud' && S.settings.hudhudMode === 'custom')) && url) {
      row.append(h('a', { class: cls, href: url, 'data-app': a, rel: 'noopener', onclick: () => openApp(a, true) }, label));
    } else {
      row.append(h('button', { class: cls, 'data-app': a, onclick: () => openApp(a) }, label));
    }
  });
}
function updateAppLinks() {
  const p = S.planBySeq.get(S.currentSeq); if (!p) return;
  document.querySelectorAll('#appRow a[data-app]').forEach(a => { const u = linkFor(a.dataset.app, p); if (u) a.href = u; });
}

/* ---------- sheet ---------- */
let sheetOnClose = null;
function openSheet(title, body, foot, onClose) {
  $('#sheetTitle').textContent = title;
  const b = $('#sheetBody'); b.innerHTML = ''; b.append(body); b.scrollTop = 0;
  const f = $('#sheetFoot'); f.innerHTML = ''; (foot || []).forEach(x => f.append(x));
  sheetOnClose = onClose || null; $('#sheetWrap').hidden = false;
}
async function closeSheet(force) {
  if (!force && sheetOnClose) { const ok = await sheetOnClose(); if (ok === false) return; }
  sheetOnClose = null; $('#sheetWrap').hidden = true; $('#sheetBody').innerHTML = '';
}

/* ---------- image ---------- */
function loadImgEl(file) {
  return new Promise((res, rej) => { const u = URL.createObjectURL(file); const im = new Image(); im.onload = () => { res(im); }; im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('이미지를 읽지 못함')); }; im.src = u; });
}
async function compressImage(file) {
  let src;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { src = await loadImgEl(file); }
  const w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight; const sc = Math.min(1, 2560 / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * sc)), hh = Math.max(1, Math.round(h0 * sc));
  const c = document.createElement('canvas'); c.width = w; c.height = hh; c.getContext('2d').drawImage(src, 0, 0, w, hh);
  if (src.close) src.close();
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
  if (!blob) throw new Error('이미지 변환 실패');
  return { blob, w, h: hh };
}

/* ---------- record editor ---------- */
function defaultTag() { const r = S.settings.role; return NAV_APPS.includes(r) ? r : 'field'; }
function nextNo() { return S.records.reduce((m, r) => Math.max(m, r.no || 0), 0) + 1; }
async function openRecord(recId, seq) {
  let rec = recId ? S.records.find(r => r.id === recId) : null; const isNew = !rec;
  if (isNew) {
    const p = seq != null ? S.planBySeq.get(seq) : null;
    rec = { id: uid('r_'), no: nextNo(), createdAt: nowIso(), updatedAt: nowIso(), author: S.settings.author, role: S.settings.role, deviceId: S.deviceId,
      seq: p ? p.seq : null, planName: p ? p.name : '', lat: null, lng: null, acc: null, posSource: '', cats: [], cmp: { balady: '', google: '', hudhud: '' },
      urgent: false, memo: '', media: [] };
    if (S.gps) Object.assign(rec, { lat: +S.gps.lat.toFixed(6), lng: +S.gps.lng.toFixed(6), acc: Math.round(S.gps.acc), posSource: 'gps' });
    else if (p) Object.assign(rec, { lat: p.lat, lng: p.lng, acc: null, posSource: 'plan' });
  } else rec = JSON.parse(JSON.stringify(rec));
  const existingMedia = isNew ? [] : (await Promise.all((rec.media || []).map(id => DB.get('media', id)))).filter(Boolean);
  const pending = []; const removed = new Set(); let dirty = false; let tagNext = defaultTag();
  const urls = [];
  const body = h('div');
  const posEl = h('div', { class: 'pos' });
  const renderPos = () => { posEl.textContent = rec.lat != null ? `위치 ${rec.lat.toFixed(5)}, ${rec.lng.toFixed(5)} · ${rec.posSource === 'gps' ? `GPS ±${rec.acc}m` : (rec.posSource === 'plan' ? '목적지 좌표' : rec.posSource)}` : '위치 없음'; };
  renderPos();
  const target = rec.seq != null ? `P${pad(rec.seq, 3)} ${rec.planName}` : '자유 기록 (목적지 없음)';
  body.append(h('div', { class: 'sec' }, h('div', { class: 'lbl' }, `#${rec.no} · ${target}`), posEl,
    h('div', { class: 'grid2' },
      h('button', { class: 'b small', onclick: () => { if (!S.gps) return toast('GPS 위치가 아직 없습니다'); Object.assign(rec, { lat: +S.gps.lat.toFixed(6), lng: +S.gps.lng.toFixed(6), acc: Math.round(S.gps.acc), posSource: 'gps' }); dirty = true; renderPos(); } }, 'GPS 다시 잡기'),
      h('button', { class: 'b small', disabled: rec.seq == null, onclick: () => { const p = S.planBySeq.get(rec.seq); if (!p) return; Object.assign(rec, { lat: p.lat, lng: p.lng, acc: null, posSource: 'plan' }); dirty = true; renderPos(); } }, '목적지 좌표로'))));
  // categories
  const chips = h('div', { class: 'chips' });
  CATS.forEach(c => chips.append(h('button', { class: 'chip', 'aria-pressed': rec.cats.includes(c), onclick: e => {
    const on = !rec.cats.includes(c); rec.cats = on ? [...rec.cats, c] : rec.cats.filter(x => x !== c); e.currentTarget.setAttribute('aria-pressed', on); dirty = true; } }, c)));
  body.append(h('div', { class: 'sec' }, h('div', { class: 'lbl' }, '차이점 유형 (여러 개)'), chips));
  // compare
  const cmpBox = h('div', { class: 'sec' }, h('div', { class: 'lbl' }, '세 앱 비교'));
  NAV_APPS.forEach(a => {
    const seg = h('div', { class: 'seg' }, h('div', { class: 'who' }, APPS[a].label));
    Object.entries(VERDICT).forEach(([k, lab]) => seg.append(h('button', { class: `v-${k}`, 'aria-pressed': rec.cmp[a] === k, onclick: e => {
      rec.cmp[a] = rec.cmp[a] === k ? '' : k; seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.textContent.replace('● ', '') === VERDICT[rec.cmp[a]])); dirty = true; } }, lab)));
    cmpBox.append(seg);
  });
  body.append(cmpBox);
  const urgent = h('input', { type: 'checkbox' }); urgent.checked = !!rec.urgent; urgent.onchange = () => { rec.urgent = urgent.checked; dirty = true; };
  body.append(h('div', { class: 'sec' }, h('label', { class: 'toggle' }, urgent, '선조치 필요')));
  const memo = h('textarea', { placeholder: '메모 (무엇이 리야드와 다른지, 어느 앱이 어떻게 틀렸는지)' }); memo.value = rec.memo || ''; memo.oninput = () => { rec.memo = memo.value; dirty = true; };
  body.append(h('div', { class: 'sec' }, h('div', { class: 'lbl' }, '메모'), memo));
  // media
  const tagSeg = h('div', { class: 'grid4' });
  const renderTagSeg = () => { tagSeg.innerHTML = ''; Object.keys(APPS).forEach(k => tagSeg.append(h('button', { class: 'chip', 'aria-pressed': tagNext === k, onclick: () => { tagNext = k; renderTagSeg(); } }, APPS[k].label))); };
  renderTagSeg();
  const thumbs = h('div', { class: 'thumbs' });
  const recBtn = h('button', { class: 'b small' }, '● 음성 메모');
  const renderThumbs = () => {
    thumbs.innerHTML = '';
    const all = [...existingMedia.filter(m => !removed.has(m.id)).map(m => ({ m, old: true })), ...pending.map(m => ({ m, old: false }))];
    if (!all.length) thumbs.append(h('div', { class: 'muted' }, '붙인 사진 · 캡처 · 음성이 없습니다'));
    all.forEach(({ m, old }) => {
      const u = URL.createObjectURL(m.blob); urls.push(u);
      const tagBtn = h('button', { class: 'tag', onclick: () => { const ks = Object.keys(APPS); m.app = ks[(ks.indexOf(m.app) + 1) % ks.length]; if (old) m._dirty = true; dirty = true; renderThumbs(); } }, `${APPS[m.app].label} ⇄`);
      const x = h('button', { class: 'x', 'aria-label': '삭제', onclick: () => { if (old) removed.add(m.id); else pending.splice(pending.indexOf(m), 1); dirty = true; renderThumbs(); } }, '✕');
      if (m.kind === 'audio') thumbs.append(h('div', { class: 'thumb audio' }, h('div', null, '🎙 음성', h('br'), hhmmss(m.createdAt).replace(/(\d\d)(\d\d)(\d\d)/, '$1:$2:$3'), h('br'), h('audio', { controls: true, src: u, style: 'width:100%' })), x));
      else thumbs.append(h('div', { class: 'thumb' }, h('img', { src: u, alt: '' }), tagBtn, x));
    });
  };
  const addFiles = async files => {
    let n = 0;
    for (const f of files) {
      try { const { blob, w, h: hh } = await compressImage(f);
        pending.push({ id: uid('m_'), recordId: rec.id, kind: 'photo', app: tagNext, type: 'image/jpeg', blob, w, h: hh, createdAt: nowIso(), origName: f.name || '', origLastModified: f.lastModified ? new Date(f.lastModified).toISOString() : '' }); n++;
      } catch (e) { toast(`사진 하나를 못 읽었습니다 : ${e.message}`); }
    }
    if (n) { dirty = true; renderThumbs(); logVisit('capture', { seq: rec.seq, app: tagNext, n }); toast(`${APPS[tagNext].label} 사진 ${n}장 붙임`); }
  };
  const pick = (inputSel) => { const inp = $(inputSel); inp.value = ''; inp.onchange = () => addFiles([...inp.files]); inp.click(); };
  let mr = null, chunks = [], mrStream = null, mrStart = 0, mrTimer = null;
  recBtn.onclick = async () => {
    if (mr && mr.state === 'recording') { mr.stop(); return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) return toast('이 기기는 음성 녹음을 지원하지 않습니다');
    try {
      mrStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '';
      mr = new MediaRecorder(mrStream, type ? { mimeType: type } : undefined); chunks = [];
      mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      mr.onstop = () => {
        clearInterval(mrTimer); mrStream.getTracks().forEach(t => t.stop());
        const t = mr.mimeType || type || 'audio/webm'; const blob = new Blob(chunks, { type: t });
        pending.push({ id: uid('m_'), recordId: rec.id, kind: 'audio', app: 'field', type: t, blob, createdAt: new Date(mrStart).toISOString(), durationSec: Math.round((Date.now() - mrStart) / 1000) });
        dirty = true; recBtn.textContent = '● 음성 메모'; renderThumbs(); toast('음성 메모 붙임');
      };
      mrStart = Date.now(); mr.start(1000);
      mrTimer = setInterval(() => { recBtn.textContent = `■ 녹음 중 ${Math.round((Date.now() - mrStart) / 1000)}초 · 끝내기`; }, 500);
      recBtn.textContent = '■ 녹음 중 · 끝내기';
    } catch (e) { toast('마이크를 쓸 수 없습니다'); }
  };
  body.append(h('div', { class: 'sec' }, h('div', { class: 'lbl' }, '사진 · 캡처 (다음에 붙일 앱 태그)'), tagSeg,
    h('div', { class: 'grid2', style: 'margin-top:6px' },
      h('button', { class: 'b small', onclick: () => pick('#filePick') }, '앨범에서 (캡처)'),
      h('button', { class: 'b small', onclick: () => pick('#fileCam') }, '촬영')),
    h('div', { style: 'margin-top:6px' }, recBtn), thumbs));
  renderThumbs();

  const save = async () => {
    if (mr && mr.state === 'recording') { toast('녹음을 먼저 끝내세요'); return; }
    rec.updatedAt = nowIso(); rec.author = rec.author || S.settings.author;
    if (pending.length) await DB.putMany('media', pending);
    for (const m of existingMedia) { if (m._dirty && !removed.has(m.id)) { delete m._dirty; await DB.put('media', m); } }
    for (const id of removed) await DB.del('media', id);
    rec.media = [...existingMedia.filter(m => !removed.has(m.id)).map(m => m.id), ...pending.map(m => m.id)];
    await DB.put('records', rec);
    const i = S.records.findIndex(r => r.id === rec.id); if (i >= 0) S.records[i] = rec; else S.records.push(rec);
    if (isNew) logVisit('record', { seq: rec.seq, recordId: rec.id });
    persistOnce(); renderRecords(); renderCard(); urls.forEach(u => URL.revokeObjectURL(u));
    await closeSheet(true); toast(`기록 #${rec.no} 저장`);
  };
  const del = async () => {
    if (!confirm(`기록 #${rec.no} 와 붙인 파일을 지울까요?`)) return;
    for (const m of existingMedia) await DB.del('media', m.id);
    await DB.del('records', rec.id); S.records = S.records.filter(r => r.id !== rec.id);
    renderRecords(); renderCard(); await closeSheet(true); toast('지웠습니다');
  };
  const foot = [h('button', { class: 'b primary', onclick: save }, '저장')];
  if (!isNew) foot.unshift(h('button', { class: 'b danger', onclick: del }, '삭제'));
  openSheet(isNew ? '새 기록' : `기록 #${rec.no}`, body, foot, async () => {
    if ((dirty || pending.length) && !confirm('저장하지 않고 닫을까요?')) return false;
    if (mr && mr.state === 'recording') mr.stop();
    urls.forEach(u => URL.revokeObjectURL(u)); return true;
  });
}

/* quick capture : 현재 목적지 기록에 캡처만 바로 붙이기 */
function quickCapture() {
  const p = S.planBySeq.get(S.currentSeq); if (!p) return;
  const run = tag => {
    closeSheet(true);
    const inp = $('#filePick'); inp.value = '';
    inp.onchange = async () => {
      const files = [...inp.files]; if (!files.length) return;
      let rec = [...S.records].reverse().find(r => r.seq === p.seq && r.author === S.settings.author && Date.now() - new Date(r.createdAt) < 30 * 60 * 1000);
      const isNew = !rec;
      if (isNew) {
        rec = { id: uid('r_'), no: nextNo(), createdAt: nowIso(), updatedAt: nowIso(), author: S.settings.author, role: S.settings.role, deviceId: S.deviceId,
          seq: p.seq, planName: p.name, lat: S.gps ? +S.gps.lat.toFixed(6) : p.lat, lng: S.gps ? +S.gps.lng.toFixed(6) : p.lng, acc: S.gps ? Math.round(S.gps.acc) : null,
          posSource: S.gps ? 'gps' : 'plan', cats: [], cmp: { balady: '', google: '', hudhud: '' }, urgent: false, memo: '', media: [] };
      }
      const add = [];
      for (const f of files) { try { const { blob, w, h: hh } = await compressImage(f); add.push({ id: uid('m_'), recordId: rec.id, kind: 'photo', app: tag, type: 'image/jpeg', blob, w, h: hh, createdAt: nowIso(), origName: f.name || '', origLastModified: f.lastModified ? new Date(f.lastModified).toISOString() : '' }); } catch (e) { } }
      if (!add.length) return toast('사진을 읽지 못했습니다');
      await DB.putMany('media', add); rec.media = [...(rec.media || []), ...add.map(m => m.id)]; rec.updatedAt = nowIso();
      await DB.put('records', rec); if (isNew) S.records.push(rec);
      logVisit('capture', { seq: p.seq, app: tag, n: add.length, recordId: rec.id }); persistOnce();
      renderRecords(); renderCard(); toast(`P${pad(p.seq, 3)} 기록 #${rec.no} 에 ${APPS[tag].label} 캡처 ${add.length}장`);
    };
    inp.click();
  };
  if (S.settings.role !== 'all') return run(S.settings.role);
  const body = h('div', null, h('div', { class: 'muted', style: 'margin-bottom:8px' }, `P${pad(p.seq, 3)} ${p.name} 에 붙일 캡처의 앱을 고르세요`),
    h('div', { class: 'grid2' }, ...Object.keys(APPS).map(k => h('button', { class: 'b', onclick: () => run(k) }, APPS[k].label))));
  openSheet('캡처 붙이기', body, []);
}
let persisted = false;
async function persistOnce() { if (persisted) return; persisted = true; try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { } }

/* ---------- list ---------- */
function openList(tab) {
  tab = tab === 'rec' ? 'rec' : 'plan';
  const body = h('div');
  const tabs = h('div', { class: 'tabs' },
    h('button', { 'aria-pressed': tab === 'plan', onclick: () => openList('plan') }, `가볼 곳 ${S.plan.length}`),
    h('button', { 'aria-pressed': tab === 'rec', onclick: () => openList('rec') }, `기록 ${S.records.length}`));
  body.append(tabs);
  const list = h('div', { class: 'list' });
  if (tab === 'plan') {
    if (!S.plan.length) list.append(h('div', { class: 'muted' }, '패키지를 먼저 불러오세요'));
    if (days().length) list.append(h('div', { class: 'grid2' }, h('div', { class: 'muted', style: 'align-self:center' }, '일자 필터'), (() => { const sl = daySelect(); sl.addEventListener('change', () => setTimeout(() => openList('plan'), 0)); return sl; })()));
    let lastDay = null;
    for (const p of vis()) {
      if (p.day && p.day !== lastDay) { lastDay = p.day; const L = S.plan.filter(x => x.day === p.day); const dn = L.filter(x => (S.status[x.seq] || {}).visited).length;
        list.append(h('div', { class: 'lbl', style: 'font-weight:900;margin-top:8px' }, `${p.day} · ${dn}/${L.length} 방문`)); }
      const st = S.status[p.seq] || {}; const d = S.gps ? fmtKm(km(S.gps, p)) : '';
      const state = st.visited ? `✓ 방문 ${hm(st.visitedAt)}` : (st.skipped ? '– 건너뜀' : '미방문');
      list.append(h('div', { class: 'item' + (p.seq === S.currentSeq ? ' cur' : '') },
        h('div', { class: 't' }, `P${pad(p.seq, 3)} ${p.name}`),
        h('button', { class: 'b small', onclick: () => { closeSheet(true); goTo(p.seq, true); } }, '여기로 ▶'),
        h('div', { class: 's' }, [p.cat, p.priority && `우선 ${p.priority}`, state, d].filter(Boolean).join(' · '))));
    }
  } else {
    const recs = [...S.records].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (!recs.length) list.append(h('div', { class: 'muted' }, '아직 기록이 없습니다'));
    for (const r of recs) {
      const cmp = NAV_APPS.filter(a => r.cmp && r.cmp[a]).map(a => `${APPS[a].label} ${VERDICT[r.cmp[a]]}`).join(' / ');
      list.append(h('div', { class: 'item' },
        h('div', { class: 't' }, `${r.urgent ? '! ' : ''}#${r.no} ${r.seq != null ? 'P' + pad(r.seq, 3) + ' ' + r.planName : '자유 기록'}`),
        h('button', { class: 'b small', onclick: () => { closeSheet(true); openRecord(r.id); } }, '열기'),
        h('div', { class: 's' }, [hm(r.createdAt), r.cats.join(', '), cmp, `파일 ${r.media.length}`].filter(Boolean).join(' · '))));
    }
  }
  body.append(list);
  openSheet('목록', body, []);
}

/* ---------- export ---------- */
async function unexportedCount() {
  const since = S.lastExportAt || '';
  const recs = S.records.filter(r => r.updatedAt > since).length;
  return recs;
}
function csvCell(v) { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
async function buildZip(onProgress) {
  const zip = new JSZip();
  const recs = (await DB.all('records')).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const mediaAll = await DB.all('media'); const mById = new Map(mediaAll.map(m => [m.id, m]));
  const visits = await DB.all('visits'); const tracks = await DB.all('tracks');
  if (S.tracking && S.track && S.track.pts.length) { const i = tracks.findIndex(t => t.id === S.track.id); if (i >= 0) tracks[i] = S.track; else tracks.push(S.track); }
  const counters = {}; const feats = []; const rows = [];
  const header = ['no', 'id', 'createdAt', 'author', 'role', 'seq', 'planName', 'lat', 'lng', 'acc', 'posSource', 'cats', 'balady', 'google', 'hudhud', 'urgent', 'memo', 'media_count', 'media_files'];
  let done = 0; const total = recs.reduce((s, r) => s + (r.media || []).length, 0);
  for (const r of recs) {
    const mediaOut = [];
    for (const id of (r.media || [])) {
      const m = mById.get(id); if (!m) continue;
      const sk = r.seq != null ? pad(r.seq, 3) : '000'; counters[sk] = (counters[sk] || 0) + 1;
      const ext = m.kind === 'audio' ? (/mp4|m4a|aac/.test(m.type) ? 'm4a' : 'webm') : 'jpg';
      const file = `media/P${sk}_${APPS[m.app] ? APPS[m.app].file : m.app}_${hhmmss(m.createdAt)}_${counters[sk]}.${ext}`;
      zip.file(file, m.blob);
      mediaOut.push({ file, app: m.app, kind: m.kind, t: m.createdAt, origName: m.origName || '', origLastModified: m.origLastModified || '', w: m.w || null, h: m.h || null, durationSec: m.durationSec || null });
      done++; if (onProgress) onProgress(done, total);
    }
    const props = { ...r, media: mediaOut, cats: r.cats, cmp: r.cmp };
    feats.push({ type: 'Feature', geometry: r.lat != null ? { type: 'Point', coordinates: [r.lng, r.lat] } : null, properties: props });
    rows.push([r.no, r.id, r.createdAt, r.author, r.role, r.seq ?? '', r.planName, r.lat, r.lng, r.acc, r.posSource, r.cats.join(' | '),
      VERDICT[r.cmp.balady] || '', VERDICT[r.cmp.google] || '', VERDICT[r.cmp.hudhud] || '', r.urgent ? 'Y' : '', r.memo, mediaOut.length, mediaOut.map(m => m.file).join(' | ')]);
  }
  zip.file('records.geojson', JSON.stringify({ type: 'FeatureCollection', features: feats }, null, 1));
  zip.file('records.csv', '﻿' + [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n'));
  zip.file('visits.json', JSON.stringify(visits.sort((a, b) => a.t.localeCompare(b.t)), null, 1));
  zip.file('tracks.geojson', JSON.stringify({ type: 'FeatureCollection', features: tracks.filter(t => t.pts.length).map(t => ({
    type: 'Feature', geometry: { type: 'LineString', coordinates: t.pts.map(p => [p[0], p[1]]) },
    properties: { id: t.id, startedAt: t.startedAt, endedAt: t.endedAt, points: t.pts.length, times: t.pts.map(p => p[2]) } })) }));
  zip.file('plan_status.json', JSON.stringify({ pack: S.pack ? { name: S.pack.name, version: S.pack.version, count: S.plan.length } : null, currentSeq: S.currentSeq, status: S.status }, null, 1));
  const meta = { app: 'jeddah-survey', version: APP_VERSION, exportedAt: nowIso(), tzOffsetMin: -new Date().getTimezoneOffset(), author: S.settings.author, role: S.settings.role,
    deviceId: S.deviceId, ua: navigator.userAgent, counts: { records: recs.length, media: done, visits: visits.length, tracks: tracks.length } };
  zip.file('meta.json', JSON.stringify(meta, null, 1));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  const who = (S.settings.author || APPS[S.settings.role]?.label || '전체').replace(/[^\w가-힣+.-]/g, '');
  return { blob, name: `jeddah_survey_${who}_${S.settings.role}_${localStamp()}.zip`, meta };
}
function downloadBlob(blob, name) {
  const u = URL.createObjectURL(blob); const a = h('a', { href: u, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 60000);
}
async function openExport() {
  const body = h('div');
  const [mN, vN, tN] = await Promise.all([DB.count('media'), DB.count('visits'), DB.count('tracks')]);
  const un = await unexportedCount();
  let est = '';
  try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); est = `${(e.usage / 1048576).toFixed(1)} MB 사용`; } } catch (e) { }
  body.append(h('div', { class: 'kv' },
    h('b', null, '기록'), h('span', null, `${S.records.length}건 (마지막 내보내기 뒤 바뀐 것 ${un}건)`),
    h('b', null, '파일'), h('span', null, `${mN}개`), h('b', null, '방문 로그'), h('span', null, `${vN}건`), h('b', null, '궤적'), h('span', null, `${tN}개`),
    h('b', null, '마지막 내보내기'), h('span', null, S.lastExportAt ? new Date(S.lastExportAt).toLocaleString('ko-KR') : '없음'),
    h('b', null, '저장 공간'), h('span', null, est || '알 수 없음')),
    h('p', { class: 'muted' }, '내보내기는 이 기기의 전체 기록을 ZIP 하나로 묶습니다. 매일 저녁 내보내 웍스 · 에어드롭으로 맥에 모으세요. 내보내도 기기에서 지워지지 않습니다.'));
  const status = h('div', { class: 'muted' });
  const shareBtn = h('button', { class: 'b primary', disabled: true }, '공유 시트로 보내기');
  const saveBtn = h('button', { class: 'b', disabled: true }, '파일로 저장');
  const makeBtn = h('button', { class: 'b big' }, 'ZIP 만들기');
  makeBtn.onclick = async () => {
    makeBtn.disabled = true; status.textContent = 'ZIP 만드는 중…';
    try {
      const z = await buildZip((d, t) => { status.textContent = `ZIP 만드는 중… 파일 ${d}/${t}`; });
      S.lastZip = z; status.textContent = `준비됨 : ${z.name} (${(z.blob.size / 1048576).toFixed(1)} MB)`;
      shareBtn.disabled = false; saveBtn.disabled = false;
    } catch (e) { status.textContent = `실패 : ${e.message}`; makeBtn.disabled = false; }
  };
  const markExported = async () => { S.lastExportAt = nowIso(); await kvSet('lastExportAt', S.lastExportAt); };
  shareBtn.onclick = async () => {
    const z = S.lastZip; if (!z) return;
    const file = new File([z.blob], z.name, { type: 'application/zip' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: z.name }); await markExported(); toast('보냈습니다'); }
      catch (e) { if (e.name !== 'AbortError') { toast('공유 실패 · 파일로 저장을 쓰세요'); } }
    } else { downloadBlob(z.blob, z.name); await markExported(); toast('공유 미지원 · 파일로 저장했습니다'); }
  };
  saveBtn.onclick = async () => { const z = S.lastZip; if (!z) return; downloadBlob(z.blob, z.name); await markExported(); toast('저장했습니다'); };
  body.append(h('div', { class: 'list', style: 'margin-top:10px' }, makeBtn, status, h('div', { class: 'grid2' }, shareBtn, saveBtn)));
  openSheet('내보내기', body, []);
}

/* ---------- settings ---------- */
function radioGroup(name, options, value, onChange) {
  const box = h('div', { class: 'list' });
  for (const [k, lab] of Object.entries(options)) {
    const inp = h('input', { type: 'radio', name, value: k }); inp.checked = k === value; inp.onchange = () => onChange(k);
    box.append(h('label', { class: 'toggle' }, inp, lab));
  }
  return box;
}
async function saveSettings() { await kvSet('settings', S.settings); renderCard(); updateAppLinks(); }
function openMenu() {
  const s = S.settings; const body = h('div');
  const author = h('input', { type: 'text', placeholder: '예 : 홍길동' }); author.value = s.author; author.onchange = () => { s.author = author.value.trim(); saveSettings(); };
  body.append(h('div', { class: 'sec' }, h('div', { class: 'lbl' }, '기록자 이름'), author));
  body.append(h('div', { class: 'sec' }, h('div', { class: 'lbl' }, '이 기기 역할 (「다음 ▶」 때 열 앱)'),
    radioGroup('role', { all: '전체 · 세 앱 차례로 (①Balady+ ②구글 ③HudHud)', balady: 'Balady+ 전용', google: '구글 전용', hudhud: 'HudHud 전용' }, s.role, k => { s.role = k; saveSettings(); })));
  body.append(h('div', { class: 'sec' }, h('div', { class: 'lbl' }, '지도 배경'),
    radioGroup('basemap', { osm: 'OSM 지도', sat: '위성 (Esri)' }, s.basemap, k => { s.basemap = k; setBasemap(k); saveSettings(); })));
  // Balady+
  const bSel = h('select'); Object.entries(BALADY_PRESETS).forEach(([k, v]) => bSel.append(h('option', { value: k, selected: s.baladyPreset === k }, v.label)));
  const bCustom = h('textarea', { placeholder: '{lat} {lng} {name} {slat} {slng} {sname}' }); bCustom.value = s.baladyCustom || BALADY_PRESETS.default.tpl;
  const bPrev = h('div', { class: 'muted', style: 'word-break:break-all' });
  const bRefresh = () => { bCustom.hidden = s.baladyPreset !== 'custom'; const p = S.planBySeq.get(S.currentSeq) || { seq: 1, name: '예시', lat: 21.5, lng: 39.17 }; bPrev.textContent = '미리보기 : ' + fillTpl(baladyTpl(), p); };
  bSel.onchange = () => { s.baladyPreset = bSel.value; bRefresh(); saveSettings(); };
  bCustom.onchange = () => { s.baladyCustom = bCustom.value.trim(); bRefresh(); saveSettings(); };
  bRefresh();
  body.append(h('div', { class: 'sec' }, h('div', { class: 'lbl' }, 'Balady+ 길안내 링크'), bSel, bCustom, bPrev,
    h('div', { class: 'muted' }, '출발지는 현재 GPS 를 넣습니다. GPS 가 없으면 출발지를 빼고 보내 길찾기 홈으로 열립니다.')));
  // Google
  const gSel = h('select'); Object.entries(GOOGLE_PRESETS).forEach(([k, v]) => gSel.append(h('option', { value: k, selected: s.googlePreset === k }, v.label)));
  const gCustom = h('textarea'); gCustom.value = s.googleCustom || GOOGLE_PRESETS.web.tpl;
  const gPrev = h('div', { class: 'muted', style: 'word-break:break-all' });
  const gRefresh = () => { gCustom.hidden = s.googlePreset !== 'custom'; const p = S.planBySeq.get(S.currentSeq) || { seq: 1, name: '예시', lat: 21.5, lng: 39.17 }; gPrev.textContent = '미리보기 : ' + fillTpl(googleTpl(), p); };
  gSel.onchange = () => { s.googlePreset = gSel.value; gRefresh(); saveSettings(); };
  gCustom.onchange = () => { s.googleCustom = gCustom.value.trim(); gRefresh(); saveSettings(); };
  gRefresh();
  body.append(h('div', { class: 'sec' }, h('div', { class: 'lbl' }, '구글 지도 길안내 링크'), gSel, gCustom, gPrev));
  // HudHud
  const hCustom = h('textarea'); hCustom.value = s.hudhudCustom; hCustom.hidden = s.hudhudMode !== 'custom';
  hCustom.onchange = () => { s.hudhudCustom = hCustom.value.trim(); saveSettings(); };
  body.append(h('div', { class: 'sec' }, h('div', { class: 'lbl' }, 'HudHud 여는 방식'),
    radioGroup('hudhud', HUDHUD_MODES, s.hudhudMode, k => { s.hudhudMode = k; hCustom.hidden = k !== 'custom'; saveSettings(); }), hCustom));
  // pack & data
  body.append(h('div', { class: 'sec' }, h('div', { class: 'lbl' }, '실사 패키지'),
    h('div', { class: 'muted' }, S.pack ? `${S.pack.name} · ${S.pack.version} · 지점 ${S.plan.length} · 메시 ${S.pack.range ? S.pack.range.features.length : 0}` : '불러온 패키지 없음'),
    h('div', { class: 'grid2', style: 'margin-top:6px' },
      h('button', { class: 'b small', onclick: () => { closeSheet(true); pickPack(); } }, '패키지 불러오기'),
      h('button', { class: 'b small', onclick: () => { closeSheet(true); openExport(); } }, '내보내기'))));
  body.append(h('div', { class: 'sec' }, h('div', { class: 'lbl' }, '데이터'),
    h('button', { class: 'b small danger', onclick: async () => {
      if (!confirm('이 기기의 기록 · 사진 · 로그를 모두 지웁니다. 내보내기를 먼저 했나요?')) return;
      if (prompt('지우려면 「지우기」 라고 입력') !== '지우기') return;
      await DB.clearAll(); location.reload();
    } }, '이 기기 데이터 모두 지우기'),
    h('div', { class: 'muted', style: 'margin-top:8px' }, `앱 ${APP_VERSION} · 기기 ${S.deviceId} · 데이터는 이 기기에만 저장됩니다`)));
  openSheet('설정', body, []);
}

/* ---------- boot ---------- */
async function boot() {
  await DB.open();
  S.settings = { ...DEFAULT_SETTINGS, ...(await kvGet('settings') || {}) };
  S.deviceId = await kvGet('deviceId'); if (!S.deviceId) { S.deviceId = uid('d_'); await kvSet('deviceId', S.deviceId); }
  S.status = (await kvGet('status')) || {}; S.currentSeq = await kvGet('currentSeq'); S.lastExportAt = await kvGet('lastExportAt');
  S.dayFilter = (await kvGet('dayFilter')) || null;
  S.records = await DB.all('records');
  initMap();
  const pack = await kvGet('pack');
  if (pack) { await installPack(pack, true); if (!S.dayFilter) await setDayFilter(autoDay()); } else renderCard();
  renderRecords();
  if (S.currentSeq != null) logVisit('boot', { seq: S.currentSeq });
  startGPS();
  $('#btnFollow').onclick = () => setFollow(!S.follow);
  $('#btnTrack').onclick = toggleTrack;
  $('#btnMenu').onclick = openMenu;
  $('#sheetClose').onclick = () => closeSheet();
  $('#sheetWrap').addEventListener('click', e => { if (e.target.id === 'sheetWrap') closeSheet(); });
  $('#filePack').onchange = async () => {
    const f = $('#filePack').files[0]; if (!f) return;
    try { const obj = JSON.parse(await f.text()); await installPack(parsePack(obj)); } catch (e) { toast(`패키지를 못 읽었습니다 : ${e.message}`, 4000); }
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.tracking) requestWake(); });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => { const w = reg.installing; if (!w) return; w.addEventListener('statechange', () => { if (w.state === 'activated' && hadController) $('#updBar').hidden = false; }); });
    }).catch(e => console.warn('sw', e));
    $('#updReload').onclick = () => location.reload();
  }
  if (DEMO && !pack) {
    try { const r = await fetch(`data/${QS.get('pack') || 'sample_pack.json'}`, { cache: 'no-store' }); if (r.ok) { await installPack(parsePack(await r.json()), true); await setDayFilter(QS.get('day') || autoDay()); } } catch (e) { console.warn('demo pack', e); }
  }
  if (DEMO) {
    const sh = QS.get('sheet');
    if (sh === 'record') setTimeout(() => openRecord(null, S.currentSeq), 300);
    if (sh === 'menu') setTimeout(openMenu, 300);
    if (sh === 'list') setTimeout(() => openList('plan'), 300);
    if (sh === 'export') setTimeout(openExport, 300);
  }
}
boot().catch(e => { console.error(e); document.body.prepend(h('div', { style: 'background:#ff6b6b;color:#111;padding:10px;font-weight:800' }, `시작 실패 : ${e.message}`)); });

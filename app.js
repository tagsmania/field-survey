'use strict';
/* 현장 실사 PWA · 데이터는 이 기기 IndexedDB 에만 저장하고 서버로 보내지 않음 */
const APP_VERSION = '0.3.9';
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
  db: null, opening: null,
  open() {
    if (DB.opening) return DB.opening;
    DB.opening = new Promise((res, rej) => {
      const r = indexedDB.open('jeddah-survey', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('kv');
        d.createObjectStore('records', { keyPath: 'id' });
        const m = d.createObjectStore('media', { keyPath: 'id' }); m.createIndex('recordId', 'recordId');
        d.createObjectStore('visits', { keyPath: 'id', autoIncrement: true });
        d.createObjectStore('tracks', { keyPath: 'id' });
      };
      r.onsuccess = () => {
        const d = r.result;
        d.onclose = () => { if (DB.db === d) DB.db = null; };
        d.onversionchange = () => { try { d.close(); } catch (e) { } if (DB.db === d) DB.db = null; };
        DB.db = d; DB.opening = null; res(d);
      };
      r.onerror = () => { DB.opening = null; rej(r.error); };
      r.onblocked = () => console.warn('idb blocked');
    });
    return DB.opening;
  },
  done(t) { return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('abort')); }); },
  req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  // 아이폰 Safari 는 백그라운드(파일 고르기 · 화면 잠금)에서 연결을 닫음 → 닫혔으면 다시 열고 재시도
  async run(stores, mode, fn) {
    let last;
    for (let i = 0; i < 3; i++) {
      try {
        if (!DB.db) await DB.open();
        const t = DB.db.transaction(stores, mode);
        const r = fn(t);
        if (mode === 'readwrite') { await DB.done(t); return r && r.result; }
        return await DB.req(r);
      } catch (e) {
        last = e;
        const msg = `${e && e.name} ${e && e.message}`;
        if (/closing|closed|InvalidState|connection|abort|UnknownError/i.test(msg)) {
          try { if (DB.db) DB.db.close(); } catch (x) { }
          DB.db = null; await new Promise(r => setTimeout(r, 120 * (i + 1))); continue;
        }
        throw e;
      }
    }
    throw last;
  },
  get(store, key) { return DB.run(store, 'readonly', t => t.objectStore(store).get(key)); },
  all(store) { return DB.run(store, 'readonly', t => t.objectStore(store).getAll()); },
  put(store, val, key) { return DB.run(store, 'readwrite', t => { const s = t.objectStore(store); return key === undefined ? s.put(val) : s.put(val, key); }); },
  putMany(store, vals) { return DB.run(store, 'readwrite', t => { const s = t.objectStore(store); vals.forEach(v => s.put(v)); }); },
  del(store, key) { return DB.run(store, 'readwrite', t => { t.objectStore(store).delete(key); }); },
  clearAll() { const names = ['kv', 'records', 'media', 'visits', 'tracks']; return DB.run(names, 'readwrite', t => { names.forEach(n => t.objectStore(n).clear()); }); },
  count(store) { return DB.run(store, 'readonly', t => t.objectStore(store).count()); },
};
const kvGet = k => DB.get('kv', k);
const kvSet = (k, v) => DB.put('kv', v, k);

/* ---------- state ---------- */
const S = {
  settings: { ...DEFAULT_SETTINGS }, pack: null, plan: [], planBySeq: new Map(), status: {}, currentSeq: null,
  records: [], gps: null, follow: true, tracking: false, track: null, wakeLock: null, deviceId: null,
  lastExportAt: null, opened: {}, map: null, L: {}, lastZip: null, dayFilter: null,
  lastFixAt: null, trackKm: 0, trackLastSave: 0, markN: 0, trackPtsBase: 0, trackSegsToday: 0, lastTrackPt: null, gapKm: 0,
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
      priority: p.priority || '', mesh: p.mesh || '', day: p.day || '', fc: p.fc ?? '', survey: p.survey || '', build: p.build || '', lat: +lat, lng: +lng,
      kind: p.kind || '', eta: p.eta || '' });
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
function stripBom(s) { return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s; }
async function readPackFile(f) {
  const buf = await (f.arrayBuffer ? f.arrayBuffer() : new Response(f).arrayBuffer());
  const u8 = new Uint8Array(buf);
  if (!u8.length) throw new Error('빈 파일입니다. 원본을 다시 받아 주세요');
  if (u8[0] === 0x50 && u8[1] === 0x4b) {
    const zip = await JSZip.loadAsync(buf);
    const ent = Object.values(zip.files).find(z => !z.dir && /\.json$/i.test(z.name) && !/^__MACOSX/.test(z.name));
    if (!ent) throw new Error('ZIP 안에 .json 파일이 없습니다');
    return JSON.parse(stripBom(await ent.async('string')).trim());
  }
  const txt = stripBom(new TextDecoder('utf-8').decode(u8)).trim();
  if (txt.startsWith('<')) throw new Error('패키지가 아니라 웹페이지(미리보기 화면)가 저장됐습니다. 파일 원본을 다시 받아 주세요');
  try { return JSON.parse(txt); } catch (e) { throw new Error(`JSON 형식이 아닙니다 (앞부분 : ${txt.slice(0, 30).replace(/\s+/g, ' ')})`); }
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
  S.L.trackOld = L.layerGroup().addTo(map);
  S.L.track = L.polyline([], { color: '#ff3b30', weight: 4, opacity: .85, dashArray: '8 6' }).addTo(map);
  S.L.marks = L.layerGroup().addTo(map);
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
function escH(x) { return String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function renderRange() {
  S.L.range.clearLayers(); S.L.meshLbl.clearLayers();
  const rng = S.pack && S.pack.range; if (!rng) return;
  const isLine = f => /LineString/.test((f && f.geometry && f.geometry.type) || '');
  L.geoJSON(rng, {
    style: f => {
      const p = (f && f.properties) || {};
      if (isLine(f)) {
        if (p.kind === 'route') return { color: '#111827', weight: p.leg === '구역 관통' ? 3 : 2, opacity: p.skip ? .3 : .55, dashArray: p.leg === '구역 관통' ? null : '4 6', interactive: false };
        if (p.kind === 'added') return { color: '#5E3C99', weight: 4, opacity: .85, dashArray: '8 6' };
        return { color: '#E66101', weight: 6, opacity: p.skip ? .5 : .9 };
      }
      return { color: '#1f2937', weight: 1, opacity: .7, fillColor: '#4da3ff', fillOpacity: .05 };
    },
    onEachFeature: (f, layer) => {
      const p = f.properties || {};
      if (isLine(f)) {
        if (p.kind === 'route') return;
        const meta = [p.priority, p.tier, p.cycle, p.role].filter(Boolean).map(escH).join(' · ');
        layer.bindPopup(`<b>${escH(p.name)}</b><br>${meta}${p.seq ? `<br>경유 ${escH(p.seq)}번부터 · 예상 ${escH(p.eta || '')}` : ''}${p.skip ? '<br>시간 부족 시 생략 가능' : ''}`);
        return;
      }
      layer.bindPopup(`<b>메시 ${p.mesh ?? ''}</b><br>조사 ${p['조사일정'] || '미정'} · 구축 ${p['구축일정'] || '미정'}<br>도로 ${p['전체'] ?? '-'} km (주요 ${p['주요도로'] ?? '-'} · 레지덴셜 ${p['레지덴셜'] ?? '-'})`);
      const lbl = mmdd(p['조사일정']);
      if (lbl) L.marker(polyCenter(f.geometry), { interactive: false, icon: L.divIcon({ className: '', html: `<div class="meshlbl">${lbl}</div>`, iconSize: [40, 14], iconAnchor: [20, 7] }) }).addTo(S.L.meshLbl);
    },
  }).eachLayer(l => S.L.range.addLayer(l));
}
function zoomTier() { const z = S.map ? S.map.getZoom() : 13; return z >= 14 ? 2 : (z >= 12 ? 1 : 0); }
function planIcon(p) {
  const st = S.status[p.seq] || {}; const cur = p.seq === S.currentSeq;
  const cls = (cur ? 'cur' : (st.visited ? 'done' : (st.skipped ? 'skip' : ''))) + (p.kind === 'pass' ? ' pass' : '');
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
    h('div', null, [p.day, p.kind === 'pass' ? '통과' : (p.kind === 'stop' ? '정차' : ''), p.eta && `예정 ${p.eta}`, p.cat, p.priority && `우선 ${p.priority}`, p.fc !== '' && `FC${p.fc}`].filter(Boolean).join(' · ')),
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
let gpsStartAt = 0, gpsErrN = 0;
function startGPS() {
  if (!('geolocation' in navigator)) { $('#gpsStat').textContent = 'GPS 없음'; return; }
  gpsStartAt = Date.now();
  gpsWatch = navigator.geolocation.watchPosition(onPos, err => {
    gpsErrN++;
    $('#gpsStat').textContent = err.code === 1 ? 'GPS 거부됨' : (err.code === 3 ? 'GPS 찾는 중' : 'GPS 없음(실내?)');
    if (DEMO && !S.gps) demoGps();
    // 실내 등에서 오류가 나면 아이폰은 추적을 멈춤 → 잠시 뒤 다시 시작 (v0.3.7)
    if (err.code !== 1 && Date.now() - gpsStartAt > 8000) setTimeout(() => restartGPS('error'), 3000);
  }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  if (DEMO) demoTimer = setTimeout(() => { if (!S.gps) demoGps(); }, 2500);
}
function restartGPS(reason) {
  if (!('geolocation' in navigator)) return;
  try { if (gpsWatch != null) navigator.geolocation.clearWatch(gpsWatch); } catch (e) { }
  gpsWatch = null; startGPS(); logVisit('gps_restart', { reason });
}
function gpsWatchdog() {
  // 30초 넘게 위치가 안 오면 추적을 다시 시작 (30초에 한 번까지)
  const now = Date.now();
  if ((!S.lastFixAt || now - S.lastFixAt > 30000) && now - gpsStartAt > 30000) restartGPS('stale');
}
function demoGps() { onPos({ coords: { latitude: 21.5433, longitude: 39.1728, accuracy: 12 }, timestamp: Date.now(), demo: true }); }
function onPos(pos) {
  const c = pos.coords;
  S.gps = { lat: c.latitude, lng: c.longitude, acc: c.accuracy, t: pos.timestamp }; S.lastFixAt = Date.now();
  $('#gpsStat').textContent = `GPS ±${Math.round(c.accuracy)}m${pos.demo ? ' (데모)' : ''}`;
  const ll = [c.latitude, c.longitude];
  if (!meMarker) {
    meCircle = L.circle(ll, { radius: c.accuracy, color: '#1e88ff', weight: 1, fillOpacity: .12, interactive: false }).addTo(S.map);
    meMarker = L.marker(ll, { interactive: false, zIndexOffset: 2000, icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [24, 24], iconAnchor: [12, 12] }) }).addTo(S.map);
  } else { meMarker.setLatLng(ll); meCircle.setLatLng(ll).setRadius(c.accuracy); }
  if (S.follow) S.map.panTo(ll, { animate: true });
  if (S.tracking) addTrackPoint(c.latitude, c.longitude, pos.timestamp);
  updateCardDistance(); updateAppLinks(); checkArrive();
}
function setFollow(on) {
  S.follow = on; const b = $('#btnFollow'); b.setAttribute('aria-pressed', on); b.textContent = on ? '따라가기 켬' : '따라가기 끔';
  if (on && S.gps) S.map.panTo([S.gps.lat, S.gps.lng]);
}
async function requestWake() {
  try { if ('wakeLock' in navigator && S.tracking) S.wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { console.warn('wakeLock', e); }
}
async function startTrack(resumeGapMs) {
  S.tracking = true; S.track = { id: uid('t_'), startedAt: nowIso(), endedAt: null, pts: [], resumed: resumeGapMs != null };
  S.trackLastSave = Date.now(); S.L.track.setLatLngs([]);
  if (S.gps && S.lastFixAt && Date.now() - S.lastFixAt < 30000) addTrackPoint(S.gps.lat, S.gps.lng, Date.now());
  await kvSet('trackOn', true); await requestWake(); updateTrackBtn(); renderTrkBar();
}
async function flushTrack() {
  if (!S.track || !S.track.pts.length) return;
  S.trackLastSave = Date.now();
  try { await DB.put('tracks', S.track); await kvSet('trackLastAt', Date.now()); } catch (e) { console.warn('flush', e); }
}
async function stopTrack() {
  S.tracking = false; if (S.track) { S.track.endedAt = nowIso(); await flushTrack(); }
  await kvSet('trackOn', false);
  try { if (S.wakeLock) await S.wakeLock.release(); } catch (e) { }
  S.wakeLock = null; toast(`궤적 저장 · 오늘 ${(S.trackPtsBase + (S.track ? S.track.pts.length : 0)).toLocaleString()}점`);
  if (S.track && S.track.pts.length) {
    L.polyline(S.track.pts.map(q => [q[1], q[0]]), { color: '#ff3b30', weight: 3, opacity: .45 }).addTo(S.L.trackOld);
    S.trackPtsBase += S.track.pts.length; S.trackSegsToday++; S.lastTrackPt = S.track.pts[S.track.pts.length - 1];
  }
  S.track = null; S.L.track.setLatLngs([]); updateTrackBtn(); renderTrkBar();
}
function updateTrackBtn() {
  const b = $('#btnTrack'); b.setAttribute('aria-pressed', S.tracking); b.textContent = S.tracking ? '● 궤적 기록 중' : '궤적 꺼짐';
}
async function toggleTrack() {
  if (!S.tracking) { if (S.dayEnded) { S.dayEnded = false; await kvSet('dayEnded', null); renderCard(); } await startTrack(); toast('주행 궤적 기록 시작 · 화면을 켜 두세요'); logVisit('track_start'); }
  else { if (!confirm('궤적 기록을 멈출까요?')) return; await stopTrack(); logVisit('track_stop'); }
}
async function rotateTrack() {
  // 한 토막이 너무 커지지 않게 2,000점마다 새 토막으로 (저장 부담 줄임)
  const old = S.track; old.endedAt = nowIso(); await DB.put('tracks', old).catch(() => { });
  L.polyline(old.pts.map(q => [q[1], q[0]]), { color: '#ff3b30', weight: 3, opacity: .45 }).addTo(S.L.trackOld);
  const last = old.pts[old.pts.length - 1];
  S.trackPtsBase += old.pts.length - 1; S.trackSegsToday++;  // 새 토막 첫 점은 앞 토막 끝점과 같음
  S.track = { id: uid('t_'), startedAt: nowIso(), endedAt: null, pts: [last], resumed: false, cont: old.id };
  S.L.track.setLatLngs([[last[1], last[0]]]);
}
function addTrackPoint(lat, lng, ts) {
  const t = S.track; if (!t) return;
  const last = t.pts[t.pts.length - 1];
  if (!last && S.lastTrackPt) {
    // 앱이 꺼졌다 켜져 새 토막이 시작될 때 : 끊긴 사이는 직선 거리로 더해 오늘 거리가 줄지 않게 (v0.3.8)
    const g = km({ lat: S.lastTrackPt[1], lng: S.lastTrackPt[0] }, { lat, lng });
    if (g < 30) { S.trackKm += g; S.gapKm += g; }
    S.lastTrackPt = null;
  }
  if (last) {
    const d = km({ lat: last[1], lng: last[0] }, { lat, lng }) * 1000;
    if (d < 12 && ts - last[3] < 10000) return;
    if (d < 5000) S.trackKm += d / 1000;
  }
  t.pts.push([+lng.toFixed(6), +lat.toFixed(6), new Date(ts).toISOString(), ts]);
  S.L.track.addLatLng([lat, lng]);
  if (t.pts.length >= 2000) { rotateTrack(); return; }
  if (Date.now() - S.trackLastSave > 15000) flushTrack();
}

/* ---------- 상태줄 · 경고 ---------- */
let AC = null, staleAlertAt = 0, pokeAt = 0, pokeBusy = false;
function beep() {
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume();
    const o = AC.createOscillator(), g = AC.createGain(); o.frequency.value = 880; g.gain.value = .25;
    o.connect(g); g.connect(AC.destination); o.start(); o.stop(AC.currentTime + .4);
  } catch (e) { }
}
function fmtAgo(ms) { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}초 전` : `${Math.floor(s / 60)}분 ${s % 60}초 전`; }
function fmtGap(ms) { const m = Math.round(ms / 60000); return m < 1 ? '1분 미만' : (m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간 ${m % 60}분`); }
function renderTrkBar() {
  const el = $('#trkBar'); if (!el) return;
  const now = Date.now();
  if (!S.tracking) { el.className = 'off'; el.textContent = '○ 궤적 꺼짐 · 여기를 눌러 기록 시작'; return; }
  const age = S.lastFixAt ? now - S.lastFixAt : null;
  if (age == null || age > 20000) {
    if (now - pokeAt > 15000 && 'geolocation' in navigator && !pokeBusy) {
      pokeAt = now; pokeBusy = true;
      navigator.geolocation.getCurrentPosition(p => { pokeBusy = false; onPos(p); }, () => { pokeBusy = false; }, { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 });
    }
  }
  const n = S.trackPtsBase + (S.track ? S.track.pts.length : 0);  // 오늘 전체 (앱이 다시 켜져도 이어서 셈, v0.3.8)
  if (age == null || age > 45000) {
    el.className = 'stale';
    el.textContent = `⚠ 궤적 끊김 · 마지막 위치 ${age == null ? '없음' : fmtAgo(age)} · 화면 켜기 · 위치 권한 확인`;
    if (now - staleAlertAt > 30000) { staleAlertAt = now; try { navigator.vibrate && navigator.vibrate([400, 150, 400]); } catch (e) { } beep(); }
  } else {
    el.className = 'on';
    el.textContent = `● 기록 중 · 오늘 ${n.toLocaleString()}점 · ${S.trackKm.toFixed(1)} km · ${fmtAgo(age)} · ±${Math.round(S.gps.acc)} m`;
  }
}

/* ---------- ★ 표시 ---------- */
const MARKS = new Map(); const MARK_CANCELED = new Set(); const MARKS_TODAY = new Set();
function markLabel() { const b = $('#btnMark'); if (b) b.textContent = MARKS_TODAY.size ? `★${MARKS_TODAY.size}` : '★'; }
function drawMark(n, lat, lng, t) {
  if (MARK_CANCELED.has(n)) return;
  const m = L.circleMarker([lat, lng], { radius: 9, color: '#111', weight: 2, fillColor: '#ffd400', fillOpacity: 1 })
    .bindTooltip(`★ #${n} ${hm(t)}`)
    .bindPopup(() => h('div', null, h('div', null, h('b', null, `★ #${n}`), ` · ${hm(t)}`),
      h('div', { class: 'pbtns' }, h('button', { onclick: () => { S.map.closePopup(); cancelMark(n); } }, '이 표시 취소'))));
  m.addTo(S.L.marks); MARKS.set(n, m);
}
function cancelMark(n, ask = true) {
  if (n == null || MARK_CANCELED.has(n)) return;
  if (ask && !confirm(`이 ★ 표시(#${n})를 취소할까요?`)) return;
  MARK_CANCELED.add(n); MARKS_TODAY.delete(n); markLabel(); logVisit('mark_cancel', { n });
  const m = MARKS.get(n); if (m) { S.L.marks.removeLayer(m); MARKS.delete(n); }
  try { navigator.vibrate && navigator.vibrate([40, 40, 40]); } catch (e) { }
  toast(`★ 표시 취소함 (오늘 ${MARKS_TODAY.size}개 남음)`);
}
function cancelLastMark() {
  const last = MARKS_TODAY.size ? Math.max(...MARKS_TODAY) : null;
  if (last == null) return toast('오늘 취소할 ★ 가 없습니다');
  cancelMark(last);
}
function doMark() {
  S.markN += 1; const n = S.markN; kvSet('markN', n);
  logVisit('mark', { n, near: S.currentSeq });
  try { navigator.vibrate && navigator.vibrate(90); } catch (e) { }
  if (S.gps) drawMark(n, S.gps.lat, S.gps.lng, nowIso());
  MARKS_TODAY.add(n); markLabel();
  toast(`★ 표시 (오늘 ${MARKS_TODAY.size}개) · ${hm(nowIso())}${S.gps ? '' : ' · 위치 없음'} · 말로 이유를 남겨 주세요`);
}

/* ---------- 도착 · 통과 자동 판정 ---------- */
function checkArrive() {
  const p = S.planBySeq.get(S.currentSeq); if (!p || !S.gps || S.gps.acc > 80) return;
  const st = S.status[p.seq] || {}; const d = km(S.gps, p) * 1000;
  if (p.kind === 'pass') {
    if (d <= 150 && !st.visited) {
      setStatus(p.seq, { visited: true, visitedAt: nowIso(), auto: true }); logVisit('pass', { seq: p.seq, dist: Math.round(d) });
      try { navigator.vibrate && navigator.vibrate([60, 60, 60]); } catch (e) { }
      const nx = nextOpenSeq(p.seq);
      if (nx != null) { setCurrent(nx, 'auto'); toast(`통과 P${pad(p.seq, 3)} ✓ → 다음 P${pad(nx, 3)} · 길안내 앱 버튼을 눌러 목적지를 바꾸세요`, 4500); }
      else { renderPlan(); renderCard(); }
    }
  } else if (d <= 80 && !st.arrivedAt) {
    setStatus(p.seq, { arrivedAt: nowIso() }); logVisit('arrive', { seq: p.seq, dist: Math.round(d) });
    try { navigator.vibrate && navigator.vibrate(200); } catch (e) { }
    toast(`도착 P${pad(p.seq, 3)} · 사진 · 캡처 · 말로 이유 남기고 「다음 ▶」`, 4500); renderCard();
  }
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
// 다음 = 번호 순서로 한 칸 (방문 여부와 상관없음, v0.3.6)
function nextOpenSeq(fromSeq) {
  const L = vis(); const i = idxOf(fromSeq, L);
  if (i < 0) return L.length ? L[0].seq : null;
  return i + 1 < L.length ? L[i + 1].seq : null;
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
  if (['next', 'prev', 'skip', 'auto'].includes(type)) S.navGuardUntil = Date.now() + 800;
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
  const cur = S.currentSeq; const cp = S.planBySeq.get(cur);
  if (cur != null && cp) {
    if (skip) setStatus(cur, { skipped: true, skippedAt: nowIso() });
    else if ((S.gps && km(S.gps, cp) * 1000 <= 300) || (S.status[cur] || {}).arrivedAt) setStatus(cur, { visited: true, visitedAt: nowIso() });
  }
  const nx = nextOpenSeq(cur);
  if (nx == null) { renderPlan(); renderCard(); toast('이 일자의 마지막 지점입니다'); return; }
  setCurrent(nx, skip ? 'skip' : 'next');
  autoOpenRole();
}
async function daySummary() {
  const today = new Date().toDateString();
  const tr = (await DB.all('tracks')).filter(t => t.pts && t.pts.length && new Date(t.startedAt).toDateString() === today)
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  let kmSum = 0, n = 0, t0 = null, t1 = null, gapKm = 0, gaps = 0, prevLast = null;
  for (const t of tr) {
    n += t.pts.length - (t.cont ? 1 : 0);
    if (prevLast && !t.cont) {
      const g = km({ lat: prevLast[1], lng: prevLast[0] }, { lat: t.pts[0][1], lng: t.pts[0][0] });
      if (g < 30) { kmSum += g; gapKm += g; } if (g > 0.3) gaps++;
    }
    prevLast = t.pts[t.pts.length - 1];
    for (let k = 0; k < t.pts.length; k++) {
      const q = t.pts[k]; const ts = q[3] || Date.parse(q[2]);
      if (t0 == null || ts < t0) t0 = ts; if (t1 == null || ts > t1) t1 = ts;
      if (k) { const a = t.pts[k - 1]; const d = km({ lat: a[1], lng: a[0] }, { lat: q[1], lng: q[0] }); if (d < 5) kmSum += d; }
    }
  }
  const vs = (await DB.all('visits')).filter(v => new Date(v.t).toDateString() === today);
  const marks = vs.filter(v => v.type === 'mark').length - vs.filter(v => v.type === 'mark_cancel').length;
  const L = vis();
  const visited = L.filter(x => (S.status[x.seq] || {}).visited).length, skipped = L.filter(x => (S.status[x.seq] || {}).skipped).length;
  const recs = S.records.filter(r => new Date(r.createdAt).toDateString() === today).length;
  const gpsRestarts = vs.filter(v => v.type === 'gps_restart').length;
  return { km: kmSum, pts: n, segs: tr.length, gaps, gapKm, t0, t1, marks, visited, skipped, total: L.length, recs, gpsRestarts, day: S.dayFilter };
}
async function openDaySummary(justEnded) {
  const s = await daySummary();
  const hmTs = ts => ts ? hm(new Date(ts).toISOString()) : '-';
  const dur = s.t0 && s.t1 ? Math.round((s.t1 - s.t0) / 60000) : 0;
  const row = (k, v) => h('div', { class: 'grid2' }, h('div', { class: 'muted' }, k), h('div', { style: 'font-weight:800' }, v));
  const body = h('div', null,
    justEnded ? h('div', { style: 'font-weight:900;font-size:18px;margin-bottom:8px' }, '오늘 실사를 마감했습니다') : null,
    row('일자', s.day && s.day !== 'all' ? s.day : new Date().toLocaleDateString()),
    row('궤적', `${hmTs(s.t0)} ~ ${hmTs(s.t1)} (${Math.floor(dur / 60)}시간 ${dur % 60}분) · ${s.km.toFixed(1)} km · ${s.pts.toLocaleString()}점 · ${s.segs}토막`),
    s.gaps ? row('끊긴 구간', `${s.gaps}곳 · 직선 ${s.gapKm.toFixed(1)} km 를 거리에 더함`) : null,
    row('계획 지점', `방문 ${s.visited} · 건너뜀 ${s.skipped} · 전체 ${s.total}`),
    row('★ 표시', `${s.marks}개`), row('앱 기록', `${s.recs}건`), row('GPS 다시 잡기', `${s.gpsRestarts}회`),
    h('div', { class: 'muted', style: 'margin-top:10px' }, '이제 내보내기(ZIP)를 만들어 정리 담당에게 보내 주세요. 사진 · 캡처 · 녹음은 원본으로 올려 주세요.'));
  openSheet('오늘 실사 요약', body, [h('button', { class: 'b primary', onclick: () => { closeSheet(true); openExport(); } }, '내보내기 (ZIP)'), h('button', { class: 'b', onclick: () => closeSheet(true) }, '닫기')]);
}
async function doDayEnd() {
  if (S.dayEnded) return openDaySummary(false);
  if (!confirm('오늘 실사를 마칠까요?\n궤적 기록을 멈추고 오늘 요약과 내보내기를 엽니다.')) return;
  if (S.tracking) await stopTrack();
  S.dayEnded = true; await kvSet('dayEnded', new Date().toDateString());
  const s = await daySummary();
  logVisit('day_end', { km: +s.km.toFixed(1), pts: s.pts, visited: s.visited, skipped: s.skipped, marks: s.marks });
  try { navigator.vibrate && navigator.vibrate([120, 80, 120]); } catch (e) { }
  renderCard(); openDaySummary(true);
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
        h('div', { class: 'sub' }, '웍스로 받은 실사 패키지 파일(.zip 또는 .json)을 고르면 실사 범위와 가볼 지점이 들어옵니다.')),
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
      h('div', { class: 'sub st', id: 'cardSub' }, subLine(p, st, done, recN)),
      h('div', { class: 'sub rs' }, p.reason || ' ')),  // 줄 수 고정 : 지점마다 카드 높이가 바뀌어 버튼이 움직이지 않게 (v0.3.9)
    h('div', { class: 'row nav' },
      h('button', { class: 'b', onclick: doPrev }, '◀ 이전'),
      h('button', { class: 'b', onclick: () => doNext(true) }, '건너뛰기'),
      h('button', { class: 'b primary', onclick: () => doNext(false) }, '다음 ▶')),
    h('div', { class: 'row apps', id: 'appRow' }),
    h('div', { class: 'row act' },
      h('button', { class: 'b big', onclick: () => openRecord(null, p.seq) }, '＋ 기록'),
      h('button', { class: 'b donebtn' + (S.dayEnded ? ' on' : ''), onclick: doDayEnd }, S.dayEnded ? '오늘 마감됨 · 요약' : '오늘 조사 완료'),
      h('button', { class: 'b', onclick: openList }, '목록')));
  renderAppRow();
}
function etaLag(p) {
  if (!p.eta) return '';
  const d = new Date(); const tag = `${d.getMonth() + 1}/${d.getDate()}`;
  if (!p.day || !p.day.startsWith(tag)) return `예정 ${p.eta}`;
  const [H, M] = p.eta.split(':').map(Number); const diff = (d.getHours() * 60 + d.getMinutes()) - (H * 60 + M);
  return `예정 ${p.eta} (${diff > 5 ? `${diff}분 늦음` : (diff < -5 ? `${-diff}분 빠름` : '제시간')})`;
}
function subLine(p, st, done, recN) {
  const d = S.gps ? fmtKm(km(S.gps, p)) : '거리 ?';
  const state = st.visited ? `${st.auto ? '통과' : '방문'} ${hm(st.visitedAt)}` : (st.skipped ? '건너뜀' : (st.arrivedAt ? `도착 ${hm(st.arrivedAt)}` : '미방문'));
  const kind = p.kind === 'pass' ? '통과 지점' : (p.kind === 'stop' ? '정차 지점' : '');
  return [p.day, kind, etaLag(p), `직선 ${d}`, state, `진행 ${done}/${vis().length}`].filter(Boolean).join(' · ') + (recN ? ` · 기록 ${recN}` : '');
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
  // 이전 · 다음을 빨리 누르다 앱 버튼이 눌리지 않게 : 지점이 바뀐 직후 0.8초는 앱 버튼 잠금 (v0.3.9)
  const wait = (S.navGuardUntil || 0) - Date.now();
  row.classList.toggle('guard', wait > 0);
  if (wait > 0) { clearTimeout(S.navGuardT); S.navGuardT = setTimeout(() => { const r = $('#appRow'); if (r) r.classList.remove('guard'); }, wait); }
  apps.forEach((a, i) => {
    const label = role === 'all' ? `${'①②③'[i]} ${APPS[a].label}` : `${APPS[a].label} 다시 열기`;
    const cls = 'b' + (S.opened[a] ? ' done' : (a === firstUnopened && role === 'all' ? ' next' : ''));
    const url = linkFor(a, p);
    if ((a === 'balady' || a === 'google' || (a === 'hudhud' && S.settings.hudhudMode === 'custom')) && url) {
      row.append(h('a', { class: cls, href: url, 'data-app': a, rel: 'noopener', onclick: e => { if (Date.now() < (S.navGuardUntil || 0)) { e.preventDefault(); return; } openApp(a, true); } }, label));
    } else {
      row.append(h('button', { class: cls, 'data-app': a, onclick: () => { if (Date.now() < (S.navGuardUntil || 0)) return; openApp(a); } }, label));
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
  if (pack) {
    await installPack(pack, true);
    const today = autoDay(); const todayStr = new Date().toDateString();
    if (today !== 'all' && (await kvGet('lastDayRun')) !== todayStr) {
      // 새 날 첫 실행 : 오늘 일자로 전환, 오늘 지점에 다른 날 잘못 찍힌 방문 · 건너뜀 표시 지움
      let cleared = 0;
      for (const p of S.plan.filter(p => p.day === today)) {
        const st = S.status[p.seq]; const t = st && (st.visitedAt || st.skippedAt || st.arrivedAt);
        if (t && new Date(t).toDateString() !== todayStr) { delete S.status[p.seq]; cleared++; }
      }
      await kvSet('status', S.status); await kvSet('lastDayRun', todayStr);
      await setDayFilter(today);
      const first = S.plan.find(p => p.day === today); if (first) setCurrent(first.seq, 'day');
      logVisit('day_start', { day: today, cleared });
      toast(`오늘 ${today} 지점으로 바꿨습니다${cleared ? ` · 잘못 찍힌 방문 ${cleared}개 지움` : ''}`, 6000);
    } else if (!S.dayFilter) await setDayFilter(today);
  } else renderCard();
  renderRecords();
  if (S.currentSeq != null) logVisit('boot', { seq: S.currentSeq }); else logVisit('boot');
  S.markN = (await kvGet('markN')) || 0; S.dayEnded = (await kvGet('dayEnded')) === new Date().toDateString();
  try {
    const today = new Date().toDateString();
    const old = (await DB.all('tracks')).filter(t => t.pts && t.pts.length && new Date(t.startedAt).toDateString() === today)
      .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    let prevLast = null;
    for (const t of old) {
      L.polyline(t.pts.map(q => [q[1], q[0]]), { color: '#ff3b30', weight: 3, opacity: .45 }).addTo(S.L.trackOld);
      if (prevLast && !t.cont) { const g = km({ lat: prevLast[1], lng: prevLast[0] }, { lat: t.pts[0][1], lng: t.pts[0][0] }); if (g < 30) { S.trackKm += g; S.gapKm += g; } }
      for (let i = 1; i < t.pts.length; i++) { const a = t.pts[i - 1], b = t.pts[i]; const d = km({ lat: a[1], lng: a[0] }, { lat: b[1], lng: b[0] }); if (d < 5) S.trackKm += d; }
      S.trackPtsBase += t.pts.length - (t.cont ? 1 : 0); prevLast = t.pts[t.pts.length - 1];
    }
    S.trackSegsToday = old.length; S.lastTrackPt = prevLast;  // 다음 토막 첫 점과 이어 셈
    const vs = await DB.all('visits');
    vs.filter(v => v.type === 'mark_cancel').forEach(v => MARK_CANCELED.add(v.n));
    vs.filter(v => v.type === 'mark' && new Date(v.t).toDateString() === today && !MARK_CANCELED.has(v.n)).forEach(v => { MARKS_TODAY.add(v.n); if (v.lat != null) drawMark(v.n, v.lat, v.lng, v.t); });
  } catch (e) { console.warn('today', e); }
  markLabel();
  startGPS();
  if (await kvGet('trackOn')) {
    const lastAt = await kvGet('trackLastAt'); const gap = lastAt ? Date.now() - lastAt : 0;
    await startTrack(gap); logVisit('track_resume', { gapSec: Math.round(gap / 1000) });
    toast(`궤적 자동 재개 · 끊긴 시간 약 ${fmtGap(gap)}`, 6000);
  }
  $('#trkBar').onclick = () => { if (!S.tracking) toggleTrack(); };
  $('#gpsStat').style.cursor = 'pointer';
  $('#gpsStat').onclick = () => { restartGPS('manual'); toast('GPS 를 다시 잡는 중입니다'); };
  setInterval(gpsWatchdog, 5000);
  { const b = $('#btnMark'); let lp = null, fired = false;
    b.addEventListener('pointerdown', () => { fired = false; clearTimeout(lp); lp = setTimeout(() => { fired = true; cancelLastMark(); }, 700); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, () => clearTimeout(lp)));
    b.addEventListener('contextmenu', e => e.preventDefault());
    b.onclick = () => { if (fired) { fired = false; return; } doMark(); }; }
  document.addEventListener('pointerdown', () => { try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); AC.resume(); } catch (e) { } }, { once: true });
  setInterval(renderTrkBar, 1000); renderTrkBar();
  $('#btnFollow').onclick = () => setFollow(!S.follow);
  $('#btnTrack').onclick = toggleTrack;
  $('#btnMenu').onclick = openMenu;
  $('#sheetClose').onclick = () => closeSheet();
  $('#sheetWrap').addEventListener('click', e => { if (e.target.id === 'sheetWrap') closeSheet(); });
  $('#filePack').onchange = async () => {
    const f = $('#filePack').files[0]; if (!f) return;
    try { await installPack(parsePack(await readPackFile(f))); }
    catch (e) {
      toast(`패키지를 못 읽었습니다 : ${e.message} (${f.name || '이름 없음'}, ${Math.round((f.size || 0) / 1024)} KB)`, 9000);
      logVisit('pack_error', { name: f.name, size: f.size, type: f.type, msg: String(e.message).slice(0, 200) });
    }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { logVisit('show'); if (S.tracking) requestWake(); if (!S.lastFixAt || Date.now() - S.lastFixAt > 10000) restartGPS('resume'); renderTrkBar(); }
    else { logVisit('hide'); flushTrack(); }
  });
  window.addEventListener('pagehide', () => { flushTrack(); });
  const fixSize = () => setTimeout(() => { try { S.map && S.map.invalidateSize(); } catch (e) { } }, 250);
  window.addEventListener('orientationchange', fixSize); window.addEventListener('resize', fixSize);
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

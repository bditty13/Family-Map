(function(){
"use strict";

/* ---------- Constants ---------- */
const CATS = {
  home:        {label:"Home",          color:"#2F7DD1"},
  love:        {label:"Love",          color:"#D6457A"},
  family:      {label:"Family",        color:"#8659D4"},
  milestone:   {label:"School & work", color:"#D47A12"},
  celebration: {label:"Celebration",   color:"#C0392B"},
  travel:      {label:"Travel",        color:"#12988F"},
  other:       {label:"Other",         color:"#6B7480"}
};
const EXAMPLES = [
  {title:"Where we had our first date", when:"June 14, 1996", category:"love", people:"Mom, Dad",
   story:"Dad was twenty minutes late because the El broke down. Mom almost left. They split a plate of fries, walked the pier until it closed, and he asked if he could call her the next day.",
   address:"Navy Pier, Chicago, IL", lat:41.8917, lng:-87.6086},
  {title:"First apartment together", when:"Fall 1998", category:"home", people:"Mom, Dad",
   story:"A third-floor walk-up with a radiator that clanked all winter. They painted the kitchen yellow and hosted their first Thanksgiving here for eleven people around a card table.",
   address:"Lincoln Park, Chicago, IL", lat:41.9214, lng:-87.6513},
  {title:"Grandpa Joe's barbershop", when:"1962 to 1989", category:"milestone", people:"Grandpa Joe",
   story:"Grandpa cut hair here for 27 years. Kids got a lollipop from the jar by the register, and the radio was always on the Cubs game.",
   address:"Pilsen, Chicago, IL", lat:41.8566, lng:-87.6560},
  {title:"Wedding reception", when:"May 2001", category:"celebration", people:"Whole family",
   story:"It rained all morning and cleared up an hour before the ceremony. Aunt Rosa led the first dance line and nobody could get her to stop.",
   address:"Garfield Park Conservatory, Chicago, IL", lat:41.8863, lng:-87.7173}
];
const CFG = window.FAMILY_MAP_CONFIG || {};
const CLOUD_ON = !!(CFG.supabaseUrl && CFG.supabaseKey);
const mqPhone = window.matchMedia("(max-width:760px)");
const $ = id => document.getElementById(id);

/* ---------- Helpers ---------- */
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2,10));
function esc(s){ return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function yearOf(when){ const m = String(when||"").match(/\b(1[5-9]\d\d|20\d\d)\b/); return m ? +m[1] : null; }
function miles(a,b){
  const R = 3958.8, r = x => x*Math.PI/180;
  const dLat = r(b.lat-a.lat), dLng = r(b.lng-a.lng);
  const h = Math.sin(dLat/2)**2 + Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}
function fmtMiles(d){ return d < 0.1 ? "Right here" : d < 10 ? d.toFixed(1)+" mi" : Math.round(d).toLocaleString()+" mi"; }
let toastT;
function toast(msg){ const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 3600); }
function catOf(m){ return CATS[m.category] || CATS.other; }
function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
function lsSet(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }
function shortName(email){ return String(email||"").split("@")[0]; }
const ICON = {
  pin:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/></svg>',
  back:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>',
  close:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18"/></svg>'
};

/* ---------- Local storage backend (IndexedDB, in-memory fallback) ---------- */
let idb = null;
const memStore = {memories:new Map(), photos:new Map()};
function openDB(){
  return new Promise(res => {
    try{
      const r = indexedDB.open("family-story-map", 1);
      r.onupgradeneeded = () => { const d = r.result; d.createObjectStore("memories",{keyPath:"id"}); d.createObjectStore("photos",{keyPath:"id"}); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
      r.onblocked = () => res(null);
    }catch(e){ res(null); }
  });
}
const wrap = q => new Promise((res,rej) => { q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
const store = (s,mode) => idb.transaction(s, mode||"readonly").objectStore(s);
async function getAll(s){ return idb ? wrap(store(s).getAll()) : [...memStore[s].values()]; }
async function getOne(s,id){ return idb ? wrap(store(s).get(id)) : memStore[s].get(id); }
async function put(s,o){ if(idb) return wrap(store(s,"readwrite").put(o)); memStore[s].set(o.id,o); }
async function del(s,id){ if(idb) return wrap(store(s,"readwrite").delete(id)); memStore[s].delete(id); }

const localURLs = new Map();
const Local = {
  async list(){ return getAll("memories"); },
  photoKey(memId, pid){ return pid; },
  async save(m, newPhotos, removed){
    for(const p of newPhotos){ await put("photos", {id:p.key, blob:p.blob}); if(p.url) localURLs.set(p.key, p.url); }
    for(const k of removed){ await del("photos", k); localURLs.delete(k); }
    await put("memories", m);
  },
  async remove(m){
    for(const k of m.photos){ await del("photos", k); localURLs.delete(k); }
    await del("memories", m.id);
  },
  async photoURL(k){
    if(localURLs.has(k)) return localURLs.get(k);
    const p = await getOne("photos", k); if(!p) return null;
    const u = URL.createObjectURL(p.blob); localURLs.set(k, u); return u;
  },
  async photoBlob(k){ const p = await getOne("photos", k); return p ? p.blob : null; }
};

/* ---------- Cloud backend (Supabase) ---------- */
let sb = null, me = null, myRole = null;
const cloudURLs = new Map(); // path -> {url, exp}
function toRow(m){
  return {id:m.id, title:m.title, when_text:m.when||null, category:m.category, people:m.people||null, story:m.story||null,
    address:m.address||null, lat:m.lat, lng:m.lng, photos:m.photos, created_at:new Date(m.created||Date.now()).toISOString(), updated_at:new Date().toISOString()};
}
function fromRow(r){
  return {id:r.id, title:r.title, when:r.when_text||"", category:r.category||"other", people:r.people||"", story:r.story||"",
    address:r.address||"", lat:r.lat, lng:r.lng, photos:r.photos||[], created:Date.parse(r.created_at), updated:Date.parse(r.updated_at),
    addedBy:r.added_by_email||"", example:false};
}
function cloudErr(error){ const e = new Error(error.message || "Cloud error"); e.cloud = true; return e; }
const Cloud = {
  async list(){
    const {data, error} = await sb.from("memories").select("*").order("created_at");
    if(error) throw cloudErr(error);
    return data.map(fromRow);
  },
  photoKey(memId, pid){ return `${memId}/${pid}.jpg`; },
  async save(m, newPhotos, removed){
    for(const p of newPhotos){
      const {error} = await sb.storage.from("photos").upload(p.key, p.blob, {contentType:"image/jpeg", upsert:true});
      if(error) throw cloudErr(error);
      if(p.url) cloudURLs.set(p.key, {url:p.url, exp:Infinity});
    }
    if(removed.length){ await sb.storage.from("photos").remove(removed); removed.forEach(k => cloudURLs.delete(k)); }
    const {error} = await sb.from("memories").upsert(toRow(m));
    if(error) throw cloudErr(error);
  },
  async remove(m){
    if(m.photos.length) await sb.storage.from("photos").remove(m.photos);
    const {error} = await sb.from("memories").delete().eq("id", m.id);
    if(error) throw cloudErr(error);
  },
  async photoURL(k){
    const c = cloudURLs.get(k);
    if(c && c.exp > Date.now()) return c.url;
    const {data, error} = await sb.storage.from("photos").createSignedUrl(k, 3600);
    if(error || !data) return null;
    cloudURLs.set(k, {url:data.signedUrl, exp:Date.now() + 50*60*1000});
    return data.signedUrl;
  },
  async photoBlob(k){ const {data} = await sb.storage.from("photos").download(k); return data || null; }
};
let backend = Local;
const photoURL = k => backend.photoURL(k);

/* ---------- Photos ---------- */
function loadImage(file){
  return new Promise((res,rej) => { const u = URL.createObjectURL(file); const i = new Image(); i.onload = () => { res(i); URL.revokeObjectURL(u); }; i.onerror = () => { rej(new Error("unreadable")); URL.revokeObjectURL(u); }; i.src = u; });
}
async function shrink(file, max=1600){
  const img = await loadImage(file);
  const s = Math.min(1, max/Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth*s); c.height = Math.round(img.naturalHeight*s);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(b => res(b || file), "image/jpeg", 0.85));
}

/* ---------- Geocoding (Photon, OpenStreetMap data) ---------- */
function fmtPlace(p){
  const line1 = [p.housenumber, p.street].filter(Boolean).join(" ") || p.name || "";
  const line2 = [p.name && p.name !== line1 ? p.name : null, p.city || p.town || p.village || p.county, p.state, p.country === "United States" ? null : p.country].filter(Boolean);
  return [...new Set([line1, ...line2].filter(Boolean))].join(", ");
}
async function fetchJSON(url, ms=6000){
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try{ const r = await fetch(url, {signal:ctl.signal}); if(!r.ok) throw new Error(r.status); return await r.json(); }
  finally{ clearTimeout(t); }
}
async function reverseGeocode(lat,lng){
  try{
    const j = await fetchJSON(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&lang=en`);
    const f = j.features && j.features[0];
    return f ? fmtPlace(f.properties) : "";
  }catch(e){ return ""; }
}

/* ---------- State ---------- */
let memories = [];
let selectedId = null;
let mode = "browse";          // browse | placing | editing
let draft = null;             // {lat,lng,address}
let editing = null;           // memory being edited, or null for new
let editId = null;            // id the memory being edited will have
let editPhotos = [];          // [{key,url,blob,isNew}]
let removedPhotos = [];
let catFilter = new Set();
let here = null;              // the viewer's location {lat,lng}
let tripMode = false;
let tripPick = new Set();

/* ---------- Map ---------- */
const map = L.map("map", {zoomControl:false, worldCopyJump:true}).setView([39.5,-98.35], 4);
L.control.zoom({position:"bottomright"}).addTo(map);
// Map backgrounds that need no API key. If one fails to load, the next one is tried.
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/";
const BASES = {
  streets: {label:"Streets", url:ESRI+"World_Street_Map/MapServer/tile/{z}/{y}/{x}", opts:{maxZoom:19, attribution:"Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors"}},
  satellite: {label:"Satellite", url:ESRI+"World_Imagery/MapServer/tile/{z}/{y}/{x}", opts:{maxZoom:19, attribution:"Tiles &copy; Esri, Maxar, Earthstar Geographics"}},
  osm: {label:"OpenStreetMap", url:"https://tile.openstreetmap.org/{z}/{x}/{y}.png", opts:{maxZoom:19, referrerPolicy:"strict-origin-when-cross-origin", attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}}
};
const FALLBACK = {streets:"osm", osm:"satellite", satellite:null};
let tiles = null, baseKey = null;
function setBase(key, auto){
  if(!BASES[key]) key = "streets";
  if(tiles) map.removeLayer(tiles);
  baseKey = key;
  const b = BASES[key];
  tiles = L.tileLayer(b.url, b.opts).addTo(map);
  let ok = 0, bad = 0;
  tiles.on("tileload", () => ok++);
  tiles.on("tileerror", () => {
    bad++;
    if(bad === 6 && ok === 0 && baseKey === key){
      const next = FALLBACK[key];
      if(next){ setBase(next, true); toast(`The ${b.label} map isn't loading, so switched to ${BASES[next].label}.`); }
      else toast("The map background isn't loading. Check your internet connection.");
    }
  });
  if(!auto) lsSet("fsm-base", key);
  document.querySelectorAll("[data-base]").forEach(el => el.setAttribute("aria-pressed", el.dataset.base === key));
}
const BaseControl = L.Control.extend({
  options:{position:"bottomleft"},
  onAdd(){
    const d = L.DomUtil.create("div","basepick");
    d.innerHTML = ["streets","satellite"].map(k => `<button type="button" data-base="${k}">${BASES[k].label}</button>`).join("");
    L.DomEvent.disableClickPropagation(d);
    d.addEventListener("click", e => { const b = e.target.closest("[data-base]"); if(b) setBase(b.dataset.base); });
    return d;
  }
});
map.addControl(new BaseControl());
setBase(lsGet("fsm-base") || "streets", true);

function pinIcon(color, cls){
  return L.divIcon({className:"pin "+(cls||""), iconSize:[30,40], iconAnchor:[15,39], popupAnchor:[0,-36],
    html:`<svg width="30" height="40" viewBox="0 0 30 40"><path d="M15 38.5S28 25.4 28 15A13 13 0 0 0 2 15c0 10.4 13 23.5 13 23.5z" fill="${color}" stroke="#fff" stroke-width="2"/><circle cx="15" cy="15" r="5" fill="#fff"/></svg>`});
}
const markers = new Map();
const layer = L.layerGroup().addTo(map);
let draftMarker = null, searchMarker = null, meMarker = null;

function drawMarkers(){
  layer.clearLayers(); markers.clear();
  visible().forEach(m => {
    if(mode === "editing" && editing && editing.id === m.id) return;
    const mk = L.marker([m.lat,m.lng], {icon:pinIcon(catOf(m).color, m.id===selectedId?"sel":""), title:m.title, riseOnHover:true, keyboard:true});
    mk.on("click", () => { if(mode==="browse") openMemory(m.id); });
    mk.addTo(layer); markers.set(m.id, mk);
  });
}
function fitAll(animate=true){
  const pts = visible().map(m => [m.lat,m.lng]);
  if(here) pts.push([here.lat,here.lng]);
  if(!pts.length) return;
  if(pts.length === 1) return map.setView(pts[0], 14, {animate});
  const pad = mqPhone.matches ? {paddingTopLeft:[30,80], paddingBottomRight:[30, window.innerHeight*0.45]} : {padding:[60,60]};
  map.fitBounds(pts, {...pad, maxZoom:15, animate});
}
// Center a point in the part of the map the sheet doesn't cover
function focusOn(lat, lng, zoom){
  zoom = zoom ?? Math.max(map.getZoom(), 15);
  let pt = map.project([lat,lng], zoom);
  if(mqPhone.matches){
    const s = $("sheet").classList;
    const frac = s.contains("tall") ? .86 : s.contains("mid") ? .62 : .42;
    pt = pt.add([0, window.innerHeight*frac/2]);
  }
  map.flyTo(map.unproject(pt, zoom), zoom, {duration:.6});
}
map.on("click", e => {
  if(mode === "placing") startEditor(null, e.latlng.lat, e.latlng.lng);
  else if(mode === "editing") moveDraft(e.latlng.lat, e.latlng.lng);
});

/* ---------- Sheet sizing on phones ---------- */
function sheetSize(size){
  const s = $("sheet"), app = $("app");
  s.classList.remove("tall","mid","low");
  app.classList.remove("sheet-tall","sheet-mid","sheet-low");
  if(size){ s.classList.add(size); app.classList.add("sheet-"+size); }
}
$("handle").addEventListener("click", () => {
  const s = $("sheet");
  if(!$("panelView").hidden || !$("gateView").hidden){ sheetSize(s.classList.contains("tall") ? "mid" : "tall"); return; }
  sheetSize(s.classList.contains("tall") ? "low" : s.classList.contains("low") ? null : "tall");
});

/* ---------- Views ---------- */
function showView(which){
  $("listView").hidden = which !== "list";
  $("panelView").hidden = which !== "panel";
  $("gateView").hidden = which !== "gate";
}

/* ---------- Filtering / list ---------- */
function visible(){
  const q = $("filter").value.trim().toLowerCase();
  return memories.filter(m =>
    (!catFilter.size || catFilter.has(m.category)) &&
    (!q || [m.title,m.when,m.people,m.story,m.address,m.addedBy].join(" ").toLowerCase().includes(q)));
}
function sorted(list){
  const how = $("sort").value;
  const arr = [...list];
  if(how === "near" && here) return arr.sort((a,b) => miles(here,a) - miles(here,b));
  const dir = how === "new" ? -1 : 1;
  return arr.sort((a,b) => {
    const ya = yearOf(a.when), yb = yearOf(b.when);
    if(ya == null && yb == null) return a.created - b.created;
    if(ya == null) return 1; if(yb == null) return -1;
    return (ya - yb)*dir || (a.created - b.created)*dir;
  });
}
function renderCats(){
  const used = new Set(memories.map(m => m.category));
  $("catFilter").innerHTML = Object.entries(CATS).filter(([k]) => used.has(k)).map(([k,c]) =>
    `<button class="chip" data-cat="${k}" aria-pressed="${catFilter.has(k)}"><span class="dot" style="background:${c.color}"></span>${esc(c.label)}</button>`).join("");
}
$("catFilter").addEventListener("click", e => {
  const b = e.target.closest("[data-cat]"); if(!b) return;
  const k = b.dataset.cat; catFilter.has(k) ? catFilter.delete(k) : catFilter.add(k);
  renderAll();
});
$("filter").addEventListener("input", () => renderAll());
$("sort").addEventListener("change", async () => {
  if($("sort").value === "near" && !here){ const ok = await locate(false); if(!ok) $("sort").value = "old"; }
  renderList();
});

function renderList(){
  const vis = sorted(visible());
  const n = memories.length;
  $("count").textContent = n ? `${n} ${n===1?"memory":"memories"} on the map` : "No memories yet";
  $("shown").textContent = vis.length === n ? "" : `Showing ${vis.length} of ${n}`;
  const hasEx = memories.some(m => m.example);
  $("exampleNote").hidden = !hasEx;
  $("clearExamplesBtn").hidden = !hasEx;
  const list = $("list");
  if(!n){
    list.innerHTML = `<div class="empty"><h3>Start with one place</h3><p>Tap <b>Add memory</b>, then tap the map where it happened, or search an address first. Add the story and a photo or two.</p></div>`;
    return;
  }
  if(!vis.length){ list.innerHTML = `<div class="empty"><p>No memories match that search.</p></div>`; return; }
  list.innerHTML = vis.map(m => {
    const c = catOf(m);
    const d = here ? `<span class="dist">${fmtMiles(miles(here,m))}</span>` : "<span></span>";
    const right = tripMode ? `<input type="checkbox" aria-label="Visit ${esc(m.title)}" ${tripPick.has(m.id)?"checked":""}>` : d;
    return `<button class="item ${m.id===selectedId?"on":""}" data-id="${esc(m.id)}">
      <span class="thumb" data-photo="${esc(m.photos[0]||"")}" style="color:${c.color}">${ICON.pin}</span>
      <span class="txt"><span class="t">${esc(m.title)}</span>${m.example?'<span class="badge">Example</span>':""}
        <span class="m">${esc([m.when, m.address].filter(Boolean).join(" · ") || c.label)}</span></span>
      ${right}</button>`;
  }).join("");
  list.querySelectorAll("[data-photo]").forEach(async el => {
    const k = el.dataset.photo; if(!k) return;
    const u = await photoURL(k); if(u) el.innerHTML = `<img src="${esc(u)}" alt="">`;
  });
}
$("list").addEventListener("click", e => {
  const it = e.target.closest(".item"); if(!it) return;
  const id = it.dataset.id;
  if(tripMode){
    tripPick.has(id) ? tripPick.delete(id) : tripPick.add(id);
    const cb = it.querySelector("input"); if(cb) cb.checked = tripPick.has(id);
    updateTrip(); return;
  }
  openMemory(id);
});
function renderAll(){ renderCats(); renderList(); drawMarkers(); }

/* ---------- Memory view ---------- */
function showPanel(html){
  showView("panel");
  const p = $("panelView"); p.innerHTML = html;
  p.querySelector(".pscroll")?.scrollTo(0,0);
}
function closePanel(){
  $("panelView").innerHTML = "";
  showView("list");
  selectedId = null; mode = "browse"; editing = null;
  clearDraft(); setBanner(null);
  sheetSize(null);
  renderAll();
}
async function openMemory(id, opts={}){
  const m = memories.find(x => x.id === id); if(!m) return;
  mode = "browse"; editing = null; clearDraft(); setBanner(null);
  selectedId = id; drawMarkers();
  const c = catOf(m);
  const dist = here ? `<dt>Distance</dt><dd>${fmtMiles(miles(here,m))} from you</dd>` : "";
  showPanel(`
    <div class="ptop"><button class="iconbtn" data-act="back" aria-label="Back to all memories">${ICON.back}</button><span class="grow">All memories</span>
      <button class="btn ghost small" data-act="edit">Edit</button></div>
    <div class="pscroll">
      ${m.photos.length ? `<div class="hero"><img id="heroImg" alt="Photo for ${esc(m.title)}"></div>
        ${m.photos.length > 1 ? `<div class="thumbs">${m.photos.map((p,i) => `<button data-thumb="${esc(p)}" aria-label="Photo ${i+1}" aria-current="${i===0}"><img alt=""></button>`).join("")}</div>` : ""}` : ""}
      <div class="pbody">
        <span class="cat"><span class="dot" style="background:${c.color}"></span>${esc(c.label)}${m.example?'<span class="badge">Example</span>':""}</span>
        <h2>${esc(m.title)}</h2>
        <dl class="meta">
          ${m.when ? `<dt>When</dt><dd>${esc(m.when)}</dd>` : ""}
          ${m.people ? `<dt>Who</dt><dd>${esc(m.people)}</dd>` : ""}
          <dt>Where</dt><dd>${esc(m.address || `${m.lat.toFixed(5)}, ${m.lng.toFixed(5)}`)}</dd>
          ${dist}
          ${m.addedBy ? `<dt>Added by</dt><dd>${esc(shortName(m.addedBy))}</dd>` : ""}
        </dl>
        <p class="story ${m.story?"":"none"}">${esc(m.story || "No story written yet. Tap Edit to add one.")}</p>
        <div class="actions">
          <a class="btn" href="https://www.google.com/maps/dir/?api=1&destination=${m.lat},${m.lng}" target="_blank" rel="noopener">Directions</a>
          <button class="btn ghost" data-act="del">Delete</button>
        </div>
        <div class="confirm" id="confirmDel" hidden><span>Delete this memory and its photos${CLOUD_ON ? " for everyone" : ""}? This can't be undone.</span>
          <button class="btn ghost small" data-act="keep">Keep it</button><button class="btn danger small" data-act="really-del">Delete</button></div>
      </div>
    </div>`);
  if(!opts.stay){
    if(mqPhone.matches) sheetSize("mid");
    focusOn(m.lat, m.lng);
  }
  if(m.photos.length){
    const first = await photoURL(m.photos[0]);
    const h = $("heroImg"); if(h && first) h.src = first;
    document.querySelectorAll("[data-thumb]").forEach(async b => { const u = await photoURL(b.dataset.thumb); if(u) b.querySelector("img").src = u; });
  }
}
$("panelView").addEventListener("click", async e => {
  const t = e.target.closest("[data-act],[data-thumb],#heroImg,[data-rm],[data-unmember]");
  if(!t) return;
  if(t.id === "heroImg"){ $("lightImg").src = t.src; $("lightbox").hidden = false; return; }
  if(t.dataset.thumb){
    const u = await photoURL(t.dataset.thumb); if(u) $("heroImg").src = u;
    document.querySelectorAll("[data-thumb]").forEach(b => b.setAttribute("aria-current", b === t));
    return;
  }
  if(t.dataset.rm){
    const i = editPhotos.findIndex(p => p.key === t.dataset.rm);
    if(i > -1){ const [p] = editPhotos.splice(i,1); if(!p.isNew) removedPhotos.push(p.key); }
    renderEditPhotos(); return;
  }
  if(t.dataset.unmember){ removeMember(t.dataset.unmember); return; }
  const act = t.dataset.act;
  const m = memories.find(x => x.id === selectedId);
  if(act === "back") { closePanel(); return; }
  if(act === "cancel"){ if(editing) openMemory(editing.id); else closePanel(); return; }
  if(act === "edit" && m) startEditor(m);
  if(act === "del") $("confirmDel").hidden = false;
  if(act === "keep") $("confirmDel").hidden = true;
  if(act === "really-del" && m){
    t.disabled = true;
    try{
      if(m.example) await Local.remove(m); else await backend.remove(m);
      memories = memories.filter(x => x.id !== m.id);
      closePanel(); toast("Memory deleted");
    }catch(err){ t.disabled = false; toast("Couldn't delete it. Check your connection and try again."); }
  }
  if(act === "invite") inviteMember();
  if(act === "copylink") copyLink();
});

/* ---------- Adding / editing ---------- */
function setBanner(text){
  $("banner").hidden = !text; if(text) $("bannerText").textContent = text;
  $("app").classList.toggle("placing", mode === "placing");
}
$("addBtn").addEventListener("click", () => {
  if(tripMode) endTrip();
  mode = "placing"; setBanner("Tap the map where it happened, or search an address above");
  if(mqPhone.matches) sheetSize("low");
});
$("bannerCancel").addEventListener("click", () => { mode = "browse"; setBanner(null); sheetSize(null); });

function clearDraft(){ if(draftMarker){ map.removeLayer(draftMarker); draftMarker = null; } draft = null; }
function moveDraft(lat, lng, address){
  draft = {lat, lng, address: address ?? ""};
  if(!draftMarker){
    draftMarker = L.marker([lat,lng], {icon:pinIcon(currentCatColor(), "draft"), draggable:true, zIndexOffset:1000}).addTo(map);
    draftMarker.on("dragend", () => { const p = draftMarker.getLatLng(); moveDraft(p.lat, p.lng); });
  } else draftMarker.setLatLng([lat,lng]);
  renderLoc();
  if(address == null){
    if($("locText")) $("locText").textContent = "Looking up the address…";
    reverseGeocode(lat,lng).then(a => { if(draft && draft.lat === lat && draft.lng === lng){ draft.address = a; renderLoc(); } });
  }
}
function currentCatColor(){
  const r = document.querySelector('input[name="cat"]:checked');
  return (CATS[r ? r.value : "home"] || CATS.other).color;
}
function renderLoc(){
  const el = $("locText"); if(!el || !draft) return;
  el.textContent = draft.address || "Pinned on the map";
  $("locCoords").textContent = `${draft.lat.toFixed(5)}, ${draft.lng.toFixed(5)}`;
  const inp = $("f-address"); if(inp && document.activeElement !== inp) inp.value = draft.address || "";
}

function startEditor(m, lat, lng){
  editing = m || null;
  editId = m ? m.id : uid();
  mode = "editing"; setBanner(null);
  selectedId = m ? m.id : null;
  removedPhotos = [];
  editPhotos = m ? m.photos.map(key => ({key, url:null, isNew:false})) : [];
  const catKey = m ? m.category : "home";
  showPanel(`
    <div class="ptop"><button class="iconbtn" data-act="cancel" aria-label="Cancel">${ICON.close}</button><span class="grow">${m ? "Edit memory" : "New memory"}</span></div>
    <div class="pscroll">
      <form class="ed" id="edForm" novalidate>
        <label class="lbl" for="f-title">What happened here?
          <input class="field" id="f-title" required maxlength="120" placeholder="First home, first date, Grandma's farm…" value="${esc(m?.title)}"></label>
        <div class="lbl">Kind of memory
          <div class="catpick">${Object.entries(CATS).map(([k,c]) =>
            `<label><input type="radio" name="cat" value="${k}" ${k===catKey?"checked":""}><span class="chip"><span class="dot" style="background:${c.color}"></span>${esc(c.label)}</span></label>`).join("")}</div></div>
        <label class="lbl" for="f-when">When <small>A date, a season, or a span, like "Summer 1987" or "1962 to 1989"</small>
          <input class="field" id="f-when" maxlength="80" value="${esc(m?.when)}"></label>
        <label class="lbl" for="f-people">Who was there
          <input class="field" id="f-people" maxlength="200" placeholder="Mom, Dad, Uncle Ray" value="${esc(m?.people)}"></label>
        <label class="lbl" for="f-story">The story
          <textarea class="field" id="f-story" placeholder="Tell it the way you'd tell it at the dinner table.">${esc(m?.story)}</textarea></label>
        <div class="lbl">Photos
          <div class="photogrid" id="photoGrid"></div>
          <input type="file" id="f-photos" accept="image/*" multiple hidden></div>
        <div class="lbl">Where
          <div class="loc"><div id="locText">Pinned on the map</div><div class="c" id="locCoords"></div></div>
          <small>Drag the pin or tap the map to move it. You can also search an address in the box on the map.</small>
          <label class="lbl" for="f-address" style="font-weight:400">Place name shown on this memory <small>Optional. Change it to something like "Grandma's house on Elm St"</small>
            <input class="field" id="f-address" maxlength="200"></label>
        </div>
      </form>
    </div>
    <div class="edfoot"><button class="btn ghost" data-act="cancel" type="button">Cancel</button><button class="btn" id="saveBtn" type="button">${m ? "Save changes" : "Save memory"}</button></div>`);
  clearDraft();
  if(m) moveDraft(m.lat, m.lng, m.address); else moveDraft(lat, lng);
  drawMarkers();
  renderEditPhotos();
  if(mqPhone.matches) sheetSize("mid");
  focusOn(draft.lat, draft.lng);
  $("f-address").addEventListener("input", e => { if(draft) draft.address = e.target.value; $("locText").textContent = e.target.value || "Pinned on the map"; });
  $("f-photos").addEventListener("change", addPhotos);
  document.querySelectorAll('input[name="cat"]').forEach(r => r.addEventListener("change", () => draftMarker && draftMarker.setIcon(pinIcon(currentCatColor(),"draft"))));
  $("saveBtn").addEventListener("click", save);
  if(!m && !mqPhone.matches) setTimeout(() => $("f-title")?.focus(), 50);
}
async function renderEditPhotos(){
  const g = $("photoGrid"); if(!g) return;
  for(const p of editPhotos) if(!p.url) p.url = await photoURL(p.key);
  if(!$("photoGrid")) return;
  g.innerHTML = editPhotos.map(p => `<div class="ph"><img src="${esc(p.url||"")}" alt=""><button type="button" data-rm="${esc(p.key)}" aria-label="Remove photo">${ICON.close.replace('stroke-width="2"','stroke-width="2.5" width="14" height="14"')}</button></div>`).join("")
    + `<label class="addphoto" for="f-photos"><span>+ Add<br>photos</span></label>`;
}
async function addPhotos(e){
  const files = [...e.target.files]; e.target.value = "";
  let bad = 0;
  for(const f of files){
    try{
      const blob = await shrink(f);
      const target = editing && editing.example ? Local : backend;
      editPhotos.push({key:target.photoKey(editId, uid()), blob, url:URL.createObjectURL(blob), isNew:true});
    }catch(err){ bad++; }
  }
  if(bad) toast(bad === 1 ? "One photo couldn't be read. Try a JPG or PNG." : `${bad} photos couldn't be read. Try JPG or PNG.`);
  renderEditPhotos();
}
async function save(){
  const title = $("f-title").value.trim();
  if(!title){ $("f-title").focus(); toast("Give this memory a title first."); return; }
  const btn = $("saveBtn"); const label = btn.textContent;
  btn.disabled = true; btn.textContent = "Saving…";
  const now = Date.now();
  const m = {
    id: editId,
    title,
    when: $("f-when").value.trim(),
    people: $("f-people").value.trim(),
    story: $("f-story").value.trim(),
    category: (document.querySelector('input[name="cat"]:checked')||{}).value || "other",
    address: (draft.address||"").trim(),
    lat: draft.lat, lng: draft.lng,
    photos: editPhotos.map(p => p.key),
    example: !!(editing && editing.example),
    addedBy: editing ? editing.addedBy : (me ? me.email : ""),
    created: editing ? editing.created : now,
    updated: now
  };
  try{
    const target = m.example ? Local : backend;
    await target.save(m, editPhotos.filter(p => p.isNew), removedPhotos);
    memories = memories.filter(x => x.id !== m.id).concat(m);
    editing = null; clearDraft();
    renderAll(); openMemory(m.id);
    toast(CLOUD_ON && !m.example ? "Memory saved for the whole family" : "Memory saved");
  }catch(err){
    btn.disabled = false; btn.textContent = label;
    toast(err.cloud ? "Couldn't save to the family map. Check your connection and try again." : "Couldn't save. Your device may be out of storage space.");
  }
}

/* ---------- Address search ---------- */
let searchT, searchSeq = 0;
$("search").addEventListener("input", () => {
  clearTimeout(searchT);
  const q = $("search").value.trim();
  if(q.length < 3){ $("results").hidden = true; return; }
  searchT = setTimeout(async () => {
    const seq = ++searchSeq;
    const c = map.getCenter();
    try{
      const j = await fetchJSON(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5&lang=en&lat=${c.lat}&lon=${c.lng}`);
      if(seq !== searchSeq) return;
      const feats = (j.features||[]);
      $("results").innerHTML = feats.length ? feats.map((f,i) => {
        const label = fmtPlace(f.properties);
        return `<button data-i="${i}">${esc(label.split(", ")[0])}<small>${esc(label.split(", ").slice(1).join(", "))}</small></button>`;
      }).join("") : `<button disabled>No places found</button>`;
      $("results").hidden = false;
      $("results").onclick = ev => {
        const b = ev.target.closest("[data-i]"); if(!b) return;
        const f = feats[+b.dataset.i]; const [lng,lat] = f.geometry.coordinates;
        pickPlace(lat, lng, fmtPlace(f.properties));
      };
    }catch(err){ if(seq === searchSeq){ $("results").innerHTML = `<button disabled>Search isn't reachable right now. Check your connection.</button>`; $("results").hidden = false; } }
  }, 350);
});
$("search").addEventListener("keydown", e => { if(e.key === "Enter"){ const b = $("results").querySelector("[data-i]"); if(b) b.click(); } if(e.key === "Escape") $("results").hidden = true; });
function pickPlace(lat, lng, label){
  $("results").hidden = true; $("search").value = ""; $("search").blur();
  if(mode === "placing"){ startEditor(null, lat, lng); moveDraft(lat, lng, label); return; }
  if(mode === "editing"){ moveDraft(lat, lng, label); focusOn(lat, lng, 17); return; }
  if(searchMarker) map.removeLayer(searchMarker);
  const div = document.createElement("div");
  div.innerHTML = `<b>${esc(label)}</b><button class="btn small">Add a memory here</button>`;
  div.querySelector("button").addEventListener("click", () => { map.removeLayer(searchMarker); searchMarker = null; startEditor(null, lat, lng); moveDraft(lat, lng, label); });
  searchMarker = L.marker([lat,lng], {icon:pinIcon("#1B2430")}).addTo(map).bindPopup(div).openPopup();
  map.setView([lat,lng], 17);
}

/* ---------- My location ---------- */
function locate(fly=true){
  return new Promise(res => {
    if(!navigator.geolocation){ toast("This browser can't share your location."); return res(false); }
    $("locateBtn").classList.add("on");
    navigator.geolocation.getCurrentPosition(pos => {
      here = {lat:pos.coords.latitude, lng:pos.coords.longitude};
      if(meMarker) meMarker.setLatLng([here.lat,here.lng]);
      else meMarker = L.marker([here.lat,here.lng], {icon:L.divIcon({className:"", html:'<div class="me"></div>', iconSize:[16,16], iconAnchor:[8,8]}), interactive:false}).addTo(map);
      if(fly) map.setView([here.lat,here.lng], 14);
      const near = memories.filter(m => miles(here,m) < 0.25);
      if(near.length) toast(near.length === 1 ? `You're near "${near[0].title}"` : `You're near ${near.length} memories`);
      renderList(); res(true);
    }, () => { $("locateBtn").classList.remove("on"); toast("Location is off. Allow location for this page in your browser settings."); res(false); },
    {enableHighAccuracy:true, timeout:10000, maximumAge:60000});
  });
}
$("locateBtn").addEventListener("click", () => locate(true));
$("fitBtn").addEventListener("click", () => fitAll());

/* ---------- Plan a visit ---------- */
function startTrip(){
  tripMode = true; tripPick.clear();
  $("tripbar").hidden = false; $("foot").hidden = true;
  if(mqPhone.matches) sheetSize("tall");
  updateTrip(); renderList();
}
function endTrip(){ tripMode = false; tripPick.clear(); $("tripbar").hidden = true; $("foot").hidden = false; renderList(); }
function updateTrip(){
  const n = tripPick.size;
  $("tripCount").textContent = n ? `${n} ${n===1?"stop":"stops"} picked` : "Pick the places to visit";
  $("tripGo").disabled = n === 0;
}
$("tripBtn").addEventListener("click", () => { $("menu").hidden = true; startTrip(); });
$("tripCancel").addEventListener("click", endTrip);
$("tripGo").addEventListener("click", () => {
  // Order stops by always going to the closest unvisited one next
  let left = memories.filter(m => tripPick.has(m.id));
  const order = [];
  let cur = here || left[0];
  while(left.length){
    left.sort((a,b) => miles(cur,a) - miles(cur,b));
    cur = left.shift(); order.push(cur);
  }
  const stops = order.slice(0, 10).map(m => `${m.lat},${m.lng}`);
  const url = "https://www.google.com/maps/dir/" + (here ? "My+Location/" : "") + stops.join("/");
  window.open(url, "_blank", "noopener");
  if(order.length > 10) toast("Google Maps takes up to 10 stops, so the first 10 were used.");
});

/* ---------- Backup, restore, moving memories ---------- */
$("menuBtn").addEventListener("click", e => { e.stopPropagation(); $("menu").hidden = !$("menu").hidden; });
document.addEventListener("click", e => { if(!e.target.closest("#menu")) $("menu").hidden = true; if(!e.target.closest(".mapsearch")) $("results").hidden = true; });
const blobToDataURL = b => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });

// Copy memories into the current backend, giving their photos keys that fit it
async function importMemories(list, getBlob, onProgress){
  let done = 0;
  for(const src of list){
    const m = {...src, example:false};
    const newPhotos = [];
    for(const old of src.photos || []){
      const blob = await getBlob(old);
      if(!blob) continue;
      const base = String(old).split("/").pop().replace(/\.jpg$/,"");
      newPhotos.push({key:backend.photoKey(m.id, base), blob});
    }
    m.photos = newPhotos.map(p => p.key);
    await backend.save(m, newPhotos, []);
    done++; if(onProgress) onProgress(done, list.length);
  }
}
async function backup(){
  $("menu").hidden = true;
  toast("Preparing your backup…");
  try{
    const list = memories.filter(m => !m.example);
    const photos = [];
    for(const m of list) for(const k of m.photos){ const b = await backend.photoBlob(k); if(b) photos.push({id:k, data: await blobToDataURL(b)}); }
    const data = {app:"family-story-map", version:1, exported:new Date().toISOString(), memories:list, photos};
    const blob = new Blob([JSON.stringify(data)], {type:"application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `family-map-backup-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast("Backup saved to your downloads");
  }catch(err){ toast("Couldn't make the backup. Check your connection and try again."); }
}
$("exportBtn").addEventListener("click", backup);
$("footBackup").addEventListener("click", backup);
$("importFile").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; $("menu").hidden = true;
  if(!f) return;
  let data;
  try{ data = JSON.parse(await f.text()); if(data.app !== "family-story-map" || !Array.isArray(data.memories)) throw 0; }
  catch(err){ toast("That file isn't a Family Story Map backup."); return; }
  const byId = new Map((data.photos||[]).map(p => [p.id, p.data]));
  try{
    await importMemories(data.memories, async k => byId.has(k) ? (await fetch(byId.get(k))).blob() : null, (d,n) => toast(`Restoring ${d} of ${n}…`));
    await reload();
    fitAll();
    toast(`Restored ${data.memories.length} memories`);
  }catch(err){ await reload(); toast("Some memories couldn't be restored. Check your connection and try again."); }
});
async function clearExamples(){
  for(const m of memories.filter(m => m.example)) await Local.remove(m);
  memories = memories.filter(m => !m.example);
  $("menu").hidden = true;
  renderAll(); fitAll(); toast("Examples removed");
}
$("clearExamplesBtn").addEventListener("click", clearExamples);
$("exampleNoteClear").addEventListener("click", clearExamples);

/* ---------- Lightbox / keys ---------- */
$("lightClose").addEventListener("click", () => $("lightbox").hidden = true);
$("lightbox").addEventListener("click", e => { if(e.target.id === "lightbox") $("lightbox").hidden = true; });
document.addEventListener("keydown", e => {
  if(e.key !== "Escape") return;
  if(!$("lightbox").hidden){ $("lightbox").hidden = true; return; }
  if(mode === "placing"){ mode = "browse"; setBanner(null); return; }
  if(!$("panelView").hidden && document.activeElement.tagName !== "TEXTAREA") $("panelView").querySelector('[data-act="back"],[data-act="cancel"]')?.click();
});

/* ---------- Loading memories ---------- */
async function reload(){
  memories = await backend.list();
  renderAll();
  // Keep an open memory up to date when someone else changes it
  if(mode === "browse" && selectedId && !$("panelView").hidden){
    if(memories.some(m => m.id === selectedId)) openMemory(selectedId, {stay:true});
    else { closePanel(); toast("That memory was deleted by someone in the family."); }
  }
}

/* ---------- Sign-in (cloud mode) ---------- */
function lock(on){ $("app").classList.toggle("locked", on); }
function gate(html){
  lock(true);
  showView("gate");
  $("gateView").innerHTML = `<div class="head"><div class="brand"><h1>Family Story Map</h1><p>Our family's places and the stories behind them</p></div></div><div class="gate">${html}</div>`;
  if(mqPhone.matches) sheetSize("tall");
}
let pendingEmail = lsGet("fsm-pending-email") || "";
function showSignIn(errMsg){
  gate(`
    <h2>Sign in to your family map</h2>
    <p>Enter your email and we'll send you a sign-in code. No password needed.</p>
    <label class="lbl" for="g-email">Email
      <input class="field" id="g-email" type="email" autocomplete="email" inputmode="email" value="${esc(pendingEmail)}" placeholder="you@example.com"></label>
    ${errMsg ? `<div class="err">${esc(errMsg)}</div>` : ""}
    <button class="btn" id="g-send">Email me a sign-in code</button>
    ${pendingEmail ? `<button class="linkbtn" id="g-have">I already have a code</button>` : ""}`);
  const send = async () => {
    const email = $("g-email").value.trim().toLowerCase();
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ showSignIn("Enter a full email address, like name@gmail.com."); return; }
    $("g-send").disabled = true; $("g-send").textContent = "Sending…";
    const {error} = await sb.auth.signInWithOtp({email, options:{emailRedirectTo: location.origin + location.pathname}});
    if(error){
      const msg = /rate|seconds|too many/i.test(error.message) ? "Too many sign-in emails were sent just now. Wait a few minutes and try again." : "Couldn't send the email. Check the address and your connection.";
      showSignIn(msg); return;
    }
    pendingEmail = email; lsSet("fsm-pending-email", email);
    showCode();
  };
  $("g-send").addEventListener("click", send);
  $("g-email").addEventListener("keydown", e => { if(e.key === "Enter") send(); });
  $("g-have")?.addEventListener("click", () => showCode());
}
function showCode(errMsg){
  gate(`
    <h2>Check your email</h2>
    <p>We sent a code to <b>${esc(pendingEmail)}</b>. Type it here, or tap the sign-in link in the email.</p>
    <label class="lbl" for="g-code">Sign-in code
      <input class="field code" id="g-code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="123456"></label>
    ${errMsg ? `<div class="err">${esc(errMsg)}</div>` : ""}
    <button class="btn" id="g-verify">Sign in</button>
    <p>Not there? Check your spam folder. It can take a minute to arrive.</p>
    <button class="linkbtn" id="g-back">Use a different email or send a new code</button>`);
  const verify = async () => {
    const token = $("g-code").value.replace(/\D/g, "");
    if(token.length < 6){ showCode("Enter the whole code from the email."); return; }
    $("g-verify").disabled = true; $("g-verify").textContent = "Signing in…";
    const {error} = await sb.auth.verifyOtp({email:pendingEmail, token, type:"email"});
    if(error) showCode("That code didn't work. It may have expired, so send a new one.");
  };
  $("g-verify").addEventListener("click", verify);
  $("g-code").addEventListener("keydown", e => { if(e.key === "Enter") verify(); });
  $("g-back").addEventListener("click", () => showSignIn());
  setTimeout(() => $("g-code")?.focus(), 50);
}
function showNotInvited(){
  gate(`
    <h2>You're not on this map yet</h2>
    <p>You're signed in as <b>${esc(me.email)}</b>, but this map is private to invited family.</p>
    <p>Ask someone already on the map to add this email under <b>Family members</b>, then come back here.</p>
    <button class="btn" id="g-retry">Check again</button>
    <button class="linkbtn" id="g-out">Sign in with a different email</button>`);
  $("g-retry").addEventListener("click", () => enterSession(true));
  $("g-out").addEventListener("click", signOut);
}
async function signOut(){
  $("menu").hidden = true;
  await sb.auth.signOut();
}
$("signOutBtn").addEventListener("click", signOut);

let sessionUser = null, channel = null;
async function enterSession(force){
  const {data:{session}} = await sb.auth.getSession();
  const u = session ? session.user : null;
  if(!force && (u ? u.id : null) === (sessionUser ? sessionUser.id : null)) return;
  sessionUser = u;
  if(channel){ sb.removeChannel(channel); channel = null; }
  if(!u){ me = null; memories = []; renderAll(); showSignIn(); return; }
  me = {id:u.id, email:(u.email||"").toLowerCase()};
  lsSet("fsm-pending-email", "");
  const {data:member, error} = await sb.from("members").select("role").eq("email", me.email).maybeSingle();
  if(error){ gate(`<h2>Can't reach the family map</h2><p>Check your internet connection, then try again.</p><button class="btn" id="g-retry">Try again</button>`); $("g-retry").addEventListener("click", () => enterSession(true)); return; }
  if(!member){ showNotInvited(); return; }
  myRole = member.role;
  lock(false); showView("list"); sheetSize(null);
  $("familyBtn").hidden = false; $("signOutBtn").hidden = false;
  $("signedInAs").textContent = "Signed in as " + me.email;
  $("footText").textContent = "Shared with your family. Changes show up for everyone.";
  try{ await reload(); fitAll(false); }
  catch(err){ toast("Couldn't load the family map. Check your connection."); }
  // Live updates when anyone in the family adds or changes a memory
  let t;
  channel = sb.channel("family-memories")
    .on("postgres_changes", {event:"*", schema:"public", table:"memories"}, () => { clearTimeout(t); t = setTimeout(() => reload().catch(() => {}), 400); })
    .subscribe();
  offerMigration();
}

/* ---------- Moving this device's memories to the family map ---------- */
async function offerMigration(){
  const local = (await Local.list()).filter(m => !m.example);
  const flag = "fsm-migrated-" + me.id;
  if(!local.length || lsGet(flag)) { $("migrateNote").hidden = true; return; }
  $("migrateCount").textContent = `${local.length} ${local.length === 1 ? "memory is" : "memories are"}`;
  $("migrateNote").hidden = false;
  $("migrateBtn").onclick = async () => {
    $("migrateBtn").disabled = true;
    try{
      await importMemories(local, k => Local.photoBlob(k), (d,n) => toast(`Adding ${d} of ${n}…`));
      lsSet(flag, "1"); $("migrateNote").hidden = true;
      await reload(); fitAll();
      toast("Your memories are on the family map now");
    }catch(err){ $("migrateBtn").disabled = false; toast("Some memories didn't upload. Check your connection and tap Add them again."); }
  };
}

/* ---------- Family members ---------- */
const appLink = () => location.origin + location.pathname;
async function openFamily(){
  $("menu").hidden = true;
  mode = "browse"; selectedId = null; clearDraft(); setBanner(null);
  showPanel(`
    <div class="ptop"><button class="iconbtn" data-act="back" aria-label="Back to all memories">${ICON.back}</button><span class="grow">Family members</span></div>
    <div class="pscroll"><div class="pbody">
      <h2>Who's on the map</h2>
      <p class="story" style="font-size:15px">Everyone here can see, add and edit memories.</p>
      <ul class="people" id="memberList"><li><span>Loading…</span></li></ul>
      <label class="lbl" for="inviteEmail">Invite someone by email
        <input class="field" id="inviteEmail" type="email" inputmode="email" placeholder="aunt.rosa@example.com"></label>
      <div class="actions"><button class="btn" data-act="invite">Add to the map</button></div>
      <p class="story" style="font-size:14px;color:var(--muted)">Adding someone doesn't send them anything. Send them this link and tell them to sign in with the email you added:</p>
      <div class="copyrow"><code id="shareLink">${esc(appLink())}</code><button class="btn ghost small" data-act="copylink">Copy</button></div>
    </div></div>`);
  if(mqPhone.matches) sheetSize("tall");
  $("inviteEmail").addEventListener("keydown", e => { if(e.key === "Enter") inviteMember(); });
  renderMembers();
}
$("familyBtn").addEventListener("click", openFamily);
async function renderMembers(){
  const {data, error} = await sb.from("members").select("email, role").order("added_at");
  const ul = $("memberList"); if(!ul) return;
  if(error){ ul.innerHTML = `<li><span>Couldn't load the list. Check your connection.</span></li>`; return; }
  ul.innerHTML = data.map(p => `<li><span>${esc(p.email)}${p.email === me.email ? " (you)" : ""}</span>
    ${p.role === "owner" ? '<span class="badge">Owner</span>' : myRole === "owner" ? `<button class="btn ghost small" data-unmember="${esc(p.email)}">Remove</button>` : ""}</li>`).join("");
}
async function inviteMember(){
  const inp = $("inviteEmail");
  const email = inp.value.trim().toLowerCase();
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ toast("Enter a full email address."); inp.focus(); return; }
  const {error} = await sb.from("members").insert({email, role:"member"});
  if(error && error.code === "23505"){ toast("They're already on the map."); return; }
  if(error){ toast("Couldn't add them. Check your connection and try again."); return; }
  inp.value = "";
  toast(`Added ${email}. Send them the link.`);
  renderMembers();
}
async function removeMember(email){
  const {error} = await sb.from("members").delete().eq("email", email);
  if(error){ toast("Couldn't remove them. Check your connection."); return; }
  toast(`Removed ${email}`);
  renderMembers();
}
async function copyLink(){
  try{ await navigator.clipboard.writeText(appLink()); toast("Link copied"); }
  catch(e){ const r = document.createRange(); r.selectNodeContents($("shareLink")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast("Link selected. Copy it from here."); }
}

/* ---------- Start ---------- */
(async function init(){
  idb = await openDB();
  if(CLOUD_ON){
    if(!window.supabase){ gate(`<h2>Can't reach the family map</h2><p>Check your internet connection, then reload the page.</p>`); return; }
    backend = Cloud;
    sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {auth:{persistSession:true, autoRefreshToken:true, detectSessionInUrl:true}});
    // Supabase calls inside this callback can stall, so handle the change on the next tick
    sb.auth.onAuthStateChange(() => setTimeout(() => enterSession(false), 0));
    await enterSession(true);
    return;
  }
  if(!idb) $("storageWarn").hidden = false;
  memories = await Local.list();
  if(!memories.length && !lsGet("fsm-seeded")){
    const now = Date.now();
    for(const [i,e] of EXAMPLES.entries()){
      const m = {...e, id:"example-"+i, photos:[], example:true, created:now+i, updated:now+i};
      await put("memories", m); memories.push(m);
    }
    lsSet("fsm-seeded","1");
  }
  renderAll();
  fitAll(false);
})();
})();

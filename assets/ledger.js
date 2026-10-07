/* Budget ledger: the Home page. Entries, budgets, import and export. */
(function(){
'use strict';

/* ---------- small helpers ---------- */
const $ = (s, r) => (r || document).querySelector(s);
function h(tag, props){
  const n = document.createElement(tag);
  if (props) for (const k in props){
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.slice(0,2) === 'on') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (let i = 2; i < arguments.length; i++){
    const c = arguments[i];
    if (c == null || c === false || c === '') continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}
const SVGNS = 'http://www.w3.org/2000/svg';
function s(tag, attrs){
  const n = document.createElementNS(SVGNS, tag);
  if (attrs) for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
  for (let i = 2; i < arguments.length; i++){ const c = arguments[i]; if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return n;
}
const clone = o => JSON.parse(JSON.stringify(o));
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const todayStr = () => ymd(new Date());
const monthOf = ds => ds.slice(0, 7);
function shiftMonth(ym, delta){
  let y = +ym.slice(0,4), m = +ym.slice(5,7) + delta;
  while (m < 1){ m += 12; y--; } while (m > 12){ m -= 12; y++; }
  return y + '-' + pad(m);
}
const daysIn = ym => new Date(+ym.slice(0,4), +ym.slice(5,7), 0).getDate();
const monthName = (ym, opts) => new Date(+ym.slice(0,4), +ym.slice(5,7) - 1, 1).toLocaleDateString('en-US', opts || {month:'long'});
const longMonth = ym => monthName(ym, {month:'long', year:'numeric'});
const fmt = new Intl.NumberFormat('en-US', {style:'currency', currency:'USD'});
const money = n => fmt.format(n);
const cents = n => Math.round(n * 100);
function parseAmount(str){
  let t = String(str == null ? '' : str).trim();
  if (!t) return NaN;
  const neg = /^\(.*\)$/.test(t) || /^[-\u2212]/.test(t.replace(/^[^\d(\-\u2212]+/, ''));
  t = t.replace(/[^0-9.]/g, '');
  if (!t || t.split('.').length > 2) return NaN;
  const n = parseFloat(t);
  if (!isFinite(n)) return NaN;
  return (Math.round(n * 100) / 100) * (neg ? -1 : 1);
}
let seq = 0;
const newId = () => Date.now().toString(36) + (seq++ % 1296).toString(36).padStart(2,'0') + Math.random().toString(36).slice(2, 6);
const ord = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th','st','nd','rd','th','th','th','th','th','th'][n % 10]);
const radio = name => { const r = document.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : 'expense'; };
const setRadio = (name, v) => { const r = document.querySelector('input[name="' + name + '"][value="' + v + '"]'); if (r) r.checked = true; };

/* ---------- state ---------- */
// One budget per signed-in account.
let displayName = '';
const books = {me:{settings:null, months:{}}};
let settings = null;            // {categories:[{id,name,kind,budget}], recurring:[{id,name,amount,kind,categoryId,day,since}]}
let months = books.me.months;   // 'YYYY-MM' -> {items:[{id,date,amount,kind,categoryId,note,recurringId?}], skipped:[recurringId]}
function alias(){ settings = books.me.settings; months = books.me.months; }
function bind(){ if (!books.me.settings) books.me.settings = defaultSettings(); alias(); }
let view = monthOf(todayStr());
let filterCat = null;           // 'expense|<id>' etc.
let mode = 'loading';           // loading | cloud | local | loadfail
let ready = false;
let flashId = null, catTouched = false, erasing = false;

function defaultSettings(){ return Shell.starterSettings(); }
function normSettings(d){
  d = d || {};
  const cats = Array.isArray(d.categories) ? d.categories.filter(c => c && c.id && c.name) : [];
  cats.forEach(c => { c.kind = c.kind === 'income' ? 'income' : 'expense'; c.budget = +c.budget > 0 ? +c.budget : 0; c.name = String(c.name); });
  const rec = Array.isArray(d.recurring) ? d.recurring.filter(r => r && r.id) : [];
  return {categories:cats, recurring:rec};
}
function normMonth(d){
  d = d || {};
  const items = Array.isArray(d.items) ? d.items.filter(i => i && i.id && typeof i.date === 'string' && isFinite(+i.amount)) : [];
  items.forEach(i => { i.amount = +i.amount; i.kind = i.kind === 'income' ? 'income' : 'expense'; i.note = i.note ? String(i.note) : ''; i.categoryId = i.categoryId || ''; });
  return {items:items, skipped:Array.isArray(d.skipped) ? d.skipped : []};
}
const monthData = ym => months[ym] || {items:[], skipped:[]};
const ensureMonth = ym => months[ym] || (months[ym] = {items:[], skipped:[]});
const catById = id => settings.categories.find(c => c.id === id) || null;
const catsOf = kind => settings.categories.filter(c => c.kind === kind);
function catKey(it){ const c = catById(it.categoryId); return it.kind + '|' + (c && c.kind === it.kind ? c.id : ''); }
function catLabel(it){ const c = catById(it.categoryId); return c && c.kind === it.kind ? c.name : 'Uncategorized'; }
function totals(ym){
  let inc = 0, exp = 0; const by = {};
  for (const it of monthData(ym).items){
    const c = cents(it.amount);
    if (it.kind === 'income') inc += c; else exp += c;
    const k = catKey(it); by[k] = (by[k] || 0) + c;
  }
  return {inc:inc, exp:exp, by:by};
}

/* ---------- saving ---------- */
const TABLE = 'ledger_docs';
const sb = Shell.sb, showToast = Shell.toast, hideToast = Shell.hideToast;
let uid = null;
const dirty = new Set(), failed = new Set();
let writing = null, gen = 0, lastSync = 0, syncing = false;
const busy = key => writing === key || dirty.has(key) || failed.has(key);
const settle = q => Promise.resolve(q).then(r => r || {}, e => ({error:e}));
function bodyFor(key){
  if (key === 'settings') return clone(settings);
  const m = monthData(key.slice(2));
  return clone({items:m.items, skipped:m.skipped || []});
}
function save(key){
  if (mode !== 'cloud') return;
  gen++; failed.delete(key); dirty.add(key); pump();
}
function pump(){
  if (writing || !dirty.size){ paintStatus(); return; }
  const key = dirty.values().next().value;
  dirty.delete(key); writing = key; paintStatus();
  write(key, 0);
}
function write(key, tries){
  const forUid = uid;
  let q;
  try { q = sb.from(TABLE).upsert({user_id:forUid, key:key, body:bodyFor(key), updated_at:new Date().toISOString()}, {onConflict:'user_id,key'}); }
  catch (e) { q = {error:e}; }
  settle(q).then(function(res){
    if (uid !== forUid) return;                       // signed out while this was in flight
    if (!res.error){ writing = null; pump(); return; }
    const st = res.status || 0;
    if (tries < 1 && (!st || st >= 500 || st === 408 || st === 429)){
      setTimeout(function(){ if (uid === forUid) write(key, tries + 1); }, 700 + Math.random() * 900); return;
    }
    failed.add(key); writing = null; pump();
  });
}
function retrySave(){ const keys = Array.from(failed); failed.clear(); keys.forEach(k => dirty.add(k)); pump(); }
function paintStatus(){
  const el = $('#status'); el.textContent = '';
  if (mode === 'loading') el.textContent = 'Loading';
  else if (mode === 'cloud'){
    if (failed.size){
      el.append(h('span', {class:'bad'}, 'Recent changes are not saved. Check your connection.'), ' ',
        h('button', {class:'linkbtn', type:'button', onclick:retrySave}, 'Save again'));
    } else el.textContent = (writing || dirty.size) ? 'Saving' : 'Saved';
  }
}
function applyRow(key, body){
  const data = clone(body || {});
  if (key === 'settings'){
    const n = normSettings(data);
    if (books.me.settings && JSON.stringify(n) === JSON.stringify(books.me.settings)) return false;
    books.me.settings = n; alias(); return true;
  }
  if (/^m-\d{4}-\d{2}$/.test(key)){
    const ym = key.slice(2), n = normMonth(data);
    if (months[ym] && JSON.stringify(n) === JSON.stringify(months[ym])) return false;
    months[ym] = n; return true;
  }
  return false;
}
// Pick up changes made on another device whenever this one comes back into view.
async function refresh(){
  if (mode !== 'cloud' || syncing || erasing || writing || dirty.size || failed.size) return;
  if (Date.now() - lastSync < 4000) return;
  syncing = true;
  const forUid = uid, forGen = gen;
  const res = await settle(sb.from(TABLE).select('key,body').eq('user_id', forUid));
  syncing = false;
  if (uid !== forUid || gen !== forGen || res.error || !Array.isArray(res.data)) return;   // something changed here meanwhile
  lastSync = Date.now();
  let changed = false; const seen = new Set();
  res.data.forEach(r => { seen.add(r.key); if (applyRow(r.key, r.body)) changed = true; });
  Object.keys(months).forEach(ym => { if (!seen.has('m-' + ym)){ delete months[ym]; changed = true; } });
  if (changed) renderAll();
}
document.addEventListener('visibilitychange', function(){ if (!document.hidden) refresh(); });
window.addEventListener('focus', refresh);
window.addEventListener('beforeunload', function(e){ if (uid && (writing || dirty.size)){ e.preventDefault(); e.returnValue = ''; } });

/* ---------- account ---------- */
// Sign-in, the header and the menu live in assets/shell.js. This page only reacts to them.
let wantCats = new URLSearchParams(location.search).get('open') === 'categories';
function resetBooks(){
  books.me = {settings:null, months:{}}; settings = null; months = books.me.months;
  dirty.clear(); failed.clear(); writing = null; filterCat = null; gen++;
}
function onEnter(user){
  uid = user.id;
  displayName = Shell.nameOf(user);
  resetBooks(); view = monthOf(todayStr());
  load();
}
async function load(){
  const forUid = uid;
  mode = 'loading'; ready = false; renderAll();
  const res = await settle(sb.from(TABLE).select('key,body').eq('user_id', forUid));
  if (uid !== forUid) return;
  if (res.error || !Array.isArray(res.data)){ mode = 'loadfail'; renderAll(); return; }
  res.data.forEach(r => applyRow(r.key, r.body));
  bind(); mode = 'cloud'; ready = true; lastSync = Date.now();
  const sel = $('#aCat'); sel.textContent = ''; sel.dataset.sig = '';
  syncDate(); renderAll();
  // An account still on the starter categories has nothing saved for them yet. Save
  // them once, so its entries keep their category names wherever they are read.
  if (!res.data.some(r => r.key === 'settings')) save('settings');
  if (wantCats){
    wantCats = false;
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
    openCats();
  }
}
function onLeave(){
  uid = null; displayName = ''; resetBooks(); ready = false; mode = 'loading';
  renderAll();
}

/* ---------- rendering ---------- */
function renderAll(){
  $('#monthLabel').textContent = longMonth(view);
  $('#thisM').hidden = view === monthOf(todayStr());
  $('#aAdd').disabled = !ready;
  paintStatus();
  renderHero();
  if (!ready){ $('#ledger').textContent = ''; $('#budget').textContent = ''; $('#trend').textContent = ''; $('#due').hidden = true; return; }
  fillCatSelect($('#aCat'), radio('aKind'), undefined, true);
  renderNotes(); renderDue(); renderLedger(); renderBudget(); renderTrend();
}
function renderHero(){
  const box = $('#hero'); box.textContent = '';
  if (mode === 'loading'){ box.append(h('h1', {class:'say'}, 'Loading your budget')); return; }
  if (mode === 'loadfail'){
    box.append(h('h1', {class:'say'}, 'Your budget did not load.'),
      h('p', {class:'plan'}, 'Check your connection, then load it again. Nothing has been changed.'),
      h('button', {class:'btn primary', type:'button', onclick:load}, 'Load again'));
    return;
  }
  const t = totals(view), name = monthName(view);
  if (!t.inc && !t.exp){
    box.append(h('h1', {class:'say'}, displayName ? displayName + ' has nothing logged for ' + name + ' yet.' : 'Nothing logged for ' + name + ' yet.'),
      h('p', {class:'plan'}, 'Add what came in or went out below. The totals, budget bars and chart fill themselves in.'));
    return;
  }
  box.append(h('h1', {class:'say'}, (displayName ? displayName + '\u2019s ' + name + ': ' : 'In ' + name + ', ') + money(t.inc / 100) + ' came in and ' + money(t.exp / 100) + ' went out.'));
  const left = t.inc - t.exp;
  box.append(h('p', {class:'result' + (left < 0 ? ' short' : '')}, h('span', null, money(Math.abs(left) / 100)), left < 0 ? ' short' : ' left'));
  let plan = 0, used = 0;
  catsOf('expense').forEach(c => { if (c.budget > 0){ plan += cents(c.budget); used += t.by['expense|' + c.id] || 0; } });
  if (plan > 0){
    const room = plan - used, rest = t.exp - used;
    box.append(h('p', {class:'plan'}, 'Your budgets add up to ' + money(plan / 100) + ', and ' +
      (room >= 0 ? money(room / 100) + ' of that is unspent.' : 'spending in those categories is ' + money(-room / 100) + ' past it.') +
      (rest > 0 ? ' Another ' + money(rest / 100) + ' went to categories without a budget.' : '')));
  }
}
function fillCatSelect(sel, kind, value, withNew){
  const cats = catsOf(kind);
  const sig = kind + '|' + cats.map(c => c.id + ':' + c.name).join(',') + '|' + (withNew ? 1 : 0);
  const fresh = !sel.options.length;
  const want = value !== undefined ? value : (fresh ? '__first' : sel.value);
  if (sel.dataset.sig !== sig){
    sel.textContent = '';
    cats.forEach(c => sel.append(h('option', {value:c.id}, c.name)));
    sel.append(h('option', {value:''}, 'Uncategorized'));
    if (withNew) sel.append(h('option', {value:'__new'}, 'New category'));
    sel.dataset.sig = sig;
  }
  const ok = Array.from(sel.options).some(o => o.value === want && want !== '__new');
  sel.value = ok ? want : (cats[0] ? cats[0].id : '');
}
let notesSig = '';
function allItems(){ const out = []; for (const ym in months) for (const it of months[ym].items) out.push(it); return out; }
function renderNotes(){
  const seen = new Set(), list = [];
  allItems().sort((a, b) => a.date < b.date ? 1 : -1).forEach(it => { const k = it.note.trim().toLowerCase(); if (k && !seen.has(k) && list.length < 80){ seen.add(k); list.push(it.note.trim()); } });
  const sig = list.join('\n');
  if (sig === notesSig) return;
  notesSig = sig;
  const dl = $('#notes'); dl.textContent = '';
  list.forEach(n => dl.append(h('option', {value:n})));
}
function dueList(){
  const m = monthData(view);
  const have = new Set(m.items.map(i => i.recurringId).filter(Boolean)), skip = new Set(m.skipped || []);
  return settings.recurring.filter(r => (r.since || '0000-00') <= view && !have.has(r.id) && !skip.has(r.id));
}
function renderDue(){
  const box = $('#due'), list = dueList();
  box.textContent = ''; box.hidden = !list.length;
  if (!list.length) return;
  box.append(h('div', {class:'sheethead'}, h('h2', {id:'dueTitle'}, 'Repeating entries not logged for ' + monthName(view)),
    list.length > 1 ? h('button', {class:'btn small', type:'button', onclick:function(){ list.forEach(r => logRecurring(r, true)); save('m-' + view); renderAll(); showToast('Logged ' + list.length + ' entries'); }}, 'Log all ' + list.length) : null));
  list.forEach(r => {
    const c = catById(r.categoryId);
    box.append(h('div', {class:'duerow'},
      h('div', {class:'grow'}, h('strong', null, r.name || (c ? c.name : 'Entry')), h('small', null, (r.kind === 'income' ? 'Money in' : 'Money out') + ', ' + (c ? c.name : 'Uncategorized') + ', on the ' + ord(Math.min(r.day || 1, daysIn(view))))),
      h('span', {class:'ramt' + (r.kind === 'income' ? ' in' : '')}, (r.kind === 'income' ? '+' : '') + money(r.amount)),
      h('button', {class:'btn small primary', type:'button', onclick:function(){ logRecurring(r); }}, 'Log it'),
      h('button', {class:'btn small', type:'button', onclick:function(){ const m = ensureMonth(view); m.skipped = (m.skipped || []).concat(r.id); save('m-' + view); renderAll(); }}, 'Skip this month')));
  });
}
function logRecurring(r, quiet){
  const it = {id:newId(), date:view + '-' + pad(Math.min(r.day || 1, daysIn(view))), amount:r.amount, kind:r.kind, categoryId:r.categoryId || '', note:r.name || '', recurringId:r.id};
  ensureMonth(view).items.push(it);
  if (!quiet){ flashId = it.id; save('m-' + view); renderAll(); }
}
function renderLedger(){
  const box = $('#ledger'), fn = $('#filterNote');
  box.textContent = ''; fn.textContent = '';
  let items = monthData(view).items.slice();
  const any = items.length > 0;
  if (filterCat !== null){
    items = items.filter(i => catKey(i) === filterCat);
    const c = catById(filterCat.split('|')[1]);
    fn.append('Showing ' + (c ? c.name : 'uncategorized') + ' only. ', h('button', {class:'linkbtn', type:'button', onclick:function(){ filterCat = null; renderAll(); }}, 'Show all entries'));
  }
  if (!items.length){
    box.append(h('p', {class:'empty'}, any ? 'No entries in this category for ' + monthName(view) + '.' : 'No entries for ' + monthName(view) + ' yet. Add one above, or bring in rows from your old sheet with Import from a sheet.'));
    return;
  }
  items.sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : (a.id < b.id ? 1 : -1));
  const list = h('div', {class:'ledger'});
  let g = -1, last = null;
  items.forEach(it => {
    const first = it.date !== last; if (first){ g++; last = it.date; }
    const d = new Date(it.date + 'T00:00:00');
    const cat = catLabel(it), main = it.note || cat;
    const rep = it.recurringId && settings.recurring.some(r => r.id === it.recurringId);
    const sub = (it.note ? cat : '') + (rep ? (it.note ? ', ' : '') + 'repeats monthly' : '');
    const amt = (it.kind === 'income' ? '+' : '') + money(it.amount);
    list.append(h('button', {class:'row' + (g % 2 ? ' band' : '') + (it.id === flashId ? ' new' : ''), type:'button',
        'aria-label': d.toLocaleDateString('en-US', {weekday:'long', month:'long', day:'numeric'}) + ', ' + main + ', ' + (it.kind === 'income' ? 'money in ' : 'money out ') + money(it.amount) + '. Edit entry.',
        onclick:function(){ openEdit(it.id, monthOf(it.date)); }},
      h('span', {class:'rdate'}, first ? d.toLocaleDateString('en-US', {weekday:'short'}) + ' ' + d.getDate() : ''),
      h('span', {class:'rmain'}, h('span', {class:'rnote'}, main), sub ? h('span', {class:'rsub'}, sub) : null),
      h('span', {class:'ramt' + (it.kind === 'income' ? ' in' : '')}, amt)));
  });
  box.append(list);
  flashId = null;
}
function renderBudget(){
  const box = $('#budget'); box.textContent = '';
  const t = totals(view), today = todayStr(), isCur = view === monthOf(today);
  const pace = isCur ? (+today.slice(8)) / daysIn(view) : null;
  function row(kind, id, name, budget){
    const key = kind + '|' + id, spent = t.by[key] || 0, b = cents(budget || 0);
    const btn = h('button', {class:'cat', type:'button', 'aria-pressed': filterCat === key ? 'true' : 'false', title:'Show only these entries',
      onclick:function(){ filterCat = filterCat === key ? null : key; renderAll(); }});
    btn.append(h('span', {class:'cattop'}, h('span', {class:'catname'}, name),
      h('span', {class:'catnum'}, b ? money(spent / 100) + ' of ' + money(b / 100) : money(spent / 100))));
    if (b){
      const over = spent > b, bar = h('span', {class:'bar' + (kind === 'income' ? ' in' : over ? ' over' : ''), style:'display:block'});
      const fill = h('i'); fill.style.width = Math.min(100, spent / b * 100) + '%'; bar.append(fill);
      if (pace !== null && kind === 'expense'){ const tick = h('b'); tick.style.left = 'calc(' + (pace * 100) + '% - 1px)'; bar.append(tick); }
      btn.append(bar);
      const txt = kind === 'income'
        ? (spent >= b ? 'Expected amount reached' : money((b - spent) / 100) + ' still expected')
        : (over ? money((spent - b) / 100) + ' over budget' : money((b - spent) / 100) + ' left');
      btn.append(h('span', {class:'catsub' + (over && kind === 'expense' ? ' over' : ''), style:'display:block'}, txt));
    }
    return btn;
  }
  const exp = catsOf('expense');
  exp.forEach(c => box.append(row('expense', c.id, c.name, c.budget)));
  if (t.by['expense|']) box.append(row('expense', '', 'Uncategorized', 0));
  if (!exp.length) box.append(h('p', {class:'empty'}, 'No money out categories yet.'));
  if (!exp.some(c => c.budget > 0)) box.append(h('p', {class:'hint'}, 'No budgets set yet. Give each category a monthly amount to see how much room is left.'));
  else if (pace !== null) box.append(h('p', {class:'hint'}, 'The small tick on each bar marks today. A bar past the tick is spending faster than the month is passing.'));
  box.append(h('h3', {class:'subhead'}, 'Money in'));
  catsOf('income').forEach(c => box.append(row('income', c.id, c.name, c.budget)));
  if (t.by['income|']) box.append(row('income', '', 'Uncategorized', 0));
  box.append(h('button', {class:'btn small panelbtn', type:'button', onclick:openCats}, exp.some(c => c.budget > 0) ? 'Edit categories and budgets' : 'Set budgets'));
}
function renderTrend(){
  const box = $('#trend'); box.textContent = '';
  const data = [];
  for (let i = 5; i >= 0; i--){ const ym = shiftMonth(view, -i), t = totals(ym); data.push({ym:ym, inc:t.inc / 100, exp:t.exp / 100}); }
  const max = Math.max.apply(null, data.map(d => Math.max(d.inc, d.exp)));
  if (!max){ box.append(h('p', {class:'empty'}, 'This chart fills in as you log entries, one pair of bars per month.')); return; }
  const W = 360, base = 112, H = 96, gw = W / 6;
  const svg = s('svg', {viewBox:'0 0 ' + W + ' 136', role:'group', 'aria-label':'Money in and money out for the last six months'});
  svg.append(s('line', {x1:0, y1:base + .5, x2:W, y2:base + .5, stroke:'var(--line)', 'stroke-width':1}));
  data.forEach((d, i) => {
    const x = i * gw + (gw - 36) / 2;
    const hi = d.inc ? Math.max(2, d.inc / max * H) : 0, he = d.exp ? Math.max(2, d.exp / max * H) : 0;
    if (hi) svg.append(s('rect', {x:x, y:base - hi, width:16, height:hi, fill:'var(--c-in)'}));
    if (he) svg.append(s('rect', {x:x + 20, y:base - he, width:16, height:he, fill:'var(--c-out)'}));
    const label = monthName(d.ym, {month:'short'});
    svg.append(s('text', {x:i * gw + gw / 2, y:129, 'text-anchor':'middle', class:d.ym === view ? 'cur' : null}, label));
    const desc = monthName(d.ym, {month:'long'}) + ': ' + money(d.inc) + ' in, ' + money(d.exp) + ' out';
    const hit = s('rect', {x:i * gw, y:0, width:gw, height:136, class:'hit', role:'button', tabindex:0, 'aria-label':desc + '. Show this month.'}, s('title', null, desc));
    hit.addEventListener('click', function(){ setView(d.ym); });
    hit.addEventListener('keydown', function(e){ if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); setView(d.ym); } });
    svg.append(hit);
  });
  box.append(svg, h('div', {class:'legend'},
    h('span', null, h('i', {style:'background:var(--c-in)'}), 'Money in'),
    h('span', null, h('i', {style:'background:var(--c-out)'}), 'Money out')));
}

/* ---------- month navigation ---------- */
function syncDate(){ const t = todayStr(); $('#aDate').value = monthOf(t) === view ? t : view + '-01'; }
function setView(ym){ if (ym === view) return; view = ym; syncDate(); renderAll(); }
$('#prevM').addEventListener('click', function(){ setView(shiftMonth(view, -1)); });
$('#nextM').addEventListener('click', function(){ setView(shiftMonth(view, 1)); });
$('#thisM').addEventListener('click', function(){ setView(monthOf(todayStr())); });

/* ---------- add an entry ---------- */
function addErr(msg, focusSel){ const e = $('#aErr'); e.textContent = msg || ''; e.hidden = !msg; if (msg && focusSel) $(focusSel).focus(); }
function addEntry(){
  if (!ready) return;
  const kind = radio('aKind'), amt = parseAmount($('#aAmt').value), date = $('#aDate').value;
  if (!(amt > 0)) return addErr('Enter an amount greater than zero, like 45.20.', '#aAmt');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return addErr('Pick a date for this entry.', '#aDate');
  addErr('');
  const note = $('#aNote').value.trim();
  let cat = $('#aCat').value; if (cat === '__new') cat = '';
  const it = {id:newId(), date:date, amount:amt, kind:kind, categoryId:cat, note:note};
  if ($('#aRepeat').checked){
    const c = catById(cat);
    const r = {id:newId(), name:note || (c ? c.name : 'Repeating entry'), amount:amt, kind:kind, categoryId:cat, day:+date.slice(8), since:monthOf(date)};
    settings.recurring.push(r); it.recurringId = r.id; save('settings');
  }
  const ym = monthOf(date);
  ensureMonth(ym).items.push(it); save('m-' + ym);
  $('#aAmt').value = ''; $('#aNote').value = ''; $('#aRepeat').checked = false; catTouched = false;
  flashId = it.id;
  renderAll();
  if (ym !== view) showToast('Added to ' + longMonth(ym) + '.', 'Show that month', function(){ setView(ym); });
  $('#aAmt').focus();
}
$('#aAdd').addEventListener('click', addEntry);
$('#addGrid').addEventListener('keydown', function(e){ if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'radio'){ e.preventDefault(); addEntry(); } });
document.querySelectorAll('input[name="aKind"]').forEach(r => r.addEventListener('change', function(){ catTouched = false; if (ready) fillCatSelect($('#aCat'), radio('aKind'), undefined, true); guessCat(); }));
$('#aCat').addEventListener('change', function(){
  if (this.value === '__new'){ fillCatSelect(this, radio('aKind'), undefined, true); openCats(); return; }
  catTouched = true;
});
function guessCat(){
  if (!ready || catTouched) return;
  const k = $('#aNote').value.trim().toLowerCase(); if (!k) return;
  const kind = radio('aKind');
  let best = null;
  for (const it of allItems()) if (it.kind === kind && it.note.trim().toLowerCase() === k && (!best || it.date > best.date)) best = it;
  if (best && catById(best.categoryId)) $('#aCat').value = best.categoryId;
}
$('#aNote').addEventListener('input', guessCat);

/* ---------- edit an entry ---------- */
let editing = null; // {id, ym}
function findItem(id, ym){ return monthData(ym).items.find(i => i.id === id) || null; }
function openEdit(id, ym){
  const it = findItem(id, ym); if (!it) return;
  editing = {id:id, ym:ym};
  setRadio('eKind', it.kind);
  $('#eAmt').value = it.amount.toFixed(2); $('#eDate').value = it.date; $('#eNote').value = it.note;
  const sel = $('#eCat'); sel.dataset.sig = '';
  fillCatSelect(sel, it.kind, catById(it.categoryId) ? it.categoryId : '', false);
  const e = $('#eErr'); e.hidden = true;
  $('#editDlg').showModal();
}
document.querySelectorAll('input[name="eKind"]').forEach(r => r.addEventListener('change', function(){ fillCatSelect($('#eCat'), radio('eKind'), undefined, false); }));
function saveEdit(){
  if (!editing) return;
  const it = findItem(editing.id, editing.ym); if (!it){ $('#editDlg').close(); return; }
  const amt = parseAmount($('#eAmt').value), date = $('#eDate').value, e = $('#eErr');
  if (!(amt > 0)){ e.textContent = 'Enter an amount greater than zero, like 45.20.'; e.hidden = false; $('#eAmt').focus(); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)){ e.textContent = 'Pick a date for this entry.'; e.hidden = false; $('#eDate').focus(); return; }
  it.amount = amt; it.kind = radio('eKind'); it.note = $('#eNote').value.trim(); it.categoryId = $('#eCat').value;
  const nym = monthOf(date);
  if (nym !== editing.ym){
    const m = ensureMonth(editing.ym); m.items = m.items.filter(i => i.id !== it.id);
    it.date = date; ensureMonth(nym).items.push(it);
    save('m-' + editing.ym); save('m-' + nym);
    showToast('Moved to ' + longMonth(nym) + '.', 'Show that month', function(){ setView(nym); });
  } else { it.date = date; save('m-' + nym); }
  flashId = it.id;
  $('#editDlg').close(); renderAll();
}
function deleteEdit(){
  if (!editing) return;
  const ym = editing.ym, m = ensureMonth(ym), idx = m.items.findIndex(i => i.id === editing.id);
  if (idx < 0){ $('#editDlg').close(); return; }
  const gone = m.items.splice(idx, 1)[0];
  save('m-' + ym); $('#editDlg').close(); renderAll();
  showToast('Deleted ' + (gone.note || catLabel(gone)) + ', ' + money(gone.amount) + '.', 'Undo', function(){
    ensureMonth(ym).items.push(gone); save('m-' + ym); flashId = gone.id; renderAll();
  });
}
$('#eSave').addEventListener('click', saveEdit);
$('#eDelete').addEventListener('click', deleteEdit);
$('#eCancel').addEventListener('click', function(){ $('#editDlg').close(); });
$('#editGrid').addEventListener('keydown', function(e){ if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'radio'){ e.preventDefault(); saveEdit(); } });
document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', function(e){ if (e.target === d) d.close(); }));

/* ---------- categories and budgets ---------- */
function catNote(msg, actionLabel, action){
  const n = $('#catNote'); n.textContent = ''; n.hidden = !msg; if (!msg) return;
  n.append(msg + ' ');
  if (actionLabel) n.append(h('button', {class:'linkbtn', type:'button', onclick:function(){ catNote(''); action(); }}, actionLabel));
}
function openCats(){ if (!ready) return; catNote(''); renderCats(); $('#catDlg').showModal(); }
function renderCats(){
  const box = $('#catBody'); box.textContent = '';
  ['expense', 'income'].forEach(kind => {
    const amtLabel = kind === 'expense' ? 'Monthly budget' : 'Expected per month';
    box.append(h('h3', null, kind === 'expense' ? 'Money out' : 'Money in'));
    box.append(h('div', {class:'cathead', 'aria-hidden':'true'}, h('span', null, 'Category'), h('span', null, amtLabel), h('span')));
    catsOf(kind).forEach(c => {
      const id = c.id;
      const name = h('input', {type:'text', maxlength:40, 'aria-label':'Category name'}); name.value = c.name;
      name.addEventListener('change', function(){
        const cur = catById(id), v = name.value.trim(); if (!cur) return;
        if (!v){ name.value = cur.name; return; }
        cur.name = v; save('settings'); renderAll();
      });
      const amt = h('input', {type:'text', class:'num', inputmode:'decimal', placeholder:'0.00', 'aria-label':amtLabel + ' for ' + c.name}); amt.value = c.budget ? c.budget.toFixed(2) : '';
      amt.addEventListener('change', function(){
        const cur = catById(id); if (!cur) return;
        const raw = amt.value.trim(), v = raw === '' ? 0 : parseAmount(raw);
        if (!(v >= 0)){ amt.value = cur.budget ? cur.budget.toFixed(2) : ''; catNote('That amount was not a number, so it was left as it was. Use digits, like 400.'); return; }
        cur.budget = v; amt.value = v ? v.toFixed(2) : ''; catNote(''); save('settings'); renderAll();
      });
      box.append(h('div', {class:'catrow'}, name, amt, h('button', {class:'btn small', type:'button', 'aria-label':'Remove ' + c.name, onclick:function(){ removeCat(id); }}, 'Remove')));
    });
    const nn = h('input', {type:'text', maxlength:40, placeholder:'New category name', 'aria-label':'New ' + (kind === 'expense' ? 'money out' : 'money in') + ' category name'});
    const add = function(){
      const v = nn.value.trim(); if (!v){ nn.focus(); return; }
      if (catsOf(kind).some(c => c.name.toLowerCase() === v.toLowerCase())){ catNote('There is already a category called ' + v + '.'); return; }
      settings.categories.push({id:'c-' + newId(), name:v, kind:kind, budget:0});
      catNote(''); save('settings'); renderCats(); renderAll();
    };
    nn.addEventListener('keydown', function(e){ if (e.key === 'Enter'){ e.preventDefault(); add(); } });
    box.append(h('div', {class:'addcat'}, nn, h('button', {class:'btn small', type:'button', onclick:add}, 'Add category')));
  });
  box.append(h('h3', null, 'Repeating entries'));
  if (!settings.recurring.length) box.append(h('p', {class:'steps'}, 'None yet. Tick Repeats every month when you add something like rent, a subscription or a retainer, and it will be waiting for you each month.'));
  settings.recurring.forEach(r => {
    const id = r.id;
    box.append(h('div', {class:'reprow'},
      h('span', null, h('strong', null, r.name || 'Entry'), ' ', (r.kind === 'income' ? '+' : '') + money(r.amount) + ' on the ' + ord(r.day || 1)),
      h('button', {class:'btn small', type:'button', onclick:function(){ settings.recurring = settings.recurring.filter(x => x.id !== id); save('settings'); renderCats(); renderAll(); }}, 'Stop repeating')));
  });
  box.append(h('h3', null, 'Start over'));
  const zone = h('div', {class:'actions', style:'margin-top:0'});
  const ask = function(){
    zone.textContent = '';
    zone.append(h('span', null, 'This removes every entry, category and budget in your account, and cannot be undone.'),
      h('button', {class:'btn danger', type:'button', onclick:eraseAll}, 'Delete everything'),
      h('button', {class:'btn', type:'button', onclick:renderCats}, 'Keep my data'));
  };
  zone.append(h('button', {class:'btn danger small', type:'button', onclick:ask}, 'Delete all my data'));
  box.append(zone);
}
function removeCat(id){
  const idx = settings.categories.findIndex(c => c.id === id); if (idx < 0) return;
  const gone = settings.categories.splice(idx, 1)[0];
  if (filterCat === gone.kind + '|' + gone.id) filterCat = null;
  save('settings'); renderCats(); renderAll();
  catNote('Removed ' + gone.name + '. Its entries now show as uncategorized.', 'Undo', function(){
    settings.categories.splice(Math.min(idx, settings.categories.length), 0, gone); save('settings'); renderCats(); renderAll();
  });
}
async function eraseAll(){
  erasing = true; gen++;
  dirty.clear(); failed.clear();
  while (writing) await new Promise(r => setTimeout(r, 120));
  const res = await settle(sb.from(TABLE).delete().eq('user_id', uid));
  erasing = false;
  $('#catDlg').close();
  if (res.error){
    ['settings'].concat(Object.keys(months).map(m => 'm-' + m)).forEach(save);
    showToast('Your data could not be deleted. Check your connection, then try again.');
    return;
  }
  books.me = {settings:defaultSettings(), months:{}}; alias(); filterCat = null; gen++;
  const sel = $('#aCat'); sel.textContent = ''; sel.dataset.sig = '';
  renderAll();
  showToast('Deleted everything. You are starting fresh.');
}
$('#catDone').addEventListener('click', function(){ $('#catDlg').close(); });

/* ---------- import ---------- */
function csvSplit(line){
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++){
    const ch = line[i];
    if (q){ if (ch === '"'){ if (line[i + 1] === '"'){ cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ','){ out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur); return out;
}
function parseDate(str){
  const t = String(str || '').trim(); let m;
  const mk = (y, mo, d) => (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y > 1900 && y < 2200 && d <= new Date(y, mo, 0).getDate()) ? y + '-' + pad(mo) + '-' + pad(d) : null;
  if ((m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/.exec(t))) return mk(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2}|\d{4})$/.exec(t))) return mk(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
  if ((m = /^(\d{1,2})[-\/](\d{1,2})$/.exec(t))) return mk(+view.slice(0, 4), +m[1], +m[2]);
  if (/[a-z]/i.test(t)){ const d = new Date(t); if (!isNaN(d)) return ymd(d); }
  return null;
}
let parsed = null;
function checkImport(){
  const text = $('#impText').value, pv = $('#impPreview'), go = $('#impGo');
  parsed = null; go.disabled = true; go.textContent = 'Import entries'; pv.textContent = '';
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return;
  let rows = lines.map(l => (l.indexOf('\t') >= 0 ? l.split('\t') : csvSplit(l)).map(c => c.trim()));
  let col = {date:0, note:1, cat:2, amt:3, type:4}, firstRow = 1;
  if (!parseDate(rows[0][0]) && rows[0].some(c => /date|amount|categ|descr/i.test(c))){
    const hd = rows[0].map(c => c.toLowerCase()), find = re => hd.findIndex(c => re.test(c));
    const d = find(/date|when/), a = find(/amount|cost|price|total|value|spent/);
    if (d >= 0 && a >= 0) col = {date:d, amt:a, note:find(/desc|note|item|name|memo|what|payee|vendor/), cat:find(/categ/), type:find(/type|kind/)};
    rows = rows.slice(1); firstRow = 2;
  }
  const good = [], bad = [];
  rows.forEach((r, i) => {
    const date = parseDate(r[col.date]), amt = parseAmount(r[col.amt]);
    if (!date || !isFinite(amt) || amt === 0){ bad.push(i + firstRow); return; }
    good.push({date:date, amt:amt, note:col.note >= 0 ? (r[col.note] || '') : '', cat:col.cat >= 0 ? (r[col.cat] || '') : '', type:col.type >= 0 ? (r[col.type] || '') : ''});
  });
  if (!good.length){ pv.textContent = 'None of those rows could be read. Check that the first column is a date and the fourth is an amount.'; return; }
  const mixed = good.some(g => g.amt < 0) && good.some(g => g.amt > 0);
  const newCats = [];
  good.forEach(g => {
    const existing = g.cat ? settings.categories.find(c => c.name.toLowerCase() === g.cat.toLowerCase()) : null;
    if (/inc|earn|deposit|credit|\bin\b/i.test(g.type)) g.kind = 'income';
    else if (/exp|spen|debit|\bout\b/i.test(g.type)) g.kind = 'expense';
    else if (existing) g.kind = existing.kind;
    else if (mixed) g.kind = g.amt > 0 ? 'income' : 'expense';
    else g.kind = 'expense';
    g.amt = Math.abs(g.amt);
    if (g.cat && !(existing && existing.kind === g.kind)){
      const k = g.kind + '|' + g.cat.toLowerCase();
      if (!newCats.some(n => n.k === k)) newCats.push({k:k, name:g.cat, kind:g.kind});
    }
  });
  parsed = {rows:good, newCats:newCats};
  const out = good.filter(g => g.kind === 'expense').length, inn = good.length - out;
  let msg = 'Found ' + good.length + (good.length === 1 ? ' row: ' : ' rows: ') + out + ' money out, ' + inn + ' money in.';
  if (newCats.length) msg += ' New categories: ' + newCats.map(n => n.name).join(', ') + '.';
  if (bad.length) msg += ' Could not read row' + (bad.length > 1 ? 's ' : ' ') + bad.slice(0, 12).join(', ') + (bad.length > 12 ? ' and more' : '') + ', so ' + (bad.length > 1 ? 'they' : 'it') + ' will be skipped. Check the date and amount.';
  pv.textContent = msg;
  go.disabled = false; go.textContent = 'Import ' + good.length + (good.length === 1 ? ' entry' : ' entries');
}
function doImport(){
  if (!parsed || !ready) return;
  const touched = new Set();
  parsed.newCats.forEach(n => { n.id = 'c-' + newId(); settings.categories.push({id:n.id, name:n.name, kind:n.kind, budget:0}); });
  parsed.rows.forEach(g => {
    const c = g.cat ? settings.categories.find(x => x.kind === g.kind && x.name.toLowerCase() === g.cat.toLowerCase()) : null;
    const ym = monthOf(g.date);
    ensureMonth(ym).items.push({id:newId(), date:g.date, amount:g.amt, kind:g.kind, categoryId:c ? c.id : '', note:g.note});
    touched.add(ym);
  });
  if (parsed.newCats.length) save('settings');
  touched.forEach(ym => save('m-' + ym));
  const n = parsed.rows.length, latest = Array.from(touched).sort().pop();
  parsed = null; $('#impText').value = ''; checkImport();
  $('#impDlg').close(); renderAll();
  if (!touched.has(view)) showToast('Imported ' + n + (n === 1 ? ' entry.' : ' entries.'), 'Show ' + longMonth(latest), function(){ setView(latest); });
  else showToast('Imported ' + n + (n === 1 ? ' entry.' : ' entries.'));
}
let impTimer = null;
$('#impText').addEventListener('input', function(){ clearTimeout(impTimer); impTimer = setTimeout(checkImport, 250); });
$('#openImp').addEventListener('click', function(){ if (!ready) return; checkImport(); $('#impDlg').showModal(); });
$('#impCancel').addEventListener('click', function(){ $('#impDlg').close(); });
$('#impGo').addEventListener('click', doImport);

/* ---------- export ---------- */
$('#doExport').addEventListener('click', function(){
  if (!ready) return;
  const esc = v => { const t = String(v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const rows = [['Date', 'Description', 'Category', 'Type', 'Amount']];
  allItems().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0).forEach(it => rows.push([it.date, it.note, catLabel(it), it.kind === 'income' ? 'Income' : 'Expense', it.amount.toFixed(2)]));
  if (rows.length === 1){ showToast('There are no entries to export yet.'); return; }
  const url = URL.createObjectURL(new Blob([rows.map(r => r.map(esc).join(',')).join('\n')], {type:'text/csv'}));
  const a = h('a', {href:url, download:'budget-entries.csv'});
  document.body.append(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
  showToast('Exported budget-entries.csv');
});

Shell.start({
  page:'home', onEnter:onEnter, onLeave:onLeave,
  onName:function(name){ displayName = name; if (ready) renderHero(); },
  onCategories:openCats,
  hasUnsaved:function(){ return !!(writing || dirty.size || failed.size); }
});
})();

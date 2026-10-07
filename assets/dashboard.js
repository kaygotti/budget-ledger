/* Budget ledger: the Dashboard page. Read-only charts for each person on the ledger. */
(function(){
'use strict';
const Shell = window.Shell, sb = Shell.sb, $ = Shell.$, h = Shell.h, s = Shell.s, settle = Shell.settle;

/* ---------- dates and money ---------- */
const pad = n => String(n).padStart(2, '0');
const thisMonth = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1); };
function shiftMonth(ym, delta){
  let y = +ym.slice(0, 4), m = +ym.slice(5, 7) + delta;
  while (m < 1){ m += 12; y--; } while (m > 12){ m -= 12; y++; }
  return y + '-' + pad(m);
}
const monthName = (ym, o) => new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1).toLocaleDateString('en-US', o || {month:'long'});
const shortMonth = ym => monthName(ym, {month:'short'});
const longMonth = ym => monthName(ym, {month:'long', year:'numeric'});
const fmt = new Intl.NumberFormat('en-US', {style:'currency', currency:'USD'});
const money = cents => fmt.format(cents / 100);
function compact(d){                       // axis ticks and short labels, in dollars
  const f = (v, u) => '$' + (Math.round(v * 10) / 10).toString() + u;
  if (d >= 1e6) return f(d / 1e6, 'M');
  if (d >= 1000) return f(d / 1000, 'K');
  return '$' + (Number.isInteger(d) ? d : d.toFixed(2));
}
function niceScale(top){                   // top in dollars -> {max, step} on clean numbers
  if (!(top > 0)) return {max:100, step:25};
  const pow = Math.pow(10, Math.floor(Math.log10(top / 5)));
  const step = [1, 2, 2.5, 5, 10].map(k => k * pow).find(st => top / st <= 5);
  return {max:Math.ceil(top / step - 1e-9) * step, step:step};
}
const compactMoney = cents => '$' + Math.round(cents / 100).toLocaleString('en-US');
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/* ---------- state ---------- */
let me = null, people = [], who = null, range = 6, focus = thisMonth();
let cache = {}, loading = {}, failedFor = null, lastWidth = 0;

/* ---------- data ---------- */
function parse(rows){
  const p = {cats:[], months:{}, at:Date.now()};
  rows.forEach(function(r){
    const b = (r && r.body) || {};
    if (r.key === 'settings'){
      p.cats = (Array.isArray(b.categories) ? b.categories : []).filter(c => c && c.id && c.name).map(c => ({
        id:String(c.id), name:String(c.name), kind:c.kind === 'income' ? 'income' : 'expense',
        budget:+c.budget > 0 ? Math.round(+c.budget * 100) : 0}));
    } else if (/^m-\d{4}-\d{2}$/.test(r.key)){
      p.months[r.key.slice(2)] = (Array.isArray(b.items) ? b.items : []).filter(i => i && isFinite(+i.amount)).map(i => ({
        amount:Math.round(+i.amount * 100), kind:i.kind === 'income' ? 'income' : 'expense', cat:String(i.categoryId || '')}));
    }
  });
  return p;
}
function stats(p, ym){
  const out = {inc:0, exp:0, by:{}}, valid = {};
  p.cats.forEach(c => { valid[c.kind + '|' + c.id] = true; });
  (p.months[ym] || []).forEach(function(i){
    if (i.kind === 'income') out.inc += i.amount; else out.exp += i.amount;
    let k = i.kind + '|' + i.cat; if (!valid[k]) k = i.kind + '|';
    out.by[k] = (out.by[k] || 0) + i.amount;
  });
  return out;
}
function model(p){
  const end = thisMonth(), ms = [];
  for (let i = range - 1; i >= 0; i--) ms.push(shiftMonth(end, -i));
  const prev = shiftMonth(focus, -1), st = {};
  ms.concat(prev).forEach(m => { if (!st[m]) st[m] = stats(p, m); });
  const ex = p.cats.filter(c => c.kind === 'expense');
  const rows = ex.map(c => ({key:'expense|' + c.id, name:c.name, budget:c.budget}));
  if (ms.concat(prev).some(m => st[m].by['expense|'])) rows.push({key:'expense|', name:'Uncategorized', budget:0});
  const budget = ex.reduce((a, c) => a + c.budget, 0);
  const budgeted = m => ex.reduce((a, c) => a + (c.budget ? (st[m].by['expense|' + c.id] || 0) : 0), 0);
  const any = ms.concat(prev).some(m => st[m].inc || st[m].exp);
  return {ms:ms, prev:prev, st:st, rows:rows, budget:budget, budgeted:budgeted, any:any};
}
async function fetchPerson(id){
  const forMe = me;
  loading[id] = true; if (failedFor === id) failedFor = null;
  if (who === id) paint();
  // Your own rows come straight from the table. Someone else's come through the
  // database's shared-read function, which only answers for people on the ledger.
  const q = id === forMe.id ? sb.from('ledger_docs').select('key,body').eq('user_id', id) : sb.rpc('ledger_read', {target:id});
  const res = await settle(q);
  if (me !== forMe) return;
  delete loading[id];
  if (res.error || !Array.isArray(res.data)){ if (!cache[id]) failedFor = id; }
  else cache[id] = parse(res.data);
  if (who === id) paint();
}

/* ---------- tooltip ---------- */
const tip = $('#tip');
function hideTip(){ tip.hidden = true; }
function showTip(title, rows, x, y){
  tip.textContent = '';
  tip.append(h('div', {class:'tt'}, title));
  rows.forEach(function(r){
    const key = h('i'); if (r.color) key.style.background = r.color; else key.style.visibility = 'hidden';
    tip.append(h('div', {class:'tr'}, key, h('b', null, r.value), h('span', null, r.label)));
  });
  tip.hidden = false;
  const b = tip.getBoundingClientRect();
  let L = x + 14, T = y - b.height - 12;
  if (L + b.width > innerWidth - 8) L = x - b.width - 14;
  if (L < 8) L = 8;
  if (T < 8) T = y + 18;
  tip.style.left = L + 'px'; tip.style.top = T + 'px';
}
function bindTip(el, title, rowsFn){
  const at = e => showTip(title, rowsFn(), e.clientX, e.clientY);
  el.addEventListener('pointerenter', at);
  el.addEventListener('pointermove', at);
  el.addEventListener('pointerleave', hideTip);
  el.addEventListener('focus', function(){ const r = el.getBoundingClientRect(); showTip(title, rowsFn(), r.left + r.width / 2, r.top + 24); });
  el.addEventListener('blur', hideTip);
}

/* ---------- column chart ----------
   o: {label, months, values:[[cents per month] per series], colors:[...], height,
       split (cents: paint the part of a column above this in the over-budget colour),
       line (cents: reference line), mini, focus, onPick(ym), tip(i) -> rows, aria(i)} */
function columns(box, o){
  box.textContent = '';
  const W = Math.max(220, Math.floor(box.clientWidth)), H = o.height;
  const mL = o.mini ? 0 : 46, mR = o.mini ? 0 : 4, mT = o.mini ? 22 : 16, mB = o.mini ? 18 : 36;
  const pw = W - mL - mR, ph = H - mT - mB, n = o.months.length, band = pw / n, y0 = mT + ph;
  let top = o.line || 0;
  o.values.forEach(v => v.forEach(c => { if (c > top) top = c; }));
  const sc = niceScale(top / 100), max = o.mini ? Math.max(top / 100, 1) : sc.max;
  const y = c => y0 - (c / 100) / max * ph;
  const svg = s('svg', {viewBox:'0 0 ' + W + ' ' + H, role:'group', 'aria-label':o.label});
  const fi = o.focus ? o.months.indexOf(o.focus) : -1;
  if (fi >= 0 && !o.mini) svg.append(s('rect', {x:mL + fi * band, y:mT - 8, width:band, height:ph + 8, class:'focusband'}));
  if (!o.mini){
    for (let t = sc.step; t <= sc.max + 1e-9; t += sc.step){
      const yy = Math.round(y(t * 100)) + .5;
      svg.append(s('line', {x1:mL, x2:W - mR, y1:yy, y2:yy, class:'grid'}), s('text', {x:mL - 8, y:yy + 4, 'text-anchor':'end'}, compact(t)));
    }
    svg.append(s('text', {x:mL - 8, y:y0 + 4, 'text-anchor':'end'}, '$0'));
  }
  const k = o.values.length, gap = 2;
  const bw = Math.max(3, Math.min(o.mini ? 14 : 24, Math.floor((band - (o.mini ? 4 : 10) - gap * (k - 1)) / k)));
  const gw = k * bw + (k - 1) * gap;
  const bar = function(x, yt, yb, color, round){
    const hgt = yb - yt; if (hgt <= 0) return null;
    const r = round ? Math.min(4, bw / 2, hgt) : 0;
    return s('path', {class:'bar', fill:color, d:'M' + x + ',' + yb + 'V' + (yt + r) + 'Q' + x + ',' + yt + ' ' + (x + r) + ',' + yt + 'H' + (x + bw - r) + 'Q' + (x + bw) + ',' + yt + ' ' + (x + bw) + ',' + (yt + r) + 'V' + yb + 'Z'});
  };
  const add = (g, b) => { if (b) g.append(b); };
  let peak = -1, peakV = 0;
  o.months.forEach(function(m, i){
    const g = s('g', {class:'col'});
    const x0 = mL + i * band + (band - gw) / 2;
    o.values.forEach(function(v, j){
      const c = v[i], x = x0 + j * (bw + gap);
      if (c > 0){
        let yt = Math.min(y(c), y0 - 2);
        if (o.split && c > o.split && y0 - y(o.split) > 6){
          yt = Math.min(yt, y(o.split) - 5);           // keep the over-budget cap tall enough to see
          add(g, bar(x, y(o.split) + 1, y0, o.colors[j], false)); add(g, bar(x, yt, y(o.split) - 1, css('--c-over'), true));
        } else add(g, bar(x, yt, y0, o.split && c > o.split ? css('--c-over') : o.colors[j], true));
      }
      if (c > peakV){ peakV = c; peak = i; }
    });
    const hit = s('rect', {x:mL + i * band, y:0, width:band, height:H, class:'hit', 'aria-label':o.aria ? o.aria(i) : null});
    if (o.onPick){
      hit.setAttribute('role', 'button'); hit.setAttribute('tabindex', '0');
      hit.addEventListener('click', function(){ o.onPick(m); });
      hit.addEventListener('keydown', function(e){ if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); o.onPick(m); } });
    }
    if (o.tip) bindTip(hit, longMonth(m), function(){ return o.tip(i); });
    g.append(hit); svg.append(g);
    // month labels: every one when there is room, otherwise every other, always the last
    if (o.mini){
      if (i === 0 || i === n - 1) svg.append(s('text', {x:i === 0 ? 0 : W, y:H - 4, 'text-anchor':i === 0 ? 'start' : 'end'}, shortMonth(m)));
    } else if (band >= 30 || (n - 1 - i) % 2 === 0){
      const cx = mL + i * band + band / 2;
      svg.append(s('text', {x:cx, y:y0 + 16, 'text-anchor':'middle', class:i === fi ? 'on' : null}, shortMonth(m)));
      if (i === 0 || m.slice(5) === '01') svg.append(s('text', {x:cx, y:y0 + 30, 'text-anchor':'middle'}, m.slice(0, 4)));
    }
  });
  svg.append(s('line', {x1:mL, x2:W - mR, y1:y0 + .5, y2:y0 + .5, class:'axis'}));
  if (o.line){ const yy = Math.round(y(o.line)) + .5; svg.append(s('line', {x1:mL, x2:W - mR, y1:yy, y2:yy, class:'ref'})); }
  if (o.mini && peak >= 0){            // label only the tallest column
    const cx = Math.min(W - 18, Math.max(18, peak * band + band / 2));
    let ly = y(peakV) - 6;
    if (o.split && peakV > o.split) ly = Math.min(ly, y(o.split) - 11);     // clear the over-budget cap
    if (o.line && Math.abs(ly - 4 - y(o.line)) < 9) ly = y(o.line) - 5;      // never sit on the budget line
    svg.append(s('text', {x:cx, y:Math.max(10, ly), 'text-anchor':'middle', class:'on'}, compact(Math.round(peakV / 100))));
  }
  box.append(svg);
}

/* ---------- small pieces ---------- */
const swatch = (color, line) => { const i = h('i', {class:line ? 'line' : null}); i.style.background = color; return i; };
const legend = function(){ const l = h('div', {class:'legend'}); for (let i = 0; i < arguments.length; i++) if (arguments[i]) l.append(h('span', null, swatch(arguments[i][0], arguments[i][2]), arguments[i][1])); return l; };
function delta(now, was, upGood, prevName){
  const d = now - was;
  if (d === 0) return h('div', {class:'delta'}, 'Same as ' + prevName);
  return h('div', {class:'delta'},
    h('span', {class:'dir ' + ((d > 0) === upGood ? 'good' : 'bad'), 'aria-hidden':'true'}, d > 0 ? '▲' : '▼'),
    money(Math.abs(d)) + (d > 0 ? ' more than ' : ' less than ') + prevName);
}
function tile(label, value){
  const t = h('div', {class:'kpi'}, h('div', {class:'lab'}, label), h('div', {class:'val'}, value));
  for (let i = 2; i < arguments.length; i++) if (arguments[i]) t.append(arguments[i]);
  return t;
}
function sheet(title){
  const sec = h('section', {class:'sheet'}, h('h2', null, title));
  for (let i = 1; i < arguments.length; i++) if (arguments[i]) sec.append(arguments[i]);
  return sec;
}
function table(head, rows){
  const t = h('table', {class:'tbl'}, h('thead', null, h('tr', null, ...head.map((c, i) => h('th', {scope:'col', class:i ? null : 'l'}, c)))));
  const tb = h('tbody');
  rows.forEach(r => tb.append(h('tr', null, ...r.map((c, i) => i ? h('td', null, c) : h('th', {scope:'row', class:'l'}, c)))));
  t.append(tb);
  return h('div', {class:'tblwrap'}, t);
}

/* ---------- the page ---------- */
const person = () => people.find(p => p.user_id === who) || {name:''};
function syncControls(){
  const end = thisMonth(), start = shiftMonth(end, -(range - 1));
  if (focus < start) focus = start; if (focus > end) focus = end;
  $('#dMonth').textContent = longMonth(focus);
  $('#dPrev').disabled = focus <= start; $('#dNext').disabled = focus >= end;
}
function renderTabs(){
  const box = $('#whoTabs'); box.textContent = ''; box.hidden = people.length < 2;
  people.forEach(function(p, i){
    const on = p.user_id === who;
    const b = h('button', {class:'tab', type:'button', role:'tab', id:'tab-' + i, 'aria-selected':on ? 'true' : 'false', 'aria-controls':'dash', tabindex:on ? '0' : '-1'}, p.name);
    b.addEventListener('click', function(){ pick(p.user_id); });
    b.addEventListener('keydown', function(e){
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const nx = people[(i + (e.key === 'ArrowRight' ? 1 : people.length - 1)) % people.length];
      pick(nx.user_id); const t = $('#whoTabs [aria-selected=true]'); if (t) t.focus();
    });
    box.append(b);
    if (on) $('#dash').setAttribute('aria-labelledby', 'tab-' + i);
  });
}
function pick(id){
  if (id === who) return;
  who = id; renderTabs();
  if (!cache[id] || Date.now() - cache[id].at > 60000) fetchPerson(id); else paint();
}
function setFocus(m){ focus = m; syncControls(); paint(); }

function paint(){
  hideTip();
  const box = $('#dash'), p = cache[who], name = person().name, mine = me && who === me.id;
  box.classList.toggle('stale', !!loading[who]);
  box.setAttribute('aria-busy', loading[who] ? 'true' : 'false');
  if (!p){
    if (failedFor === who){
      box.classList.remove('stale'); box.textContent = '';
      box.append(h('section', {class:'sheet'},
        h('h1', {class:'dashtitle'}, (mine ? 'Your' : name + '’s') + ' budget did not load.'),
        h('p', {class:'sub'}, 'Check your connection, then load it again.'),
        h('button', {class:'btn primary panelbtn', type:'button', onclick:function(){ fetchPerson(who); }}, 'Load again')));
    } else if (!box.childElementCount) box.append(h('p', {class:'empty'}, 'Loading'));
    return;                                  // otherwise keep the last picture, dimmed, until the new one arrives
  }
  syncControls();
  const M = model(p), cur = M.st[focus], was = M.st[M.prev], prevName = monthName(M.prev), focName = monthName(focus);
  const cIn = css('--c-in'), cOut = css('--c-out'), cSoft = css('--c-out-soft'), cOver = css('--c-over'), cRef = css('--ink');
  box.textContent = '';
  box.append(h('h1', {class:'dashtitle'}, (name ? name + '’s ' : '') + longMonth(focus)),
    h('p', {class:'sub'}, 'Compared with ' + prevName + '. Pick another month from the chart or the arrows.'));

  /* headline numbers for the chosen month */
  const left = cur.inc - cur.exp, wasLeft = was.inc - was.exp, spent = M.budgeted(focus);
  let bt;
  if (M.budget){
    const m = h('div', {class:'meter' + (spent > M.budget ? ' over' : '')}); const f = h('i'); f.style.width = Math.min(100, spent / M.budget * 100) + '%'; m.append(f);
    const room = M.budget - spent;
    bt = tile('Budget used', money(spent), h('div', {class:'of'}, 'of ' + money(M.budget) + ' budgeted'), m,
      h('div', {class:'delta' + (room < 0 ? ' overtxt' : '')}, room < 0 ? 'Over budget by ' + money(-room) : money(room) + ' left to spend'));
  } else {
    bt = tile('Budget used', 'None set', h('div', {class:'delta'}, mine ? h('a', {href:'index.html?open=categories'}, 'Set budgets') : name + ' has no budgets yet'));
  }
  box.append(h('div', {class:'kpis'},
    tile('Money in', money(cur.inc), delta(cur.inc, was.inc, true, prevName)),
    tile('Money out', money(cur.exp), delta(cur.exp, was.exp, false, prevName)),
    tile(left < 0 ? 'Short' : 'Left', money(Math.abs(left)), delta(left, wasLeft, true, prevName)),
    bt));

  if (!M.any){
    box.append(h('section', {class:'sheet'},
      h('p', {class:'empty'}, (mine ? 'You have' : name + ' has') + ' nothing logged in the last ' + range + ' months, so there is nothing to chart yet.'),
      mine ? h('a', {class:'btn primary linkish', href:'index.html'}, 'Add an entry') : null));
    return;
  }

  /* money in and out */
  const c1 = h('div', {class:'chart'});
  box.append(sheet('Money in and out, month by month', legend([cIn, 'Money in'], [cOut, 'Money out']), c1));
  columns(c1, {
    label:'Money in and money out for each of the last ' + range + ' months', months:M.ms, height:250, focus:focus, onPick:setFocus,
    values:[M.ms.map(m => M.st[m].inc), M.ms.map(m => M.st[m].exp)], colors:[cIn, cOut],
    tip:i => { const t = M.st[M.ms[i]], l = t.inc - t.exp; return [{color:cIn, value:money(t.inc), label:'in'}, {color:cOut, value:money(t.exp), label:'out'}, {value:money(Math.abs(l)), label:l < 0 ? 'short' : 'left'}]; },
    aria:i => { const t = M.st[M.ms[i]]; return longMonth(M.ms[i]) + ': ' + money(t.inc) + ' in, ' + money(t.exp) + ' out. Show this month.'; }
  });

  /* spending against budget */
  if (M.budget){
    const c2 = h('div', {class:'chart'});
    box.append(sheet('Spending against budget',
      legend([cOut, 'Spent'], [cOver, 'Over budget'], [cRef, 'Budget, ' + money(M.budget) + ' a month', true]), c2,
      h('p', {class:'hint'}, 'Counts spending in categories that have a budget. Budgets are today’s amounts, applied to every month.')));
    columns(c2, {
      label:'Spending in budgeted categories against the monthly budget', months:M.ms, height:230, focus:focus, onPick:setFocus,
      values:[M.ms.map(m => M.budgeted(m))], colors:[cOut], split:M.budget, line:M.budget,
      tip:i => { const v = M.budgeted(M.ms[i]), r = M.budget - v; return [{color:v > M.budget ? cOver : cOut, value:money(v), label:'spent'}, {color:cRef, value:money(M.budget), label:'budget'}, {value:money(Math.abs(r)), label:r < 0 ? 'over budget' : 'under budget'}]; },
      aria:i => { const v = M.budgeted(M.ms[i]), r = M.budget - v; return longMonth(M.ms[i]) + ': ' + money(v) + ' spent of ' + money(M.budget) + ', ' + money(Math.abs(r)) + (r < 0 ? ' over' : ' under') + '. Show this month.'; }
    });
  } else {
    box.append(sheet('Spending against budget', h('p', {class:'empty'},
      mine ? 'No budgets set yet. Give your categories a monthly amount and this chart compares each month against it.' : name + ' has not set any budgets yet.'),
      mine ? h('a', {class:'btn linkish', href:'index.html?open=categories'}, 'Set budgets') : null));
  }

  /* this month against last month, category by category */
  const rows = M.rows.map(r => ({name:r.name, budget:r.budget, now:cur.by[r.key] || 0, was:was.by[r.key] || 0}))
    .filter(r => r.now || r.was || r.budget).sort((a, b) => b.now - a.now || b.was - a.was);
  const cmp = sheet(focName + ' compared with ' + prevName + ', by category');
  if (!rows.length) cmp.append(h('p', {class:'empty'}, 'No spending in either month.'));
  else {
    const scale = Math.max.apply(null, rows.map(r => Math.max(r.now, r.was, r.budget))) || 1;
    cmp.append(legend([cOut, focName], [cSoft, prevName], rows.some(r => r.budget) ? [cRef, 'Budget', true] : null));
    rows.forEach(function(r){
      const bars = h('div', {class:'bars'});
      const a = h('i', {class:'now'}); a.style.width = (r.now / scale * 100) + '%';
      const b = h('i', {class:'was'}); b.style.width = (r.was / scale * 100) + '%';
      bars.append(a, b);
      if (r.budget){ const t = h('b', {title:'Budget ' + money(r.budget)}); t.style.left = 'calc(' + (r.budget / scale * 100) + '% - 1px)'; bars.append(t); }
      const d = r.now - r.was;
      cmp.append(h('div', {class:'cmp'},
        h('div', {class:'nm'}, r.name),
        bars,
        h('div', {class:'num'}, h('strong', null, money(r.now)),
          h('small', null, d === 0 ? 'Same as ' + prevName : money(Math.abs(d)) + (d > 0 ? ' more' : ' less')),
          r.budget && r.now > r.budget ? h('small', {class:'overtxt'}, 'Over budget by ' + money(r.now - r.budget)) : null)));
    });
  }
  box.append(cmp);

  /* each category over time */
  const minis = h('div', {class:'minis'}), mrows = M.rows.filter(r => r.budget || M.ms.some(m => M.st[m].by[r.key]));
  box.append(sheet('Each category over the last ' + range + ' months', mrows.some(r => r.budget) ? legend([cOut, 'Spent'], [cOver, 'Over budget'], [cRef, 'Budget', true]) : null,
    minis, h('p', {class:'hint'}, 'Each chart has its own scale. The tallest month is labelled.')));
  mrows.forEach(function(r){
    const vals = M.ms.map(m => M.st[m].by[r.key] || 0), total = vals.reduce((a, c) => a + c, 0);
    const c = h('div', {class:'chart'});
    minis.append(h('div', {class:'mini'}, h('h3', null, r.name),
      h('p', null, 'Averages ' + compactMoney(total / M.ms.length) + ' a month' + (r.budget ? ', budget ' + compactMoney(r.budget) : '')), c));
    columns(c, {label:r.name + ', spending by month', months:M.ms, height:112, mini:true, values:[vals], colors:[cOut], split:r.budget || 0, line:r.budget || 0,
      tip:i => { const out = [{color:r.budget && vals[i] > r.budget ? cOver : cOut, value:money(vals[i]), label:r.name}]; if (r.budget) out.push({color:cRef, value:money(r.budget), label:'budget'}); return out; }});
  });

  /* the same numbers as tables */
  const t1 = table(['Month', 'Money in', 'Money out', 'Left'].concat(M.budget ? ['Budgeted spending', 'Budget'] : []),
    M.ms.map(m => { const t = M.st[m]; return [longMonth(m), money(t.inc), money(t.exp), (t.inc - t.exp < 0 ? '−' : '') + money(Math.abs(t.inc - t.exp))].concat(M.budget ? [money(M.budgeted(m)), money(M.budget)] : []); }));
  const t2 = table(['Category'].concat(M.ms.map(m => shortMonth(m) + ' ' + m.slice(2, 4)), ['Budget']),
    mrows.map(r => [r.name].concat(M.ms.map(m => money(M.st[m].by[r.key] || 0)), [r.budget ? money(r.budget) : 'None'])));
  box.append(h('section', {class:'sheet'}, h('h2', null, 'The numbers behind the charts'),
    h('details', null, h('summary', null, 'Month by month'), t1),
    h('details', null, h('summary', null, 'Categories by month'), t2)));
}

/* ---------- controls ---------- */
$('#dPrev').addEventListener('click', function(){ setFocus(shiftMonth(focus, -1)); });
$('#dNext').addEventListener('click', function(){ setFocus(shiftMonth(focus, 1)); });
document.querySelectorAll('input[name="range"]').forEach(r => r.addEventListener('change', function(){ if (r.checked){ range = +r.value; syncControls(); paint(); } }));
if (window.ResizeObserver){
  let timer = null;
  new ResizeObserver(function(){
    const w = $('#dash').clientWidth;
    if (!w || w === lastWidth) return;
    const first = !lastWidth; lastWidth = w;
    if (first) return;
    clearTimeout(timer); timer = setTimeout(function(){ if (cache[who]) paint(); }, 150);
  }).observe($('#dash'));
}
document.addEventListener('visibilitychange', function(){
  if (!document.hidden && me && who && !loading[who] && cache[who] && Date.now() - cache[who].at > 30000) fetchPerson(who);
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(){ if (cache[who]) paint(); });

/* ---------- start ---------- */
function onEnter(user){
  me = user; who = user.id; focus = thisMonth(); cache = {}; loading = {}; failedFor = null;
  people = [{user_id:user.id, name:Shell.nameOf(user)}];
  $('#dash').textContent = '';
  renderTabs(); syncControls(); fetchPerson(who);
  Shell.members().then(function(list){
    if (me !== user || !list.some(m => m.user_id === user.id)) return;
    people = list.slice().sort((a, b) => a.user_id === user.id ? -1 : b.user_id === user.id ? 1 : a.name.localeCompare(b.name));
    renderTabs(); if (cache[who]) paint();
  });
}
function onLeave(){ me = null; who = null; people = []; cache = {}; loading = {}; hideTip(); $('#dash').textContent = ''; renderTabs(); }
Shell.start({page:'dashboard', onEnter:onEnter, onLeave:onLeave});
})();

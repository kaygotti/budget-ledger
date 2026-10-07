/* Budget ledger: the shared shell.
   Every page loads this file. It draws the header and menu, handles sign-in and
   sign-out, and shows short messages. Pages call Shell.start({...}) to plug in. */
(function(){
'use strict';

// The address and the publishable key are safe to ship in a web page: the database only
// hands a signed-in account the rows it is allowed to see.
const SB_URL = 'https://dvckwgdcognzlvkgpzjq.supabase.co';
const SB_KEY = 'sb_publishable_eMOLrnyrZBo8pyNqudOMig_oxIJNEb5';

/* ---------- helpers ---------- */
const $ = (q, r) => (r || document).querySelector(q);
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
  if (attrs) for (const k in attrs) if (attrs[k] != null && attrs[k] !== false) n.setAttribute(k, attrs[k]);
  for (let i = 2; i < arguments.length; i++){ const c = arguments[i]; if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return n;
}
const settle = q => Promise.resolve(q).then(r => r || {}, e => ({error:e}));
const icon = d => s('svg', {viewBox:'0 0 24 24', width:24, height:24, 'aria-hidden':'true'},
  s('path', {d:d, stroke:'currentColor', 'stroke-width':2, 'stroke-linecap':'round', fill:'none'}));

// Read the link details before the sign-in library tidies the address bar.
const hp = new URLSearchParams(location.hash.replace(/^#/, ''));
const linkErr = hp.get('error_description');
let recovering = hp.get('type') === 'recovery' && !linkErr;

const sb = (window.supabase && window.supabase.createClient) ? window.supabase.createClient(SB_URL, SB_KEY) : null;
let opts = {}, user = null, membersP = null, authMode = 'signin', authBusy = false, booted = false;

/* ---------- header and menu ---------- */
const LOGO = '\u{1F4B8}';
const menuBtn = h('button', {class:'iconbtn menubtn', id:'menuBtn', type:'button', 'aria-label':'Menu', 'aria-haspopup':'dialog', 'aria-expanded':'false', hidden:true},
  icon('M4 6h16M4 12h16M4 18h16'));
const acct = h('span', {class:'who', id:'acctName'});
const header = h('header', {class:'site'}, h('div', {class:'sitein'},
  menuBtn,
  h('a', {class:'logo', href:'index.html', 'aria-label':'Budget ledger home'}, h('span', {'aria-hidden':'true'}, LOGO)),
  acct));
const nav = h('nav', {'aria-label':'Main'});
const navDlg = h('dialog', {class:'drawer', id:'navDlg', 'aria-label':'Menu'},
  h('div', {class:'drawerhead'},
    h('span', {class:'logo', 'aria-hidden':'true'}, LOGO),
    h('span', {class:'drawername'}, 'Budget ledger'),
    h('button', {class:'iconbtn menubtn', type:'button', 'aria-label':'Close menu', onclick:function(){ navDlg.close(); }}, icon('M6 6l12 12M18 6L6 18'))),
  nav);
menuBtn.addEventListener('click', function(){ navDlg.showModal(); menuBtn.setAttribute('aria-expanded', 'true'); });
navDlg.addEventListener('close', function(){ menuBtn.setAttribute('aria-expanded', 'false'); });
navDlg.addEventListener('click', function(e){ if (e.target === navDlg) navDlg.close(); });

function buildNav(){
  nav.textContent = '';
  const link = (id, label, href) => h('a', {href:href, 'aria-current':opts.page === id ? 'page' : null}, label);
  nav.append(link('home', 'Home', 'index.html'), link('dashboard', 'Dashboard', 'dashboard.html'));
  if (opts.onCategories) nav.append(h('button', {type:'button', onclick:function(){ navDlg.close(); opts.onCategories(); }}, 'Categories and budgets'));
  else nav.append(h('a', {href:'index.html?open=categories'}, 'Categories and budgets'));
  nav.append(h('button', {type:'button', class:'last', onclick:askSignOut}, 'Sign out'));
}

/* ---------- sign-in screen ---------- */
const authView = h('main', {class:'wrap authwrap', id:'authView', hidden:true},
  h('p', {class:'brand'}, 'Budget ledger'),
  h('section', {class:'sheet authcard', 'aria-labelledby':'authTitle'},
    h('h1', {id:'authTitle', class:'say'}, 'Sign in to your budget'),
    h('form', {id:'authForm', novalidate:true},
      h('label', {class:'f', id:'fName', hidden:true}, h('span', null, 'Your first name'), h('input', {id:'uName', type:'text', autocomplete:'given-name', maxlength:40})),
      h('label', {class:'f', id:'fEmail'}, h('span', null, 'Email'), h('input', {id:'uEmail', type:'email', autocomplete:'email', inputmode:'email'})),
      h('label', {class:'f', id:'fPass'}, h('span', {id:'passLabel'}, 'Password'), h('input', {id:'uPass', type:'password', autocomplete:'current-password'})),
      h('p', {id:'authMsg', class:'err', role:'alert', hidden:true}),
      h('button', {id:'authGo', class:'btn primary', type:'submit'}, 'Sign in')),
    h('p', {class:'authlinks'},
      h('button', {class:'linkbtn', id:'toSignup', type:'button', onclick:function(){ showAuth('signup'); $('#uName').focus(); }}, 'Create an account'),
      h('button', {class:'linkbtn', id:'toForgot', type:'button', onclick:function(){ showAuth('forgot'); $('#uEmail').focus(); }}, 'Forgot your password?'),
      h('button', {class:'linkbtn', id:'toSignin', type:'button', hidden:true, onclick:function(){ showAuth('signin'); $('#uEmail').focus(); }}, 'Back to sign in'))));

/* ---------- short messages ---------- */
const toastEl = h('div', {id:'toast', class:'toast', role:'status', hidden:true});
let toastTimer = null;
function hideToast(){ toastEl.hidden = true; clearTimeout(toastTimer); }
function toast(msg, actionLabel, action){
  toastEl.textContent = '';
  toastEl.append(h('span', null, msg));
  if (actionLabel) toastEl.append(h('button', {class:'linkbtn', type:'button', onclick:function(){ hideToast(); action(); }}, actionLabel));
  toastEl.hidden = false; clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, actionLabel ? 9000 : 4000);
}

document.body.prepend(header, authView);
document.body.append(navDlg, toastEl);

function showView(name){
  authView.hidden = name !== 'auth';
  const app = $('#appView'); if (app) app.hidden = name !== 'app';
  menuBtn.hidden = name !== 'app';
}
function authMsg(text, ok){ const m = $('#authMsg'); m.textContent = text || ''; m.hidden = !text; m.className = ok ? 'note' : 'err'; }
function showAuth(m){
  authMode = m;
  const T = {
    signin:{title:'Sign in to your budget', go:'Sign in'},
    signup:{title:'Create your account', go:'Create account'},
    forgot:{title:'Reset your password', go:'Send reset link'},
    newpass:{title:'Choose a new password', go:'Save password'}
  }[m];
  $('#authTitle').textContent = T.title; $('#authGo').textContent = T.go;
  $('#fName').hidden = m !== 'signup';
  $('#fEmail').hidden = m === 'newpass';
  $('#fPass').hidden = m === 'forgot';
  $('#passLabel').textContent = m === 'signin' ? 'Password' : m === 'newpass' ? 'New password, 8 characters or more' : 'Password, 8 characters or more';
  $('#uPass').autocomplete = m === 'signin' ? 'current-password' : 'new-password';
  $('#uPass').value = '';
  $('#toSignup').hidden = m !== 'signin'; $('#toForgot').hidden = m !== 'signin';
  $('#toSignin').hidden = m === 'signin' || m === 'newpass';
  authMsg(''); showView('auth');
}
function authError(err, email){
  const t = String((err && err.message) || ''), st = err && err.status;
  if (/invalid login credentials/i.test(t)) return 'That email and password do not match an account.';
  if (/email not confirmed/i.test(t)) return 'Confirm your email first. Open the link sent to ' + email + ', then sign in.';
  if (/already registered/i.test(t)) return 'That email already has an account. Sign in instead.';
  if (/rate limit|too many/i.test(t) || st === 429) return 'Too many attempts. Wait a few minutes, then try again.';
  if (!st || /failed to fetch|network/i.test(t)) return 'The server could not be reached. Check your connection, then try again.';
  return t || 'That did not work. Try again.';
}
async function authSubmit(e){
  e.preventDefault();
  if (authBusy || !sb) return;
  const email = $('#uEmail').value.trim(), pass = $('#uPass').value, name = $('#uName').value.trim();
  const here = /^https?:/.test(location.protocol) ? location.origin + location.pathname : undefined;
  if (authMode !== 'newpass' && !/^\S+@\S+\.\S+$/.test(email)){ authMsg('Enter your email address.'); $('#uEmail').focus(); return; }
  if (authMode === 'signup' && !name){ authMsg('Enter your first name. It labels your budget.'); $('#uName').focus(); return; }
  if (authMode === 'signin' && !pass){ authMsg('Enter your password.'); $('#uPass').focus(); return; }
  if ((authMode === 'signup' || authMode === 'newpass') && pass.length < 8){ authMsg('Use a password with 8 characters or more.'); $('#uPass').focus(); return; }
  authBusy = true; $('#authGo').disabled = true; authMsg('');
  const was = authMode;
  let res;
  try {
    if (was === 'signin') res = await sb.auth.signInWithPassword({email:email, password:pass});
    else if (was === 'signup') res = await sb.auth.signUp({email:email, password:pass, options:{data:{name:name}, emailRedirectTo:here}});
    else if (was === 'forgot') res = await sb.auth.resetPasswordForEmail(email, {redirectTo:here});
    else res = await sb.auth.updateUser({password:pass});
  } catch (err) { res = {error:err}; }
  authBusy = false; $('#authGo').disabled = false;
  res = res || {};
  if (res.error){ authMsg(authError(res.error, email)); return; }
  if (was === 'signup'){
    const u = res.data && res.data.user;
    if (u && Array.isArray(u.identities) && !u.identities.length){ showAuth('signin'); authMsg('That email already has an account. Sign in instead.'); }
    else if (!(res.data && res.data.session)){ showAuth('signin'); authMsg('Almost there. Open the confirmation link sent to ' + email + ', then sign in here.', true); }
  } else if (was === 'forgot'){
    showAuth('signin'); authMsg('If ' + email + ' has an account, a reset link is on its way.', true);
  } else if (was === 'newpass'){
    recovering = false;
    const r = await settle(sb.auth.getSession());
    const u = r.data && r.data.session && r.data.session.user;
    if (!u){ showAuth('signin'); authMsg('Password saved. Sign in with it.', true); }
    else if (!user || u.id !== user.id) enter(u);
    else showView('app');
    toast('Password saved');
  }
}
$('#authForm').addEventListener('submit', authSubmit);

/* ---------- who is signed in ---------- */
const nameOf = u => String((u && u.user_metadata && u.user_metadata.name) || '').trim().slice(0, 40);
// The people who share this ledger, as the database lists them: [{user_id, name}].
// Empty when the account is not on the list.
function members(){
  if (!user || !sb) return Promise.resolve([]);
  if (!membersP) membersP = settle(sb.rpc('ledger_people')).then(function(r){
    if (r.error || !Array.isArray(r.data)) return [];
    return r.data.filter(m => m && m.user_id && m.name).map(m => ({user_id:String(m.user_id), name:String(m.name).slice(0, 40)}));
  });
  return membersP;
}
function enter(u){
  user = u; membersP = null;
  acct.textContent = nameOf(u) || u.email || '';
  $('#uPass').value = '';
  showView('app');
  if (opts.onEnter) opts.onEnter(u);
  members().then(function(list){
    if (user !== u) return;
    const me = list.find(m => m.user_id === u.id);
    if (me){ acct.textContent = me.name; if (opts.onName) opts.onName(me.name); }
  });
}
function leave(){
  user = null; membersP = null;
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  hideToast(); acct.textContent = '';
  if (opts.onLeave) opts.onLeave();
  showAuth('signin');
}
function onAuth(event, session){
  if (event === 'PASSWORD_RECOVERY'){ recovering = true; showAuth('newpass'); return; }
  const u = session && session.user;
  if (!u){ if (user || !booted) leave(); booted = true; return; }
  booted = true;
  if (recovering){ if (authView.hidden) showAuth('newpass'); return; }
  if (!user || u.id !== user.id) enter(u);
}
async function doSignOut(){
  const res = await settle(sb.auth.signOut({scope:'local'}));
  if (res.error) toast('Sign out did not go through. Check your connection, then try again.');
}
function askSignOut(){
  navDlg.close();
  if (opts.hasUnsaved && opts.hasUnsaved()) toast('Some changes are not saved yet.', 'Sign out anyway', doSignOut);
  else doSignOut();
}

/* ---------- start ---------- */
// opts: page ('home' | 'dashboard'), onEnter(user), onLeave(), onName(name),
//       onCategories() when this page can open the categories editor itself, hasUnsaved().
function start(o){
  opts = o || {};
  buildNav();
  if (!sb){ showAuth('signin'); authMsg('The app did not load completely. Reload the page.'); return; }
  sb.auth.onAuthStateChange(function(event, session){
    setTimeout(function(){
      onAuth(event, session);
      if (linkErr && !user && event === 'INITIAL_SESSION'){
        authMsg('That link did not work (' + linkErr.replace(/\+/g, ' ') + '). Request a new one.');
        try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
      }
    }, 0);
  });
}

window.Shell = {sb:sb, $:$, h:h, s:s, settle:settle, toast:toast, hideToast:hideToast, start:start, nameOf:nameOf, members:members, user:function(){ return user; }};
})();

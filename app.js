'use strict';
/* Штаб — проекты, сроки оплат, задачи, заметки. Данные лежат в data/db.json рядом с сервером. */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const COLORS = { orange: '#E8892B', pink: '#E0508F', yellow: '#F4C531', teal: '#2AA9C9', red: '#D8402F', green: '#9DB04A' };
const KINDS = ['Домен', 'SSL', 'Сервер', 'Хостинг', 'Подписка', 'Другое'];
const PERIODS = { none: 'разово', month: 'каждый месяц', quarter: 'раз в 3 месяца', halfyear: 'раз в полгода', year: 'раз в год' };
const PER_MONTHS = { month: 1, quarter: 3, halfyear: 6, year: 12 };
const CUR = { rub: '₽', usd: '$', eur: '€' };
const TYPE_LABEL = { task: 'Задача', note: 'Заметка', pay: 'Срок', link: 'Ссылка' };
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

let db = { version: 1, projects: [], items: [] }, rev = '', prevSnapshot = null, saveChain = Promise.resolve(), saving = 0;
const cap = { type: 'task', text: '', project: localStorage.getItem('shtab-project') || '' };

/* ---------- даты ---------- */
const pad = n => String(n).padStart(2, '0');
const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const parseIso = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const daysTo = s => { const d = parseIso(s); return d ? Math.round((d - today()) / 864e5) : null; };
function fmtDate(s, withWd) {
  const d = parseIso(s); if (!d) return '';
  return d.getDate() + ' ' + MONTHS[d.getMonth()] + (d.getFullYear() !== today().getFullYear() ? ' ' + d.getFullYear() : '') + (withWd ? ', ' + WD[d.getDay()] : '');
}
function whenText(s) {
  const n = daysTo(s); if (n == null) return '';
  if (n === 0) return 'сегодня'; if (n === 1) return 'завтра'; if (n === -1) return 'вчера';
  return n < 0 ? 'просрочено ' + -n + ' дн.' : 'через ' + n + ' дн.';
}
function addMonths(s, n) {
  const d = parseIso(s), day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return iso(d);
}
const plural = (n, a, b, c) => { const m = Math.abs(n) % 100, k = m % 10; return m > 10 && m < 20 ? c : k === 1 ? a : k >= 2 && k <= 4 ? b : c; };
const levelOf = n => n == null ? '' : n < 0 ? 'over' : n <= 7 ? 'hot' : n <= 30 ? 'warm' : 'calm';
const payLevel = it => { const n = daysTo(it.date); return it.auto && n > 7 ? 'calm' : levelOf(n); };

/* Дата из обычной фразы: «завтра», «в пятницу», «до 15.12», «15 декабря». Возвращает {date, rest}. */
function pullDate(text) {
  const t0 = today(), mk = (y, m, d) => { const x = new Date(y, m, d); return x.getFullYear() === y && x.getMonth() === m && x.getDate() === d ? x : null; };
  const B = '(^|\\s)(?:до\\s+|к\\s+)?', E = '(?=\\s|$|[,.!])';
  const tries = [
    [new RegExp(B + '(сегодня|завтра|послезавтра)' + E, 'i'), m => { const d = new Date(t0); d.setDate(d.getDate() + ['сегодня', 'завтра', 'послезавтра'].indexOf(m[2].toLowerCase())); return d; }],
    [new RegExp('(^|\\s)(?:до\\s+|к\\s+|в\\s+|во\\s+)?(понедельник[ау]?|вторник[ау]?|сред[ауеы]|четверг[ау]?|пятниц[ауеы]|суббот[ауеы]|воскресень[еюя])' + E, 'i'), m => {
      const i = ['вос', 'пон', 'вто', 'сре', 'чет', 'пят', 'суб'].indexOf(m[2].toLowerCase().slice(0, 3));
      const d = new Date(t0), diff = (i - d.getDay() + 7) % 7 || 7; d.setDate(d.getDate() + diff); return d;
    }],
    [new RegExp(B + '(\\d{1,2})[./](\\d{1,2})(?:[./](\\d{4}|\\d{2}))?' + E), m => {
      if (m[4]) return mk(+(m[4].length === 2 ? '20' + m[4] : m[4]), +m[3] - 1, +m[2]);
      let d = mk(t0.getFullYear(), +m[3] - 1, +m[2]); if (d && d < t0) d = mk(t0.getFullYear() + 1, +m[3] - 1, +m[2]); return d;
    }],
    [new RegExp(B + '(\\d{1,2})\\s+(янв|фев|мар|апр|ма[йя]|июн|июл|авг|сен|окт|ноя|дек)[а-яё]*(?:\\s+(\\d{4}))?' + E, 'i'), m => {
      const mi = ['янв', 'фев', 'мар', 'апр', 'ма', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'].findIndex(x => m[3].toLowerCase().startsWith(x));
      if (m[4]) return mk(+m[4], mi, +m[2]);
      let d = mk(t0.getFullYear(), mi, +m[2]); if (d && d < t0) d = mk(t0.getFullYear() + 1, mi, +m[2]); return d;
    }],
  ];
  for (const [re, fn] of tries) {
    const m = re.exec(text); if (!m) continue;
    const d = fn(m); if (!d) continue;
    const rest = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').replace(/^[\s,.-]+|[\s,-]+$/g, '');
    return { date: iso(d), rest };
  }
  return { date: '', rest: text.trim() };
}

/* ---------- прочее ---------- */
const safeUrl = u => { u = String(u || '').trim(); if (!u) return ''; if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u; try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };
const hostOf = u => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return ''; } };
const money = (a, c) => Number(a).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ' + (CUR[c] || '₽');
const project = id => db.projects.find(p => p.id === id);
const itemsOf = (pid, type) => db.items.filter(i => i.projectId === pid && (!type || i.type === type));
const byDate = (a, b) => (a.date || a.due || '9999').localeCompare(b.date || b.due || '9999');

function art(seed, colorKey) {
  let h = 2166136261; for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return (h >>> 0) / 4294967296; };
  const main = COLORS[colorKey] || COLORS.orange, pal = Object.values(COLORS), ground = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s1)'];
  const stops = []; let x = 0;
  while (x < 100) {
    const r = rnd(), colored = r > 0.66, w = colored ? 0.3 + rnd() * 2.6 : 0.6 + rnd() * 5.5, nx = Math.min(100, x + w);
    const c = colored ? (rnd() < 0.5 ? main : pal[Math.floor(rnd() * pal.length)]) : ground[Math.floor(rnd() * ground.length)];
    stops.push(`${c} ${x.toFixed(2)}% ${nx.toFixed(2)}%`); x = nx;
  }
  return 'background:linear-gradient(90deg,' + stops.join(',') + ')';
}

/* ---------- хранение ---------- */
async function api(path, opt) {
  const r = await fetch(path, opt), j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'Ошибка ' + r.status); e.status = r.status; e.body = j; throw e; }
  return j;
}
const LOCAL = !/^(127\.0\.0\.1|localhost)$/.test(location.hostname); // на сайте сервера нет: данные живут в этом браузере
const LS_KEY = 'shtab-db';
async function load() {
  if (LOCAL) { const raw = localStorage.getItem(LS_KEY); if (raw) { const d = JSON.parse(raw); if (d && Array.isArray(d.projects) && Array.isArray(d.items)) db = d; } return; }
  const j = await api('/api/db'); db = j.data; rev = j.rev;
}
function commit(msg, undoable = true) {
  render();
  if (msg) toast(msg, undoable && prevSnapshot ? 'Отменить' : '', undo);
  saving++;
  saveChain = saveChain.then(async () => {
    try {
      if (LOCAL) { try { localStorage.setItem(LS_KEY, JSON.stringify(db)); } catch { toast('Не сохранилось: браузер не дал записать данные. Скачай копию через меню ⋯.'); } return; }
      const j = await api('/api/db', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Shtab': '1' }, body: JSON.stringify({ rev, data: db }) });
      rev = j.rev;
    } catch (e) {
      if (e.status === 409) { await load(); prevSnapshot = null; render(); toast('Данные поменялись в другом окне. Показал свежие, последнее действие повтори.'); }
      else toast('Не сохранилось: сервер Штаба не отвечает. Запусти ярлык «Shtab» ещё раз.', 'Повторить', () => commit());
    } finally { saving--; }
  });
  return saveChain;
}
const change = (fn, msg) => { prevSnapshot = JSON.stringify(db); fn(); return commit(msg); };
function undo() { if (!prevSnapshot) return; db = JSON.parse(prevSnapshot); prevSnapshot = null; commit('Вернул как было', false); }
async function refreshIfChanged() {
  if (LOCAL || saving || $('#dlg').open) return;
  try { const j = await api('/api/rev'); if (j.rev !== rev && !saving) { await load(); prevSnapshot = null; render(); } } catch { /* сервер выключен — промолчим до следующего сохранения */ }
}

/* ---------- тосты ---------- */
let toastTimer;
function toast(msg, action, fn) {
  const t = $('#toast');
  t.innerHTML = '<span>' + esc(msg) + '</span>' + (action ? '<button type="button">' + esc(action) + '</button>' : '');
  if (action) $('button', t).onclick = () => { t.classList.remove('on'); fn(); };
  t.classList.add('on'); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), action ? 8000 : 4500);
}

/* ---------- маршрут ---------- */
const route = () => { const m = /^#\/p\/([\w-]+)/.exec(location.hash); return m && project(m[1]) ? { view: 'project', id: m[1] } : { view: 'home' }; };

/* ---------- строки ---------- */
const projTag = it => { const p = project(it.projectId); return p ? `<a class="tag" href="#/p/${esc(p.id)}">${esc(p.name)}</a>` : ''; };
function payRow(it, showProj) {
  const lvl = it.done ? '' : payLevel(it), bits = [esc(it.kind || '')];
  if (it.amount) bits.push(esc(money(it.amount, it.cur)) + (it.period && it.period !== 'none' ? ' ' + PERIODS[it.period] : ''));
  else if (it.period && it.period !== 'none') bits.push(PERIODS[it.period]);
  if (it.auto) bits.push('продлевается само');
  if (it.where) bits.push(esc(it.where));
  if (it.checked) bits.push('сверено ' + esc(fmtDate(it.checked)));
  const url = safeUrl(it.url), canCheck = !LOCAL && it.domain && (it.kind === 'Домен' || it.kind === 'SSL');
  return `<li class="row lvl-${lvl}${it.done ? ' done' : ''}" data-id="${esc(it.id)}">
    <span class="dot"></span>
    <div class="row-main"><button type="button" class="row-title" data-act="edit" data-id="${esc(it.id)}">${esc(it.title)}</button>
      <div class="row-sub">${bits.filter(Boolean).join(' · ')}${showProj ? ' ' + projTag(it) : ''}</div></div>
    <div class="row-side"><span class="when">${it.done ? 'закрыто' : esc(whenText(it.date))} · ${esc(fmtDate(it.date))}</span>
      ${it.done ? `<button type="button" class="mini" data-act="reopen" data-id="${esc(it.id)}">Вернуть</button>` : `
      ${canCheck ? `<button type="button" class="mini" data-act="check" data-id="${esc(it.id)}" title="Узнать настоящий срок из сети">Сверить</button>` : ''}
      ${url ? `<a class="mini pill" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Оплатить ↗</a>` : ''}
      <button type="button" class="mini" data-act="paid" data-id="${esc(it.id)}">Оплачено</button>`}</div></li>`;
}
function taskRow(it, showProj) {
  const n = it.due ? daysTo(it.due) : null, lvl = it.done || n == null ? '' : n < 0 ? 'over' : n <= 1 ? 'hot' : '';
  return `<li class="row lvl-${lvl}${it.done ? ' done' : ''}" data-id="${esc(it.id)}">
    <input type="checkbox" class="check" data-act="toggle" data-id="${esc(it.id)}" ${it.done ? 'checked' : ''} aria-label="Готово: ${esc(it.title)}">
    <div class="row-main"><button type="button" class="row-title" data-act="edit" data-id="${esc(it.id)}">${esc(it.title)}</button>
      ${it.note || showProj ? `<div class="row-sub">${esc((it.note || '').split('\n')[0].slice(0, 140))}${showProj ? ' ' + projTag(it) : ''}</div>` : ''}</div>
    ${it.due ? `<div class="row-side"><span class="when">${it.done ? '' : esc(whenText(it.due)) + ' · '}${esc(fmtDate(it.due))}</span></div>` : ''}</li>`;
}
function linkRow(it) {
  const url = safeUrl(it.url);
  return `<li class="row" data-id="${esc(it.id)}"><div class="row-main">
    ${url ? `<a class="row-title" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(it.title || hostOf(url))} ↗</a>` : `<span class="row-title">${esc(it.title)}</span>`}
    <div class="row-sub">${esc([hostOf(url), it.note].filter(Boolean).join(' · '))}</div></div>
    <div class="row-side"><button type="button" class="mini" data-act="edit" data-id="${esc(it.id)}">Изменить</button></div></li>`;
}
const noteCard = it => `<button type="button" class="note" data-act="edit" data-id="${esc(it.id)}">${it.title ? `<b>${esc(it.title)}</b>` : ''}<span class="txt">${esc(it.text || '')}</span><small>${it.pinned ? 'закреплено · ' : ''}${esc(fmtDate((it.updated || '').slice(0, 10)))}</small></button>`;

/* ---------- экран ---------- */
function captureHtml(pid) {
  const types = ['task', 'note', 'pay', 'link'];
  return `<form class="capture" id="capture" autocomplete="off">
    <input id="cap" value="${esc(cap.text)}" placeholder="${{ task: 'Что сделать? Можно с датой: «продлить домен до 15.12»', note: 'Быстрая заметка', pay: 'Что оплачивать? Например «VPS Timeweb 20 декабря»', link: 'Вставь ссылку' }[cap.type]}" aria-label="Быстрая запись">
    ${pid ? '' : `<select id="cap-project" class="pill" aria-label="Проект">${db.projects.map(p => `<option value="${esc(p.id)}" ${p.id === cap.project ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`}
    <div class="seg" role="group" aria-label="Что записываем">${types.map(t => `<button type="button" data-act="cap-type" data-type="${t}" class="${cap.type === t ? 'on' : ''}">${TYPE_LABEL[t]}</button>`).join('')}</div>
    <button class="go" type="submit">Записать</button></form>
    <p class="cap-hint" id="cap-hint">${capHint()}</p>`;
}
function capHint() {
  const t = cap.text.trim();
  if (!t) return 'Enter — записать. Ctrl+K — поиск по всему.';
  if (cap.type !== 'link' && safeUrl(t) && /^(https?:\/\/|www\.)\S+$/i.test(t)) return 'Похоже на ссылку — сохраню как ссылку.';
  if (cap.type === 'task' || cap.type === 'pay') { const p = pullDate(t); return p.date ? 'Срок: ' + esc(fmtDate(p.date, true)) + ' (' + esc(whenText(p.date)) + ')' : cap.type === 'task' ? 'Без срока. Дату можно написать прямо в тексте: «завтра», «в пятницу», «15.12».' : 'Дальше спрошу дату и сумму.'; }
  return 'Enter — записать.';
}

function renderNav() {
  const r = route();
  $('#nav').innerHTML = `<a class="brand" href="#/"><span class="bars"><i></i><i></i><i></i><i></i></span>ШТАБ</a>
    <div class="tabs"><a class="tab ${r.view === 'home' ? 'on' : ''}" href="#/">Сводка</a>${db.projects.map(p => {
    const n = db.items.filter(i => i.projectId === p.id && !i.done && ((i.type === 'pay' && payLevel(i) === 'over') || (i.type === 'task' && i.due && daysTo(i.due) < 0))).length;
    return `<a class="tab ${r.id === p.id ? 'on' : ''}" href="#/p/${esc(p.id)}">${esc(p.name)}${n ? `<span class="n" title="просрочено">${n}</span>` : ''}</a>`;
  }).join('')}</div>
    <div class="nav-right"><button type="button" class="pill quiet" data-act="search">Найти <kbd>Ctrl K</kbd></button>
      <button type="button" class="pill" data-act="new-project">+ Проект</button>
      <div class="menu"><button type="button" class="pill quiet" data-act="menu" aria-label="Меню" aria-expanded="false">⋯</button>
        <div class="menu-list" id="menu" hidden>
          <button type="button" data-act="theme">${document.documentElement.dataset.theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}</button>
          <button type="button" data-act="export">Скачать копию данных</button>
          <button type="button" data-act="import">Загрузить копию</button></div></div></div>`;
}

function renderHome() {
  if (!db.projects.length) return `<section class="hello"><p class="eyebrow">Штаб</p><h1 class="serif"><b>Пока пусто.</b> Заведи первый проект — в нём будут сроки оплат, задачи, заметки и ссылки.</h1></section>
    <form class="start" id="start"><input name="name" placeholder="Название проекта, например Эмпатия" aria-label="Название проекта" required><button type="submit">Создать</button></form>`;
  const open = db.items.filter(i => !i.done);
  const pays = open.filter(i => i.type === 'pay').sort(byDate), tasks = open.filter(i => i.type === 'task');
  const over = pays.filter(i => payLevel(i) === 'over').length + tasks.filter(i => i.due && daysTo(i.due) < 0).length;
  const weekP = pays.filter(i => { const n = daysTo(i.date); return n >= 0 && n <= 7; }).length;
  const weekT = tasks.filter(i => { const n = i.due ? daysTo(i.due) : null; return n != null && n >= 0 && n <= 7; }).length;
  const next = pays.find(i => daysTo(i.date) >= 0);
  const parts = [];
  if (over) parts.push(`<b>${plural(over, 'Просрочен', 'Просрочено', 'Просрочено')} ${over} ${plural(over, 'пункт', 'пункта', 'пунктов')}.</b>`);
  if (weekP || weekT) parts.push(`<b>На этой неделе ${[weekP && weekP + ' ' + plural(weekP, 'срок', 'срока', 'сроков'), weekT && weekT + ' ' + plural(weekT, 'задача', 'задачи', 'задач')].filter(Boolean).join(' и ')}.</b>`);
  if (!over && !weekP && !weekT) parts.push('<b>На этой неделе ничего не горит.</b>');
  if (next && !weekP) parts.push(`Ближайшая оплата — ${esc(next.title)}, ${esc(fmtDate(next.date))}.`);
  if (!pays.length) parts.push('Сроков оплат пока нет — добавь домены и серверы.');
  const d = new Date(), shownP = pays.filter(i => daysTo(i.date) <= 60), laterP = pays.length - shownP.length;
  const sortedT = tasks.slice().sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (b.created || '').localeCompare(a.created || ''));
  const shownT = sortedT.slice(0, 12);
  return `<section class="hello"><p class="eyebrow">${d.getDate()} ${MONTHS[d.getMonth()]}, ${WD[d.getDay()]}</p><h1 class="serif">${parts.join(' ')}</h1></section>
    ${captureHtml(null)}
    <div class="grid">
      <section class="panel"><div class="panel-head"><h2>Сроки и оплаты</h2><span class="cnt">ближайшие 60 дней</span></div>
        ${shownP.length ? `<ul class="list">${shownP.map(i => payRow(i, true)).join('')}</ul>` : `<p class="empty">${pays.length ? 'В ближайшие 60 дней платить не за что.' : 'Пусто. Выбери «Срок» в строке выше и запиши первый.'}</p>`}
        ${laterP > 0 ? `<p class="row-sub" style="margin-top:10px">Позже: ещё ${laterP}. Смотри в проектах.</p>` : ''}</section>
      <section class="panel"><div class="panel-head"><h2>Задачи</h2><span class="cnt">${tasks.length ? 'открыто ' + tasks.length : ''}</span></div>
        ${shownT.length ? `<ul class="list">${shownT.map(i => taskRow(i, true)).join('')}</ul>` : '<p class="empty">Открытых задач нет.</p>'}
        ${sortedT.length > shownT.length ? `<p class="row-sub" style="margin-top:10px">И ещё ${sortedT.length - shownT.length} в проектах.</p>` : ''}</section>
    </div>
    <div class="section-title"><p class="eyebrow">Проекты</p></div>
    <div class="cards">${db.projects.map(p => {
    const it = itemsOf(p.id).filter(i => !i.done), pp = it.filter(i => i.type === 'pay').sort(byDate), tt = it.filter(i => i.type === 'task');
    const ov = pp.filter(i => payLevel(i) === 'over').length + tt.filter(i => i.due && daysTo(i.due) < 0).length, nx = pp.find(i => daysTo(i.date) >= 0);
    return `<a class="card" href="#/p/${esc(p.id)}"><div class="art" style="${art(p.id, p.color)}"></div><div class="card-body"><h3>${esc(p.name)}</h3>
      ${ov ? `<p class="alert">Просрочено: ${ov}</p>` : ''}
      <p>${nx ? 'Ближайшая оплата ' + esc(fmtDate(nx.date)) + ' — ' + esc(nx.title) : 'Сроков оплат нет'}</p>
      <p>${tt.length} ${plural(tt.length, 'задача', 'задачи', 'задач')} · ${it.filter(i => i.type === 'note').length} ${plural(it.filter(i => i.type === 'note').length, 'заметка', 'заметки', 'заметок')}</p></div></a>`;
  }).join('')}<button type="button" class="card new" data-act="new-project">+ Новый проект</button></div>`;
}

function renderProject(p) {
  const pays = itemsOf(p.id, 'pay'), openP = pays.filter(i => !i.done).sort(byDate), doneP = pays.filter(i => i.done);
  const tasks = itemsOf(p.id, 'task'), openT = tasks.filter(i => !i.done).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (b.created || '').localeCompare(a.created || '')), doneT = tasks.filter(i => i.done).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
  const notes = itemsOf(p.id, 'note').sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updated || '').localeCompare(a.updated || ''));
  const links = itemsOf(p.id, 'link');
  const perYear = {}; for (const i of openP) if (i.amount && PER_MONTHS[i.period]) perYear[i.cur || 'rub'] = (perYear[i.cur || 'rub'] || 0) + Number(i.amount) * 12 / PER_MONTHS[i.period];
  const yearTxt = Object.entries(perYear).map(([c, v]) => money(Math.round(v), c)).join(' + ');
  return `<section class="cover"><div class="art" style="${art(p.id, p.color)}"></div>
      <button type="button" class="pill quiet edit" data-act="edit-project">Изменить проект</button>
      <div class="cover-text"><p class="eyebrow">Проект</p><h1 class="serif">${esc(p.name)}</h1>${p.desc ? `<p class="desc">${esc(p.desc)}</p>` : ''}</div></section>
    ${captureHtml(p.id)}
    <div class="grid">
      <div class="col">
        <section class="panel"><div class="panel-head"><h2>Сроки и оплаты</h2><span class="grow"></span><button type="button" class="mini" data-act="add" data-type="pay">+ Срок</button></div>
          ${yearTxt ? `<p class="panel-sub">Регулярные платежи: примерно ${esc(yearTxt)} в год.</p>` : ''}
          ${openP.length ? `<ul class="list">${openP.map(i => payRow(i)).join('')}</ul>` : '<p class="empty">Запиши сюда домены, серверы, хостинг и подписки — Штаб подсветит, когда пора платить.</p>'}
          ${doneP.length ? `<details class="more"><summary>Закрытые: ${doneP.length}</summary><ul class="list">${doneP.map(i => payRow(i)).join('')}</ul></details>` : ''}</section>
        <section class="panel"><div class="panel-head"><h2>Ссылки и доступы</h2><span class="grow"></span><button type="button" class="mini" data-act="add" data-type="link">+ Ссылка</button></div>
          ${links.length ? `<ul class="list">${links.map(linkRow).join('')}</ul>` : '<p class="empty">Админка, личный кабинет регистратора, панель сервера. Пароли сюда не пиши: файл с данными не зашифрован.</p>'}</section>
      </div>
      <div class="col">
        <section class="panel"><div class="panel-head"><h2>Задачи</h2><span class="cnt">${openT.length ? 'открыто ' + openT.length : ''}</span><span class="grow"></span><button type="button" class="mini" data-act="add" data-type="task">+ Задача</button></div>
          ${openT.length ? `<ul class="list">${openT.map(i => taskRow(i)).join('')}</ul>` : '<p class="empty">Открытых задач нет. Пиши в строку сверху и жми Enter.</p>'}
          ${doneT.length ? `<details class="more"><summary>Сделано: ${doneT.length}</summary><ul class="list">${doneT.map(i => taskRow(i)).join('')}</ul></details>` : ''}</section>
        <section class="panel"><div class="panel-head"><h2>Заметки</h2><span class="grow"></span><button type="button" class="mini" data-act="add" data-type="note">+ Заметка</button></div>
          ${notes.length ? `<div class="notes">${notes.map(noteCard).join('')}</div>` : '<p class="empty">Договорённости, контакты, что где лежит.</p>'}</section>
      </div>
    </div>`;
}

function render() {
  const r = route(), keepFocus = document.activeElement && document.activeElement.id === 'cap';
  if (cap.project && !project(cap.project)) cap.project = '';
  if (!cap.project && db.projects[0]) cap.project = db.projects[0].id;
  renderNav();
  $('#main').innerHTML = (r.view === 'project' ? renderProject(project(r.id)) : renderHome()) + (LOCAL ? '<p class="foot">Данные хранятся только в этом браузере на этом устройстве. Чтобы не потерять, скачивай копию через меню ⋯.</p>' : '');
  document.title = r.view === 'project' ? project(r.id).name + ' — Штаб' : 'Штаб';
  if (keepFocus && $('#cap')) { const c = $('#cap'); c.focus(); c.setSelectionRange(c.value.length, c.value.length); }
}

/* ---------- формы ---------- */
function openForm({ title, fields, submit = 'Сохранить', onSubmit, onDelete, deleteLabel = 'Удалить', hint }) {
  const dlg = $('#dlg'); let dirty = false, warned = false;
  const field = f => {
    const a = `name="${f.name}" ${f.required ? 'required' : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}`;
    if (f.type === 'checkbox') return `<label class="f checkbox"><input type="checkbox" name="${f.name}" ${f.value ? 'checked' : ''}><span>${esc(f.label)}</span></label>`;
    if (f.type === 'colors') return `<div class="f"><span>${esc(f.label)}</span><div class="colors">${Object.entries(COLORS).map(([k, v]) => `<label title="${k}"><input type="radio" name="${f.name}" value="${k}" ${f.value === k ? 'checked' : ''}><i style="background:${v}"></i></label>`).join('')}</div></div>`;
    const ctl = f.type === 'select' ? `<select ${a}>${Object.entries(f.options).map(([k, v]) => `<option value="${esc(k)}" ${String(f.value) === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`
      : f.type === 'textarea' ? `<textarea ${a} class="${f.tall ? 'tall' : ''}">${esc(f.value || '')}</textarea>`
        : `<input type="${f.type || 'text'}" ${a} value="${esc(f.value ?? '')}" ${f.type === 'number' ? 'min="0" step="any" inputmode="decimal"' : ''}>`;
    return `<label class="f ${f.half ? 'half' : ''}"><span>${esc(f.label)}</span>${ctl}</label>`;
  };
  dlg.innerHTML = `<form class="form" novalidate><h2>${esc(title)}</h2>${fields.map(field).join('')}
    ${hint ? `<p class="hint">${esc(hint)}</p>` : ''}<p class="err" hidden></p>
    <div class="form-actions">${onDelete ? `<button type="button" class="btn ghost danger" data-del>${esc(deleteLabel)}</button>` : ''}<span class="grow"></span>
      <button type="button" class="btn ghost" data-cancel>Отмена</button><button type="submit" class="btn primary">${esc(submit)}</button></div></form>`;
  const form = $('form', dlg), err = $('.err', dlg), say = m => { err.textContent = m; err.hidden = !m; };
  form.oninput = () => { dirty = true; say(''); };
  form.onsubmit = e => {
    e.preventDefault();
    const v = {}; for (const f of fields) { const el = form.elements[f.name]; v[f.name] = f.type === 'checkbox' ? el.checked : f.type === 'colors' ? form.elements[f.name].value : String(el.value).trim(); }
    const miss = fields.find(f => f.required && !v[f.name]);
    if (miss) { say('Заполни поле «' + miss.label + '».'); form.elements[miss.name].focus(); return; }
    const m = onSubmit(v); if (m) return say(m);
    dlg.close();
  };
  form.onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); } };
  $('[data-cancel]', dlg).onclick = () => dlg.close();
  if (onDelete) { let armed = false; $('[data-del]', dlg).onclick = e => { const need = onDelete(armed); if (need) { armed = true; e.target.textContent = need; } else dlg.close(); }; }
  dlg.oncancel = e => { if (dirty && !warned) { e.preventDefault(); warned = true; say('Есть несохранённые правки. Esc ещё раз — закрыть без сохранения.'); } };
  dlg.onclick = e => { if (e.target === dlg && !dirty) dlg.close(); };
  dlg.showModal();
  const first = fields.find(f => !f.value && f.type !== 'checkbox' && f.type !== 'colors' && f.type !== 'select') || fields[0];
  if (first && form.elements[first.name] && form.elements[first.name].focus) form.elements[first.name].focus();
}
const projectOptions = () => Object.fromEntries(db.projects.map(p => [p.id, p.name]));

function projectForm(p) {
  openForm({
    title: p ? 'Проект' : 'Новый проект', submit: p ? 'Сохранить' : 'Создать',
    fields: [{ name: 'name', label: 'Название', value: p?.name, required: true, placeholder: 'Эмпатия' },
    { name: 'desc', label: 'Пара слов о проекте', type: 'textarea', value: p?.desc },
    { name: 'color', label: 'Цвет полосок', type: 'colors', value: p?.color || Object.keys(COLORS)[db.projects.length % 6] }],
    onSubmit: v => {
      if (p) change(() => Object.assign(p, v), 'Проект сохранён');
      else { const id = uid(); change(() => db.projects.push({ id, ...v, created: iso(new Date()) }), 'Проект создан'); location.hash = '#/p/' + id; }
    },
    onDelete: p && (armed => {
      const n = itemsOf(p.id).length;
      if (!armed && n) return `Точно? Удалится и ${n} ${plural(n, 'запись', 'записи', 'записей')}`;
      change(() => { db.projects = db.projects.filter(x => x.id !== p.id); db.items = db.items.filter(i => i.projectId !== p.id); }, 'Проект удалён');
      location.hash = '#/';
    }), deleteLabel: 'Удалить проект',
  });
}

function itemForm(type, it, preset = {}) {
  const v = it || preset, isNew = !it, pid = v.projectId || route().id || cap.project;
  const projField = { name: 'projectId', label: 'Проект', type: 'select', options: projectOptions(), value: pid, half: true };
  const defs = {
    pay: {
      title: isNew ? 'Новый срок' : 'Срок оплаты', hint: LOCAL ? '' : 'Домен нужен для кнопки «Сверить»: Штаб сам узнает срок регистрации или сертификата.',
      fields: [{ name: 'title', label: 'Что оплачиваем', value: v.title, required: true, placeholder: 'Домен empathycenter.ru' },
      { name: 'kind', label: 'Тип', type: 'select', options: Object.fromEntries(KINDS.map(k => [k, k])), value: v.kind || 'Домен', half: true },
      { name: 'date', label: 'Оплатить до', type: 'date', value: v.date, required: true, half: true },
      { name: 'period', label: 'Повтор', type: 'select', options: PERIODS, value: v.period || 'year', half: true },
        projField,
      { name: 'amount', label: 'Сумма', type: 'number', value: v.amount, half: true },
      { name: 'cur', label: 'Валюта', type: 'select', options: CUR, value: v.cur || 'rub', half: true },
      { name: 'domain', label: 'Домен (если есть)', value: v.domain, half: true, placeholder: 'empathycenter.ru' },
      { name: 'where', label: 'Где платить', value: v.where, half: true, placeholder: 'reg.ru' },
      { name: 'url', label: 'Ссылка на оплату', value: v.url, placeholder: 'https://' },
      { name: 'note', label: 'Заметка', type: 'textarea', value: v.note },
      { name: 'auto', label: 'Продлевается само (автосписание)', type: 'checkbox', value: v.auto }],
      check: f => { if (!parseIso(f.date)) return 'Дата указана неверно.'; if (f.amount && !(Number(f.amount) >= 0)) return 'Сумма должна быть числом.'; if (f.url && !safeUrl(f.url)) return 'Ссылка выглядит неправильно.'; },
    },
    task: {
      title: isNew ? 'Новая задача' : 'Задача',
      fields: [{ name: 'title', label: 'Что сделать', value: v.title, required: true },
      { name: 'due', label: 'Срок (не обязательно)', type: 'date', value: v.due, half: true }, projField,
      { name: 'note', label: 'Подробности', type: 'textarea', value: v.note }],
      check: f => { if (f.due && !parseIso(f.due)) return 'Дата указана неверно.'; },
    },
    note: {
      title: isNew ? 'Новая заметка' : 'Заметка', hint: 'Ctrl+Enter — сохранить.',
      fields: [{ name: 'title', label: 'Заголовок (не обязательно)', value: v.title },
      { name: 'text', label: 'Текст', type: 'textarea', tall: true, value: v.text, required: true }, projField,
      { name: 'pinned', label: 'Закрепить наверху', type: 'checkbox', value: v.pinned }],
    },
    link: {
      title: isNew ? 'Новая ссылка' : 'Ссылка', hint: 'Пароли сюда не пиши: файл с данными лежит на диске в открытом виде.',
      fields: [{ name: 'url', label: 'Адрес', value: v.url, required: true, placeholder: 'https://' },
      { name: 'title', label: 'Название', value: v.title, placeholder: 'Админка сайта', half: true }, projField,
      { name: 'note', label: 'Заметка', value: v.note, placeholder: 'логин такой-то, пароль в менеджере паролей' }],
      check: f => { if (!safeUrl(f.url)) return 'Ссылка выглядит неправильно.'; },
    },
  }[type];
  openForm({
    title: defs.title, fields: defs.fields, hint: defs.hint, submit: isNew ? 'Добавить' : 'Сохранить',
    onSubmit: f => {
      const bad = defs.check && defs.check(f); if (bad) return bad;
      if (!project(f.projectId)) return 'Выбери проект.';
      if (type === 'link') f.url = safeUrl(f.url);
      if (type === 'pay') { f.url = f.url ? safeUrl(f.url) : ''; f.amount = f.amount ? Number(f.amount) : ''; f.domain = f.domain.toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, ''); }
      const now = new Date().toISOString();
      if (isNew) change(() => db.items.push({ id: uid(), type, ...f, created: now, updated: now }), TYPE_LABEL[type] + ': записано');
      else change(() => Object.assign(it, f, { updated: now }), 'Сохранено');
    },
    onDelete: it && (() => { change(() => { db.items = db.items.filter(x => x.id !== it.id); }, 'Удалено'); }),
  });
}

/* ---------- действия ---------- */
function quickAdd() {
  const text = cap.text.trim(), pid = route().id || cap.project;
  if (!text) return $('#cap').focus();
  if (!project(pid)) return toast('Сначала создай проект.');
  const now = new Date().toISOString(), base = { id: uid(), projectId: pid, created: now, updated: now };
  const asLink = /^(https?:\/\/|www\.)\S+$/i.test(text) && safeUrl(text);
  const type = asLink ? 'link' : cap.type;
  if (type === 'pay') { const p = pullDate(text); cap.text = ''; render(); return itemForm('pay', null, { title: p.rest || text, date: p.date, projectId: pid, kind: /домен/i.test(text) ? 'Домен' : /ssl|сертификат/i.test(text) ? 'SSL' : /vps|сервер|vds|облак/i.test(text) ? 'Сервер' : /хостинг/i.test(text) ? 'Хостинг' : 'Другое' }); }
  let item, msg;
  if (type === 'link') { const u = safeUrl(text); if (!u) return toast('Это не похоже на ссылку.'); item = { ...base, type: 'link', url: u, title: hostOf(u), note: '' }; msg = 'Ссылка сохранена'; }
  else if (type === 'note') { item = { ...base, type: 'note', title: '', text, pinned: false }; msg = 'Заметка сохранена'; }
  else { const p = pullDate(text); item = { ...base, type: 'task', title: p.rest || text, due: p.date, note: '', done: false }; msg = p.date ? 'Задача записана, срок ' + fmtDate(p.date) : 'Задача записана'; }
  cap.text = '';
  change(() => db.items.push(item), msg + (route().view === 'home' ? ' → ' + project(pid).name : ''));
  $('#cap')?.focus();
}
async function checkItem(it, btn) {
  btn.disabled = true; btn.textContent = 'Сверяю…';
  try {
    const r = await api('/api/check?what=' + (it.kind === 'SSL' ? 'ssl' : 'domain') + '&domain=' + encodeURIComponent(it.domain));
    const old = it.date, live = db.items.find(x => x.id === it.id); if (!live) return;
    change(() => { live.date = r.date; live.checked = iso(new Date()); },
      r.date === old ? `Срок верный: ${fmtDate(r.date)}${r.info ? ' (' + r.info + ')' : ''}` : `Срок исправлен: было ${fmtDate(old)}, на самом деле ${fmtDate(r.date)}`);
  } catch (e) { btn.disabled = false; btn.textContent = 'Сверить'; toast('Не получилось сверить: ' + e.message); }
}
function exportData() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(db, null, 1)], { type: 'application/json' }));
  a.download = 'shtab-' + iso(new Date()) + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function importData() {
  const inp = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
  inp.onchange = async () => {
    try {
      const d = JSON.parse(await inp.files[0].text());
      if (!d || !Array.isArray(d.projects) || !Array.isArray(d.items)) throw 0;
      change(() => { db = { version: 1, projects: d.projects, items: d.items }; }, `Загружено: проектов ${d.projects.length}, записей ${d.items.length}`);
      location.hash = '#/';
    } catch { toast('Это не файл копии Штаба.'); }
  };
  inp.click();
}
function setTheme(t) { document.documentElement.dataset.theme = t; localStorage.setItem('shtab-theme', t); }

document.addEventListener('click', e => {
  const menu = $('#menu'); if (menu && !menu.hidden && !e.target.closest('.menu')) menu.hidden = true;
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act, it = el.dataset.id && db.items.find(x => x.id === el.dataset.id);
  if (act === 'menu') { menu.hidden = !menu.hidden; el.setAttribute('aria-expanded', String(!menu.hidden)); }
  else if (act === 'theme') { setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); render(); }
  else if (act === 'export') { menu.hidden = true; exportData(); }
  else if (act === 'import') { menu.hidden = true; importData(); }
  else if (act === 'search') openSearch();
  else if (act === 'new-project') projectForm();
  else if (act === 'edit-project') projectForm(project(route().id));
  else if (act === 'cap-type') { cap.type = el.dataset.type; render(); $('#cap').focus(); }
  else if (act === 'add') itemForm(el.dataset.type);
  else if (!it) return;
  else if (act === 'edit') itemForm(it.type, it);
  else if (act === 'toggle') change(() => { it.done = !it.done; it.doneAt = it.done ? new Date().toISOString() : ''; }, it.done ? 'Вернул в работу' : 'Готово');
  else if (act === 'reopen') change(() => { it.done = false; }, 'Вернул в список');
  else if (act === 'check') checkItem(it, el);
  else if (act === 'paid') {
    if (PER_MONTHS[it.period]) { const nd = addMonths(it.date, PER_MONTHS[it.period]); change(() => { it.date = nd; it.paidAt = iso(new Date()); }, 'Оплачено. Следующий срок — ' + fmtDate(nd)); }
    else change(() => { it.done = true; it.paidAt = iso(new Date()); }, 'Оплачено, убрал в закрытые');
  }
});
document.addEventListener('submit', e => {
  if (e.target.id === 'capture') { e.preventDefault(); quickAdd(); }
  if (e.target.id === 'start') { e.preventDefault(); const name = e.target.elements.name.value.trim(); if (!name) return; const id = uid(); change(() => db.projects.push({ id, name, desc: '', color: 'orange', created: iso(new Date()) }), 'Проект создан'); location.hash = '#/p/' + id; }
});
document.addEventListener('input', e => {
  if (e.target.id === 'cap') { cap.text = e.target.value; $('#cap-hint').innerHTML = capHint(); }
  if (e.target.id === 'cap-project') { cap.project = e.target.value; localStorage.setItem('shtab-project', cap.project); }
  if (e.target.id === 'q') runSearch();
});
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') { e.preventDefault(); openSearch(); }
});

/* ---------- поиск ---------- */
let foundList = [], sel = 0;
function openSearch() { if ($('#dlg').open) return; const s = $('#search'); if (!s.open) s.showModal(); $('#q').value = ''; runSearch(); $('#q').focus(); }
function runSearch() {
  const q = $('#q').value.trim().toLowerCase(), box = $('#found');
  if (!q) { foundList = db.projects.map(p => ({ title: p.name, sub: 'проект', href: '#/p/' + p.id })); }
  else {
    foundList = [];
    for (const p of db.projects) if ((p.name + ' ' + (p.desc || '')).toLowerCase().includes(q)) foundList.push({ title: p.name, sub: 'проект', href: '#/p/' + p.id });
    for (const i of db.items) {
      const hay = [i.title, i.text, i.note, i.url, i.domain, i.where, i.kind].filter(Boolean).join(' ').toLowerCase();
      if (hay.includes(q)) foundList.push({ title: i.title || (i.text || '').slice(0, 70) || i.url, sub: TYPE_LABEL[i.type].toLowerCase() + ' · ' + (project(i.projectId)?.name || ''), href: '#/p/' + i.projectId, id: i.id });
    }
    foundList = foundList.slice(0, 40);
  }
  sel = 0;
  box.innerHTML = foundList.length ? foundList.map((f, n) => `<a href="${esc(f.href)}" data-n="${n}" class="${n === 0 ? 'sel' : ''}"><b>${esc(f.title)}</b><span>${esc(f.sub)}</span></a>`).join('') : '<p>Ничего не нашлось.</p>';
}
let pendingId = '';
function showPending() {
  const id = pendingId; pendingId = ''; if (!id) return;
  const el = $(`#main [data-id="${CSS.escape(id)}"]`); if (!el) return;
  const d = el.closest('details'); if (d) d.open = true;
  const row = el.closest('.row') || el; row.classList.add('flash');
  window.scrollTo({ top: row.getBoundingClientRect().top + scrollY - 160 });
}
function goFound(n) {
  const f = foundList[n]; if (!f) return;
  $('#search').close(); pendingId = f.id || '';
  if (location.hash === f.href) showPending(); else location.hash = f.href; // иначе подсветит обработчик hashchange
}
$('#search').addEventListener('click', e => { const a = e.target.closest('a[data-n]'); if (a) { e.preventDefault(); goFound(+a.dataset.n); } else if (e.target.id === 'search') e.target.close(); });
$('#search').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!foundList.length) return; sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + foundList.length) % foundList.length; [...$('#found').children].forEach((c, n) => { c.classList.toggle('sel', n === sel); if (n === sel) c.scrollIntoView({ block: 'nearest' }); }); }
  if (e.key === 'Enter') { e.preventDefault(); goFound(sel); }
});

/* ---------- старт ---------- */
setTheme(localStorage.getItem('shtab-theme') || 'light');
window.addEventListener('hashchange', () => { render(); if (pendingId) showPending(); else window.scrollTo(0, 0); });
window.addEventListener('focus', refreshIfChanged);
window.addEventListener('storage', e => { if (LOCAL && e.key === LS_KEY && !$('#dlg').open) load().then(() => { prevSnapshot = null; render(); }).catch(() => {}); });
setInterval(refreshIfChanged, 60000);
load().then(() => { render(); if (matchMedia('(min-width:900px)').matches) $('#cap')?.focus(); })
  .catch(() => { $('#main').innerHTML = '<section class="hello"><h1 class="serif">' + (LOCAL ? '<b>Не смог прочитать данные из браузера.</b> Они не тронуты. Загрузи копию через меню ⋯.' : '<b>Сервер Штаба не отвечает.</b> Закрой окно и запусти ярлык «Shtab» ещё раз.') + '</h1></section>'; renderNav(); });

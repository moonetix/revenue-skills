const $ = (id) => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';
const REPO = 'https://github.com/moonetix/revenue-skills';
const SKILL_ORDER = [
  'money-audit', 'build-ledger', 'build-webhook-endpoint', 'handle-refunds-and-reversals', 'add-usage-credits',
  'add-payouts', 'add-referral-program', 'guard-signups', 'add-offerwall', 'design-reward-economy',
];
const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const PROOF = { probe: 'Proved with a live request', test: 'Proved with a test', trace: 'Traced in code, not run' };
const PROOF_SHORT = { probe: 'live request', test: 'test', trace: 'code trace' };

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs || {})) {
    if (value === false || value == null) continue;
    if (name === 'class') el.className = value;
    else if (name === 'text') el.textContent = value;
    else if (name.startsWith('on')) el.addEventListener(name.slice(2), value);
    else el.setAttribute(name, value === true ? '' : value);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

function icon(name) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'ic');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

// Text with `code` spans, as the report and the answer key write it.
function rich(text) {
  return String(text)
    .split('`')
    .map((part, i) => (i % 2 ? h('code', { text: part }) : part));
}

function cells(statuses) {
  const box = h('span', { class: 'cells' });
  for (const [status, count] of Object.entries(statuses)) {
    for (let i = 0; i < count; i += 1) box.append(h('i', { class: `cell st-${String(status)[0]}`, text: status }));
  }
  return box;
}

function statusPills(statuses) {
  return Object.entries(statuses).map(([status, count]) =>
    h('span', { class: `st st-${String(status)[0]}` }, status, count > 1 ? h('small', { text: ` x${count}` }) : null),
  );
}

function source(code, label) {
  const pre = h('pre', { class: 'src', tabindex: '0', role: 'region', 'aria-label': label });
  code.lines.forEach((line, i) => {
    const n = code.from + i;
    pre.append(h('span', { class: n === code.mark ? 'l mark' : 'l' }, h('i', { text: String(n) }), h('span', { class: 'c', text: line || ' ' })));
  });
  return pre;
}

function stagger(nodes) {
  nodes.forEach((node, i) => {
    node.classList.add('rv');
    node.style.setProperty('--d', String(i));
  });
}

let data;
try {
  const res = await fetch('data.json');
  if (!res.ok) throw new Error(String(res.status));
  data = await res.json();
} catch {
  $('lab-title').textContent = 'The recorded attacks could not be loaded. Reload the page to try again.';
}

if (data) {
  const classTitle = Object.fromEntries(data.classes.map((c) => [c.id, c.title]));
  const attackOf = new Map();
  for (const attack of data.attacks) for (const id of attack.findings) if (!attackOf.has(id)) attackOf.set(id, attack.id);
  const params = new URLSearchParams(location.search);
  const remember = (name, value) => {
    const next = new URLSearchParams(location.search);
    if (value) next.set(name, value);
    else next.delete(name);
    const query = next.toString();
    history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
  };

  // --- hero

  const race = data.attacks.find((a) => a.id === 'V05') || data.attacks[0];
  const heroRow = (label, run, bad) => {
    const burst = run.steps.find((s) => s.kind === 'request' && s.n > 1) || run.steps.find((s) => s.kind === 'request');
    return h(
      'div',
      { class: `hero-run ${bad ? 'bad' : 'good'}` },
      h('p', { class: 'hero-run-h' }, h('b', { text: label }), h('span', { class: `tag ${bad ? 'bad' : 'good'}`, text: bad ? 'loses money' : 'holds' })),
      cells(burst.statuses),
      h('p', { class: 'hero-run-out', text: run.outcome }),
    );
  };
  $('hero-preview').replaceChildren(heroRow('First version', race.runs.vulnerable, true), heroRow('Fixed version', race.runs.fixed, false));

  // --- lab

  const list = $('lab-list');
  const select = $('lab-select');
  const options = [];
  const pick = list.parentElement;
  for (const cls of data.classes) {
    const group = data.attacks.filter((a) => a.class === cls.id);
    if (!group.length) continue;
    list.append(h('p', { class: 'lab-group', text: cls.title }));
    const og = h('optgroup', { label: cls.title });
    for (const attack of group) {
      const option = h(
        'button',
        { class: 'lab-opt', type: 'button', role: 'option', 'aria-selected': 'false', tabindex: '-1', 'data-id': attack.id },
        h('span', { class: 'vid', text: attack.id }),
        h('span', { text: attack.title }),
      );
      options.push(option);
      list.append(option);
      og.append(h('option', { value: attack.id, text: `${attack.id}  ${attack.title}` }));
    }
    select.append(og);
  }
  const order = options.map((o) => o.dataset.id);
  let current = order.includes(params.get('attack')) ? params.get('attack') : order[0];

  function runCard(label, run, bad) {
    const steps = run.steps.map((step) => {
      if (step.kind === 'note') return h('li', { class: 'step note', text: step.text });
      const request = [h('b', { text: step.line }), ...step.shows.map((s) => h('span', { text: s })), step.body ? h('span', { text: step.body }) : null];
      const sample = step.samples.map((s) => h('code', { class: 'resp-body', text: `${s.status}  ${s.body}` }));
      return h(
        'li',
        { class: 'step' },
        h('p', { class: 'step-what', text: step.what }),
        h('div', { class: 'req' }, request),
        h('div', { class: 'resp' }, h('span', { class: 'resp-l', text: step.n > 1 ? `${step.n} answers` : 'Answer' }), step.n > 1 ? cells(step.statuses) : statusPills(step.statuses)),
        sample,
      );
    });
    const facts = h('dl', { class: 'kv' }, run.facts.map((f) => h('div', {}, h('dt', { text: f.label }), h('dd', { text: f.value }))));
    const verdict = h('p', { class: `verdict ${bad ? 'bad' : 'good'}` }, icon(bad ? 'x' : 'check'), h('span', { text: run.outcome }));
    stagger([...steps, facts, verdict]);
    return h(
      'article',
      { class: `card run ${bad ? 'run-bad' : 'run-good'}` },
      h('header', { class: 'run-h' }, h('h4', { text: label }), h('span', { class: `tag ${bad ? 'bad' : 'good'}`, text: bad ? 'loses money' : 'holds' })),
      h('ol', { class: 'steps' }, steps),
      facts,
      verdict,
    );
  }

  function codeCard(title, text, code, variant) {
    const path = `playground/${variant}/${code.file}`;
    return h(
      'article',
      { class: 'card why' },
      h('header', { class: 'run-h' }, h('h4', { text: title }), h('a', { class: 'file', href: `${REPO}/blob/main/${path}#L${code.mark || code.from}`, text: `${code.file}:${code.mark || code.from}` })),
      h('p', {}, rich(text)),
      source(code, `${title}: ${path}`),
    );
  }

  function show(id, focus) {
    const attack = data.attacks.find((a) => a.id === id);
    if (!attack) return;
    current = id;
    for (const option of options) {
      const on = option.dataset.id === id;
      option.setAttribute('aria-selected', String(on));
      option.tabIndex = on ? 0 : -1;
      if (on && option.offsetParent && pick.scrollHeight > pick.clientHeight) {
        const box = pick.getBoundingClientRect();
        const row = option.getBoundingClientRect();
        if (row.top < box.top || row.bottom > box.bottom - 36) {
          pick.scrollTop += row.top - box.top - (box.height - row.height) / 2;
        }
      }
    }
    select.value = id;
    $('lab-tags').replaceChildren(h('span', { class: 'vid', text: attack.id }), h('span', { class: 'chip', text: classTitle[attack.class] }));
    $('lab-count').textContent = `${order.indexOf(id) + 1} of ${order.length}`;
    $('lab-title').textContent = attack.title;
    $('lab-story').textContent = attack.story;
    $('lab-runs').replaceChildren(runCard('First version', attack.runs.vulnerable, true), runCard('Fixed version', attack.runs.fixed, false));
    $('lab-code').replaceChildren(
      codeCard('Why it worked', attack.wrong, attack.code.vulnerable, 'vulnerable'),
      codeCard('What closes it', attack.fix, attack.code.fixed, 'fixed'),
    );
    const foot = $('lab-foot');
    foot.hidden = false;
    foot.replaceChildren(
      h(
        'div',
        { class: 'ask' },
        h('p', { class: 'ask-l', text: 'Ask your agent about your own code' }),
        h('p', { class: 'ask-q', text: attack.ask }),
        h('button', { class: 'btn copy', type: 'button', 'data-copy-text': attack.ask, 'data-name': 'Prompt', text: 'Copy prompt' }),
      ),
      h('p', {}, attack.skill === 'money-audit' ? 'Reported by the skill ' : 'The fix is what this skill builds: ', h('a', { href: '#skills', class: 'skill-link', text: attack.skill })),
      h(
        'p',
        { class: 'foot-findings' },
        'In the audit report: ',
        attack.findings.map((fid) => h('button', { class: 'btn copy', type: 'button', text: fid, onclick: () => openFinding(fid) })),
      ),
    );
    remember('attack', id === order[0] ? '' : id);
    if (focus) $('lab-title').focus({ preventScroll: true });
  }

  const step = (by) => show(order[(order.indexOf(current) + by + order.length) % order.length], false);
  $('lab-prev').addEventListener('click', () => step(-1));
  $('lab-next').addEventListener('click', () => step(1));
  $('lab-replay').addEventListener('click', () => show(current, false));
  select.addEventListener('change', () => show(select.value, false));
  list.addEventListener('click', (ev) => {
    const option = ev.target.closest('.lab-opt');
    if (option) show(option.dataset.id, false);
  });
  list.addEventListener('keydown', (ev) => {
    const i = options.indexOf(document.activeElement);
    if (i < 0) return;
    let next = -1;
    if (ev.key === 'ArrowDown') next = (i + 1) % options.length;
    else if (ev.key === 'ArrowUp') next = (i - 1 + options.length) % options.length;
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = options.length - 1;
    if (next < 0) return;
    ev.preventDefault();
    show(options[next].dataset.id, false);
    options[next].focus();
  });
  show(current, false);
  $('lab-all-body').append(
    h(
      'div',
      { class: 'scroll' },
      h(
        'table',
        { class: 'all' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: 'Attack' }), h('th', { scope: 'col', text: 'First version' }), h('th', { scope: 'col', text: 'Fixed version' }))),
        h(
          'tbody',
          {},
          data.attacks.map((attack) =>
            h(
              'tr',
              {},
              h('th', { scope: 'row' }, h('button', { class: 'linkish', type: 'button', onclick: () => openAttack(attack.id) }, h('span', { class: 'vid', text: attack.id }), ' ', attack.title)),
              h('td', { class: 'neg', text: attack.runs.vulnerable.outcome }),
              h('td', { text: attack.runs.fixed.outcome }),
            ),
          ),
        ),
      ),
    ),
  );
  if (data.built.commit) {
    $('lab-note').append(` Recorded on ${data.built.date} from commit `, h('a', { href: `${REPO}/commit/${data.built.commit}`, text: data.built.commit }), '.');
  }

  // --- report

  const report = data.report;
  const state = { severity: '', cls: '', q: '' };
  const sevBox = $('rep-sev');
  const sevButtons = [['', 'All', report.findings.length], ...SEVERITIES.map((s) => [s, s[0].toUpperCase() + s.slice(1), report.counts[s]])].map(
    ([value, label, count]) =>
      h('button', { class: `btn sev-btn${value ? ` sev-${value}` : ''}`, type: 'button', 'aria-pressed': String(value === ''), 'data-sev': value }, label, h('small', { text: String(count) })),
  );
  sevBox.append(...sevButtons);
  const classSelect = $('rep-class');
  for (const cls of data.classes) {
    const n = report.findings.filter((f) => f.class === cls.id).length;
    classSelect.append(h('option', { value: cls.id, text: `${cls.title} (${n})` }));
  }

  function copyButton(text, name) {
    return h('button', { class: 'btn copy', type: 'button', 'data-copy-text': text, 'data-name': name, text: 'Copy' });
  }

  function findingCard(f) {
    const proof = [];
    if (f.proof.kind === 'trace') {
      proof.push(
        h(
          'ol',
          { class: 'trace' },
          f.proof.steps.map((s) => h('li', {}, h('p', {}, h('code', { class: 'file', text: `${s.file}:${s.line}` }), ' ', rich(s.note)), h('pre', { class: 'code', text: s.snippet }))),
        ),
      );
    } else {
      proof.push(
        h('div', { class: 'snip' }, h('div', { class: 'snip-top' }, h('span', { text: 'Commands that were run' }), copyButton(f.proof.command, 'Commands')), h('pre', { class: 'code wrap', tabindex: '0', text: f.proof.command.replace(/; /g, ';\n') })),
        /\$[PR]\b/.test(f.proof.command) ? h('p', { class: 'small muted', text: '$P is the probe script of the skill, $R the folder of request files the agent wrote. The full legend is under "How the app was run" below.' }) : null,
        h('p', {}, rich(f.proof.result)),
      );
    }
    const lab = attackOf.get(f.id);
    const body = h(
      'div',
      { class: 'f-body' },
      h('h4', { text: 'Where' }),
      h('p', {}, h('a', { class: 'file', href: `${REPO}/blob/main/playground/vulnerable/${f.location.file}#L${f.location.line}`, text: `${f.location.file}:${f.location.line}` })),
      h('pre', { class: 'code', text: f.location.snippet }),
      h('h4', { text: 'Impact' }),
      h('p', {}, rich(f.impact)),
      h('h4', { text: PROOF[f.proof.kind] }),
      proof,
      h('h4', { text: 'Fix' }),
      h('p', {}, rich(f.fix)),
      lab ? h('p', { class: 'f-lab' }, h('button', { class: 'btn', type: 'button', text: `See it run in the lab (${lab})`, onclick: () => openAttack(lab) })) : null,
    );
    const el = h(
      'details',
      { class: 'card finding', id: `finding-${f.id}`, 'data-sev': f.severity, 'data-class': f.class },
      h(
        'summary',
        {},
        h('span', { class: 'fid', text: f.id }),
        h('span', { class: `sev sev-${f.severity}`, text: f.severity }),
        h('span', { class: 'f-title', text: f.title }),
        h('span', { class: 'f-meta', text: `${classTitle[f.class]}, ${PROOF_SHORT[f.proof.kind]}` }),
        icon('down'),
      ),
      body,
    );
    el.dataset.text = [f.id, f.title, f.location.file, f.impact, f.fix, classTitle[f.class], f.severity].join(' ').toLowerCase();
    return el;
  }

  const ranked = [...report.findings].sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.id.localeCompare(b.id));
  const cards = ranked.map(findingCard);
  $('rep-list').append(...cards, h('p', { class: 'card empty', id: 'rep-empty', hidden: true, text: 'No finding matches. Clear the search or choose another class.' }));

  function applyFilters() {
    const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const card of cards) {
      const ok =
        (!state.severity || card.dataset.sev === state.severity) &&
        (!state.cls || card.dataset.class === state.cls) &&
        words.every((w) => card.dataset.text.includes(w));
      card.hidden = !ok;
      if (ok) shown += 1;
    }
    for (const button of sevButtons) button.setAttribute('aria-pressed', String(button.dataset.sev === state.severity));
    $('rep-empty').hidden = shown > 0;
    $('rep-count').textContent = shown === cards.length ? `All ${cards.length} findings, most severe first.` : `${shown} of ${cards.length} findings.`;
  }
  sevBox.addEventListener('click', (ev) => {
    const button = ev.target.closest('.sev-btn');
    if (!button) return;
    state.severity = button.dataset.sev;
    applyFilters();
  });
  classSelect.addEventListener('change', () => {
    state.cls = classSelect.value;
    applyFilters();
  });
  $('rep-q').addEventListener('input', (ev) => {
    state.q = ev.target.value;
    applyFilters();
  });
  applyFilters();

  function openFinding(id) {
    const card = $(`finding-${id}`);
    if (!card) return;
    state.severity = '';
    state.cls = '';
    state.q = '';
    classSelect.value = '';
    $('rep-q').value = '';
    applyFilters();
    card.open = true;
    card.scrollIntoView({ block: 'start' });
    card.querySelector('summary').focus({ preventScroll: true });
  }
  function openAttack(id) {
    show(id, false);
    $('lab').scrollIntoView({ block: 'start' });
    $('lab-title').focus({ preventScroll: true });
  }
  if (params.get('finding')) openFinding(params.get('finding'));

  const coverage = h(
    'table',
    {},
    h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: 'Class' }), h('th', { scope: 'col', text: 'Result' }), h('th', { scope: 'col', text: 'Files read' }))),
    h(
      'tbody',
      {},
      data.classes.map((cls) => {
        const entry = report.coverage.find((c) => c.class === cls.id) || { status: 'not checked', examined: [] };
        const n = report.findings.filter((f) => f.class === cls.id).length;
        return h(
          'tr',
          {},
          h('th', { scope: 'row', text: cls.title }),
          h('td', { text: entry.status === 'finding' ? `${n} finding${n === 1 ? '' : 's'}` : entry.status }),
          h('td', { class: 'files' }, (entry.examined || []).map((file) => h('code', { text: file }))),
        );
      }),
    ),
  );
  $('rep-coverage-body').append(h('div', { class: 'scroll' }, coverage));
  $('rep-notes').append(h('ul', { class: 'notes' }, report.notes.map((note) => h('li', {}, rich(note)))));
  $('rep-env').append(h('p', {}, rich(report.environment)));

  // --- skills

  const skills = [...data.skills].sort((a, b) => {
    const [x, y] = [SKILL_ORDER.indexOf(a.name), SKILL_ORDER.indexOf(b.name)];
    return (x < 0 ? 99 : x) - (y < 0 ? 99 : y) || a.name.localeCompare(b.name);
  });
  $('skill-list').append(
    ...skills.map((skill) =>
      h(
        'li',
        { class: 'card skill', id: `skill-${skill.name}` },
        h('div', { class: 'skill-h' }, h('h3', {}, h('code', { text: skill.name })), h('span', { class: `tag ${skill.name === 'money-audit' ? 'warn' : 'good'}`, text: skill.name === 'money-audit' ? 'finds' : 'builds' })),
        h('p', { text: skill.does }),
        h('p', { class: 'small muted', text: skill.when }),
        h(
          'div',
          { class: 'skill-foot' },
          h('button', { class: 'btn copy', type: 'button', 'data-copy-text': `npx skills add moonetix/revenue-skills --skill ${skill.name}`, 'data-name': `Install command for ${skill.name}`, text: 'Copy install command' }),
          h('a', { href: `${REPO}/blob/main/skills/${skill.name}/SKILL.md`, text: 'Read the skill' }),
        ),
      ),
    ),
  );
}

// Copy buttons made after page load carry their text with them.
const copyTimers = new WeakMap();
document.addEventListener('click', async (ev) => {
  const button = ev.target.closest('button[data-copy-text]');
  if (!button) return;
  const label = button.dataset.label || (button.dataset.label = button.textContent);
  let ok = true;
  try {
    await navigator.clipboard.writeText(button.dataset.copyText);
  } catch {
    ok = false;
  }
  button.textContent = ok ? 'Copied' : 'Copying is blocked';
  button.classList.toggle('done', ok);
  button.classList.toggle('fail', !ok);
  const note = $('copy-note');
  if (note) note.textContent = ok ? `${button.dataset.name || 'Text'} copied to the clipboard.` : 'Copying is blocked in this browser.';
  clearTimeout(copyTimers.get(button));
  copyTimers.set(
    button,
    setTimeout(() => {
      button.textContent = label;
      button.classList.remove('done', 'fail');
    }, 2500),
  );
});

const $ = (id) => document.getElementById(id);
const state = { accounts: [], selectedId: null, cursor: null, seenTransactions: new Set() };
let ledger;
let busy = false;

// ---------- helpers ----------
function fmt(cents, currency) {
  const locale = currency === 'BRL' ? 'pt-BR' : 'en-US';
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}
function bareAmount(cents) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}
function toCents(value) {
  const text = String(value).trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [units, fraction = ''] = text.split('.');
  const cents = BigInt(units) * 100n + BigInt(fraction.padEnd(2, '0'));
  return cents > 0n && cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}
const initials = (name) => (name.trim().slice(0, 2) || '??').toUpperCase();
const shortId = (id) => `${id.slice(0, 8)}…${id.slice(-4)}`;
const accCcy = (id) => state.accounts.find((a) => a.id === id)?.currency ?? '';
function escapeHtml(s) {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

function toast(title, message, kind) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = '<div class="t"></div><div class="m"></div>';
  el.querySelector('.t').textContent = title;
  el.querySelector('.m').textContent = message;
  $('toasts').replaceChildren(el);
  setTimeout(() => el.remove(), 4600);
}
const ok = (msg) => {
  $('feedback').className = '';
  $('feedback').textContent = msg;
  toast('Done', msg, 'ok');
};
const fail = (e) => {
  const friendly = {
    SELF_TRANSFER: 'Choose two different accounts. A transfer cannot use the same account twice.',
    INSUFFICIENT_FUNDS: 'Insufficient funds. Reduce the amount or deposit funds first.',
    ACCOUNT_NOT_EMPTY: 'Withdraw or transfer the remaining balance before closing this account.',
    ACCOUNT_CLOSED: 'This account is closed. Select an active account to move funds.',
  };
  const msg = friendly[e?.code] ?? e?.message ?? String(e);
  $('feedback').className = 'error';
  $('feedback').textContent = msg;
  toast(e?.code ?? 'Error', msg, 'err');
};

// ---------- rendering ----------
async function refreshBalances() {
  await Promise.all(
    state.accounts.map(async (a) => {
      try {
        a.balanceCents = (await ledger.getBalance(a.id)).balanceCents;
      } catch {
        a.balanceCents = undefined;
      }
    }),
  );
}

function renderSummary() {
  const totals = {};
  for (const a of state.accounts) {
    if (a.balanceCents === undefined) continue;
    totals[a.currency] = (totals[a.currency] ?? 0) + a.balanceCents;
  }
  const entries = Object.entries(totals);
  const box = $('summary');
  box.innerHTML = '';
  const accountsStat = `
    <div class="stat">
      <div class="k">Accounts</div>
      <div class="v">${state.accounts.length}</div>
    </div>`;
  const currencyStats = entries
    .map(
      ([ccy, cents]) => `
      <div class="stat">
        <div class="k">Simulated balance · ${ccy}</div>
        <div class="v">${fmt(cents, ccy)}</div>
      </div>`,
    )
    .join('');
  box.innerHTML = state.accounts.length ? accountsStat + currencyStats : '';
}

function renderAccounts() {
  const box = $('accounts');
  $('acc-count').textContent = state.accounts.length ? `${state.accounts.length}` : '';
  if (state.accounts.length === 0) {
    box.innerHTML = `
      <div class="empty">
        No accounts yet.
        <div><button class="ghost" type="button" id="btn-seed">Load fictional sample data</button></div>
      </div>`;
    $('btn-seed').addEventListener('click', () => guard(seed));
    return;
  }
  box.innerHTML = '';
  for (const a of state.accounts) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'account';
    btn.setAttribute('aria-current', String(a.id === state.selectedId));
    const bal = a.balanceCents === undefined ? '—' : fmt(a.balanceCents, a.currency);
    btn.innerHTML = `
      <span class="avatar" aria-hidden="true">${escapeHtml(initials(a.ownerName))}</span>
      <span class="meta">
        <span class="name">${escapeHtml(a.ownerName)}</span>
        <span class="sub">${a.currency} · ${shortId(a.id)}${a.closed ? ' · closed' : ''}</span>
      </span>
      <span class="bal">${bal}</span>`;
    btn.addEventListener('click', () => guard(() => select(a.id, true, true)));
    box.appendChild(btn);
  }
}

function renderTransferSelects() {
  for (const sel of [$('tr-from'), $('tr-to')]) {
    const prev = sel.value;
    sel.innerHTML = state.accounts
      .map((a) => `<option value="${a.id}">${escapeHtml(a.ownerName)} · ${a.currency}</option>`)
      .join('');
    if (prev && state.accounts.some((a) => a.id === prev)) sel.value = prev;
  }
  if ($('tr-to').selectedIndex === $('tr-from').selectedIndex && state.accounts.length > 1) {
    $('tr-to').selectedIndex = 1;
  }
  $('transfer-card').classList.toggle('is-hidden', !state.selectedId || state.accounts.length < 2);
}

function renderAll() {
  renderSummary();
  renderAccounts();
  renderTransferSelects();
}

// ---------- selection & detail ----------
function clearSelection() {
  state.selectedId = null;
  state.cursor = null;
  for (const id of ['detail', 'statement-card', 'transfer-card']) $(id).classList.add('is-hidden');
  $('statement').replaceChildren();
  $('stmt-count').textContent = '';
  $('btn-more').classList.add('is-hidden');
  renderAccounts();
  updateClosedForms();
}

async function select(id, navigate = true, focus = false) {
  state.selectedId = id;
  const acc = state.accounts.find((a) => a.id === id);
  if (!acc) return;
  if (navigate && location.hash !== `#account=${id}`) history.pushState(null, '', `#account=${id}`);
  $('selected-name').textContent = `${acc.ownerName}${acc.closed ? ' · Closed' : ''}`;
  $('detail').classList.remove('is-hidden');
  $('statement-card').classList.remove('is-hidden');
  $('bal-id').textContent = id;
  $('bal-id').title = id;
  $('btn-close').classList.toggle('is-hidden', Boolean(acc.closed));
  renderAccounts();
  renderTransferSelects();
  await loadBalance();
  await loadStatement(true);
  updateClosedForms();
  if (focus) $('detail').focus();
}

async function loadBalance() {
  const id = state.selectedId;
  try {
    const b = await ledger.getBalance(id);
    $('bal-amount').textContent = bareAmount(b.balanceCents);
    $('bal-ccy').textContent = b.currency;
    const acc = state.accounts.find((a) => a.id === id);
    if (acc) acc.balanceCents = b.balanceCents;
    renderSummary();
  } catch (e) {
    fail(e);
  }
}

async function loadStatement(reset) {
  const id = state.selectedId;
  const tbody = $('statement');
  if (reset) {
    tbody.innerHTML = '';
    state.cursor = null;
  }
  try {
    const page = await ledger.statement(
      state.cursor
        ? { accountId: id, limit: 8, cursor: state.cursor }
        : { accountId: id, limit: 8 },
    );
    for (const e of page.entries) {
      const inflow = e.direction === 'CREDIT';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="when">${new Date(e.createdAt).toLocaleString()}</td>
        <td><span class="tag"><span class="dot ${inflow ? 'in' : 'out'}"></span>${inflow ? 'credit' : 'debit'}</span></td>
        <td class="amt ${inflow ? 'in' : 'out'}">${inflow ? '+' : '−'}${fmt(e.amountCents, e.currency)}</td>`;
      tbody.appendChild(tr);
    }
    state.cursor = page.nextCursor;
    $('stmt-count').textContent = tbody.children.length ? `${tbody.children.length} shown` : '';
    $('btn-more').classList.toggle('is-hidden', !page.nextCursor);
    $('stmt-empty').classList.toggle('is-hidden', tbody.children.length > 0);
  } catch (e) {
    fail(e);
  }
}

// ---------- actions ----------
$('form-create').addEventListener('submit', (ev) => {
  ev.preventDefault();
  guard(async () => {
    ev.preventDefault();
    const ownerName = $('acc-name').value.trim();
    const currency = $('acc-ccy').value;
    if (!ownerName) return fail({ message: 'Enter an account holder name.' });
    try {
      const acc = await ledger.createAccount({ ownerName, currency });
      state.accounts.push({
        id: acc.id,
        ownerName: acc.ownerName,
        currency: acc.currency,
        balanceCents: 0,
      });
      $('acc-name').value = '';
      ok(`Account opened for ${acc.ownerName}.`);
      renderAll();
      await select(acc.id, true, true);
    } catch (e) {
      fail(e);
    }
  });
});

async function move(kind, amtEl, keyEl) {
  const id = state.selectedId;
  const amountCents = toCents(amtEl.value);
  if (amountCents === null)
    return fail({
      message: 'Enter a positive amount with at most two decimal places (for example 10.50).',
    });
  const key = keyEl.value.trim() || undefined;
  try {
    const input = key
      ? { accountId: id, amountCents, idempotencyKey: key }
      : { accountId: id, amountCents };
    const tx = await (kind === 'deposit' ? ledger.deposit(input) : ledger.withdraw(input));
    const replayed = state.seenTransactions.has(tx.id);
    state.seenTransactions.add(tx.id);
    amtEl.value = '';
    ok(
      replayed
        ? 'Request replayed. Original transaction returned; balance unchanged.'
        : `${kind === 'deposit' ? 'Deposited' : 'Withdrew'} ${fmt(amountCents, accCcy(id))}.`,
    );
    await loadBalance();
    renderAccounts();
    await loadStatement(true);
  } catch (e) {
    fail(e);
  }
}
$('form-deposit').addEventListener('submit', (ev) => {
  ev.preventDefault();
  guard(() => move('deposit', $('dep-amt'), $('dep-key')));
});
$('form-withdraw').addEventListener('submit', (ev) => {
  ev.preventDefault();
  guard(() => move('withdraw', $('wd-amt'), $('wd-key')));
});

$('form-transfer').addEventListener('submit', (ev) => {
  ev.preventDefault();
  guard(async () => {
    ev.preventDefault();
    const fromAccountId = $('tr-from').value;
    const toAccountId = $('tr-to').value;
    const amountCents = toCents($('tr-amt').value);
    if (amountCents === null)
      return fail({
        message: 'Enter a positive amount with at most two decimal places (for example 10.50).',
      });
    const key = $('tr-key').value.trim() || undefined;
    try {
      const base = { fromAccountId, toAccountId, amountCents };
      const tx = await ledger.transfer(key ? { ...base, idempotencyKey: key } : base);
      const replayed = state.seenTransactions.has(tx.id);
      state.seenTransactions.add(tx.id);
      $('tr-amt').value = '';
      ok(
        replayed
          ? 'Request replayed. Original transaction returned; balances unchanged.'
          : `Transferred ${fmt(amountCents, accCcy(fromAccountId))}.`,
      );
      await refreshBalances();
      renderAccounts();
      renderSummary();
      if (state.selectedId) {
        await loadBalance();
        await loadStatement(true);
      }
    } catch (e) {
      fail(e);
    }
  });
});

$('btn-more').addEventListener('click', () => guard(() => loadStatement(false)));
$('btn-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(state.selectedId);
    ok('Account id copied.');
  } catch {
    fail({ message: 'Clipboard unavailable.' });
  }
});

$('btn-close').addEventListener('click', () =>
  guard(async () => {
    const id = state.selectedId;
    const acc = state.accounts.find((a) => a.id === id);
    if (!acc) return;
    try {
      await ledger.closeAccount(id);
      acc.closed = true;
      ok(`Account ${acc.ownerName} closed.`);
      renderAccounts();
      $('btn-close').classList.add('is-hidden');
      $('selected-name').textContent = `${acc.ownerName} · Closed`;
      updateClosedForms();
    } catch (e) {
      fail(e);
    }
  }),
);

async function seed() {
  try {
    const ada = await ledger.createAccount({ ownerName: 'Alex Morgan (sample)', currency: 'BRL' });
    const linus = await ledger.createAccount({ ownerName: 'Sam Rivera (sample)', currency: 'BRL' });
    const grace = await ledger.createAccount({
      ownerName: 'Taylor Chen (sample)',
      currency: 'USD',
    });
    await ledger.deposit({ accountId: ada.id, amountCents: 250_00 });
    await ledger.deposit({ accountId: grace.id, amountCents: 1_000_00 });
    await ledger.transfer({ fromAccountId: ada.id, toAccountId: linus.id, amountCents: 90_00 });
    await ledger.withdraw({ accountId: linus.id, amountCents: 15_00 });
    for (const a of [ada, linus, grace]) {
      state.accounts.push({ id: a.id, ownerName: a.ownerName, currency: a.currency });
    }
    await refreshBalances();
    ok('Seeded three accounts with sample activity.');
    renderAll();
    await select(linus.id);
  } catch (e) {
    fail(e);
  }
}

// ---------- boot ----------
async function boot(withSamples = true) {
  if (typeof globalThis.createKeel !== 'function') {
    fail({ message: 'Demo bundle failed to load (app.js). Run "npm run build:demo".' });
    return;
  }
  ledger = await globalThis.createKeel(['BRL', 'USD']);
  $('acc-ccy').innerHTML = ledger.currencies.map((c) => `<option>${c}</option>`).join('');
  renderAll();
  if (withSamples) await seed();
}

function updateClosedForms() {
  const closed =
    !state.selectedId || Boolean(state.accounts.find((a) => a.id === state.selectedId)?.closed);
  for (const id of ['form-deposit', 'form-withdraw']) {
    $(id)
      .querySelectorAll('input, button')
      .forEach((el) => {
        el.disabled = busy || closed;
      });
  }
}
async function guard(action) {
  if (busy) return;
  busy = true;
  const disabledBefore = new Set([
    ...document.querySelectorAll('button:disabled, input:disabled, select:disabled'),
  ]);
  document.querySelectorAll('button, input, select').forEach((el) => {
    el.disabled = true;
  });
  $('workspace').setAttribute('aria-busy', 'true');
  try {
    await action();
  } catch (e) {
    fail(e);
  } finally {
    busy = false;
    document.querySelectorAll('button, input, select').forEach((el) => {
      el.disabled = disabledBefore.has(el);
    });
    $('workspace').setAttribute('aria-busy', 'false');
    updateClosedForms();
  }
}
document.addEventListener(
  'submit',
  (ev) => {
    if (busy) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      return;
    }
  },
  true,
);
$('btn-back').addEventListener('click', () => {
  history.pushState(null, '', '#accounts-panel');
  clearSelection();
  $('accounts-panel').scrollIntoView();
  $('accounts').querySelector('button')?.focus();
});
window.addEventListener('popstate', () => {
  const id = location.hash.startsWith('#account=') ? location.hash.slice(9) : null;
  if (id && state.accounts.some((a) => a.id === id)) guard(() => select(id, false));
  else clearSelection();
});
// Section links scroll within the selected account without creating an overview history entry.
for (const link of document.querySelectorAll('a[href="#detail"], a[href="#statement-card"]')) {
  link.addEventListener('click', (ev) => {
    ev.preventDefault();
    const target = state.selectedId ? $(link.hash.slice(1)) : $('accounts-panel');
    target.scrollIntoView();
    if (state.selectedId) target.focus();
    else $('accounts').querySelector('button')?.focus();
  });
}
$('btn-reset').addEventListener('click', () => $('reset-dialog').showModal());
$('reset-cancel').addEventListener('click', () => $('reset-dialog').close());
$('reset-confirm').addEventListener('click', async () => {
  await guard(async () => {
    $('reset-dialog').close();
    state.accounts = [];
    clearSelection();
    state.seenTransactions.clear();
    document.querySelectorAll('form').forEach((form) => {
      form.reset();
    });
    $('statement').replaceChildren();
    $('toasts').replaceChildren();
    history.replaceState(null, '', location.pathname + location.search);
    await boot(false);
    ok('Demo cleared. Load sample data or open a new fictional account.');
  });
  $('acc-name').focus();
});
guard(() => boot());

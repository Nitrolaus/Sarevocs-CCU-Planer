import type { Pledge, RsiPurchase } from '../domain/model';
import type { UpgradeHistoryStep } from '../domain/upgrade-history';
import { pledgeDate } from '../domain/pledge-date';

const normalize = (value: string) => value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
const titleKey = (value: string) => normalize(value).replace(/^standalone ships? [-–] /, 'standalone ship - ');

function amount(value: string): { minor: number; currency: 'USD' | 'EUR' | 'GBP' } | null {
  const match = /^([$€£])?\s*((?:0|[1-9]\d{0,6}|[1-9]\d{0,2}(?:,\d{3}){1,2}))(?:\.(\d{2}))?(?:\s+(USD|EUR|GBP))?$/.exec(value);
  if (!match) return null;
  const [, symbol, dollars, cents, code] = match;
  const currency = code==='USD'||code==='EUR'||code==='GBP'?code:symbol==='£'?'GBP':symbol==='€'?'EUR':null;
  if (!currency || symbol && symbol !== {EUR:'€',USD:'$',GBP:'£'}[currency]) return null;
  const minor = Number(dollars!.replaceAll(',', '')) * 100 + Number(cents ?? 0);
  return minor <= 100_000_000 ? { minor, currency } : null;
}

export type PurchaseLogRow = { id: string; title: string; owner: string; order: string; value: string; date?: string }
  | { id: string; excluded: true };
export type PurchaseOrder = {
  id: string;
  paid: boolean;
  discount: string;
  date?: string;
  lines: Array<{ title: string; quantity: string; total: string }>;
};

// The parser runs in a local sandbox with an inert template. Never return addresses,
// payment methods, or unrelated rows, even temporarily over the renderer IPC boundary.
const logParser = String.raw`(root, ids) => {
  const wanted = new Set(ids), result = [];
  for (const node of root.querySelectorAll('.pledge-log-entry p')) {
    const titleNode = node.querySelector('span.important');
    if (!titleNode) continue;
    const txt = clean(node.textContent);
    const title = clean(titleNode.textContent);
    const boundary = txt.indexOf(' - ' + title + ' #');
    if (!title || title.length > 500 || boundary < 0) continue;
    const tail = txt.slice(boundary + title.length + 4);
    const row = /^#([1-9]\d{0,19}) - (.+)$/.exec(tail);
    if (!row || !wanted.has(row[1])) continue;
    if (/^(?:Claimed as a gift\b|Gifted\b|Reclaimed\b)/i.test(row[2])) {
      result.push({id: row[1], excluded: true});
      continue;
    }
    const purchase = /^Created by (.{1,160}?) - (?:Buy-Back )?order #([a-z0-9-]{1,64})(?:, value: (.{1,96}))?$/i.exec(row[2]);
    if (purchase) result.push({id: row[1], title, owner: purchase[1], order: purchase[2], value: purchase[3] || '',
      date: txt.slice(0,boundary).length <= 120 ? txt.slice(0,boundary) : ''});
  }
  return result;
}`;

const orderParser = String.raw`(root, ids) => {
  const wanted = new Set(ids), result = [];
  for (const row of root.querySelectorAll('ul.orders-item > li')) {
    const metadata = new Map();
    for (const col of row.querySelectorAll('.basic-infos .col')) {
      const label = clean(col.querySelector('span')?.textContent).toLowerCase();
      const value = clean(col.textContent).slice(label.length).trim();
      if (label) metadata.set(label, metadata.has(label) ? '' : value);
    }
    const id = metadata.get('order id:')?.toUpperCase();
    if (!id || !wanted.has(id)) continue;
    const status = metadata.get('status:')?.toUpperCase();
    const paid = ['CLOSED', 'COMPLETE', 'COMPLETED'].includes(status) &&
      metadata.get('payment:')?.toUpperCase() === 'PAID' && metadata.get('fulfillment:')?.toUpperCase() === 'DONE';
    const discounts = [...row.querySelectorAll('.payment-wrapper .right-section strong')]
      .filter(n => clean(n.textContent).toLowerCase() === 'additional discount:');
    let discount = '';
    if (discounts.length === 1) {
      for (let next = discounts[0].nextSibling; next; next = next.nextSibling) {
        if (next.nodeType === 1 && !/^(SPAN|B|EM)$/.test(next.tagName)) break;
        discount += next.textContent || '';
      }
    }
    const lines = [];
    const table = row.querySelectorAll('table.billing-summary');
    if (table.length === 1) for (const line of table[0].querySelectorAll('tbody tr')) {
      const cells = [...line.children];
      if (cells.length !== 5 || cells.some(cell => cell.tagName !== 'TD')) continue;
      const title = clean(cells[0].textContent), quantity = clean(cells[2].textContent), total = clean(cells[4].textContent);
      if (title.length <= 500 && quantity.length <= 12 && total.length <= 96) lines.push({title, quantity, total});
    }
    const date = metadata.get('order date:') || metadata.get('date:');
    result.push({id, paid, discount: clean(discount).slice(0, 96), lines, ...(date && date.length <= 120 ? {date} : {})});
  }
  return result;
}`;

export function purchaseParserProbe(kind: 'log' | 'order', html: string, ids: readonly string[]): string {
  return String.raw`(() => {
    const clean = value => (value || '').replace(/\s+/g, ' ').trim();
    const template = document.createElement('template');
    template.innerHTML = ${JSON.stringify(html)};
    return (${kind === 'log' ? logParser : orderParser})(template.content, ${JSON.stringify(ids)});
  })()`;
}

export function purchaseMatches(pledges: readonly Pick<Pledge, 'pledgeId' | 'name'>[], log: readonly PurchaseLogRow[], owner: string | null) {
  const byId = new Map(pledges.map(p => [p.pledgeId, p]));
  const knownOwner = owner === null ? null : normalize(owner);
  const matches = new Map<string, { title: string; order: string; value: ReturnType<typeof amount>; date?: string }>();
  const excluded = new Set<string>();
  for (const row of log) {
    const pledge = byId.get(row.id);
    if (!pledge) continue;
    if ('excluded' in row || (knownOwner !== null && normalize(row.owner) !== knownOwner) || titleKey(row.title) !== titleKey(pledge.name) || matches.has(row.id)) {
      excluded.add(row.id);
      matches.delete(row.id);
    } else if (!excluded.has(row.id)) {
      // Without a verified handle, the log can link IDs, but only a paid order from this session can prove a purchase.
      matches.set(row.id, { title: titleKey(row.title), order: row.order.toUpperCase(), value: knownOwner === null ? null : amount(row.value), date: row.date });
    }
  }
  return { matches, excluded };
}

export function purchasePrices({ matches, excluded }: ReturnType<typeof purchaseMatches>, orders: readonly PurchaseOrder[]) {
  const result = new Map<string, RsiPurchase>();
  const linesUsed = new Map<string, number>();
  const byOrder = new Map<string, PurchaseOrder | null>();
  for (const order of orders) byOrder.set(order.id, byOrder.has(order.id) ? null : order);
  for (const match of matches.values()) {
    const key = `${match.order}\0${match.title}`;
    linesUsed.set(key, (linesUsed.get(key) ?? 0) + 1);
  }
  for (const id of excluded) result.set(id, { status: 'excluded' });
  for (const [id, match] of matches) {
    const order = byOrder.get(match.order);
    if (order && !order.paid) {
      result.set(id, { status: 'excluded' });
      continue;
    }
    const lines = order?.lines.filter(line => titleKey(line.title) === match.title);
    const line = lines?.length === 1 ? lines[0] : undefined;
    const quantity = line && /^[1-9]\d{0,4}$/.test(line.quantity) ? Number(line.quantity) : 0;
    const total = line ? amount(line.total) : null;
    const discount = order ? amount(order.discount) : null;
    const assigned = linesUsed.get(`${match.order}\0${match.title}`) ?? 0;
    const date=pledgeDate({sourceValues:{date:order?.date??''}})??pledgeDate({sourceValues:{date:match.date??''}});
    if (total && quantity > 0 && assigned <= quantity && total.minor % quantity === 0 && discount?.minor === 0 && discount.currency === total.currency) {
      const unitMinor = total.minor / quantity;
      result.set(id, unitMinor > 0 ? { status: 'documented', source: 'order', minor: unitMinor, currency: total.currency,
        ...(total.currency==='GBP'&&date?{purchaseDate:date}:{}) } : { status: 'excluded' });
    } else if (match.value && match.value.minor > 0) {
      result.set(id, { status: 'documented', source: 'log', ...match.value, ...(match.value.currency==='GBP'&&date?{purchaseDate:date}:{}) });
    } else if (match.value?.minor === 0) {
      result.set(id, { status: 'excluded' });
    }
  }
  return result;
}

/** Join applied IDs to the exact purchased upgrade title; preserve subscriber and other SKU qualifiers. */
export function appliedPurchaseMatches(steps: readonly UpgradeHistoryStep[], log: readonly PurchaseLogRow[], owner: string | null) {
  const byId = new Map<string, UpgradeHistoryStep | null>();
  for (const step of steps) {
    if (step.ccuPledgeId) byId.set(step.ccuPledgeId, byId.has(step.ccuPledgeId) ? null : step);
  }
  const targets: Array<Pick<Pledge, 'pledgeId' | 'name'>> = [];
  for (const row of log) {
    if ('excluded' in row) continue;
    const step = byId.get(row.id);
    if (!step?.appliedAt) continue;
    const pair = normalize(step.from + ' to ' + step.to);
    const name = normalize(row.title);
    const modern = 'upgrade - ' + pair;
    const suffixes = ['', ' standard', ' warbond', ' warbond edition', ' standard edition', ' standard upgrade', ' warbond upgrade'];
    if (name !== pair + ' upgrade' && !suffixes.some(suffix => name === modern + suffix)) continue;
    targets.push({pledgeId: row.id, name: row.title});
  }
  return purchaseMatches(targets, log, owner);
}

export function appliedOrderPrices(steps: readonly UpgradeHistoryStep[], log: readonly PurchaseLogRow[], owner: string | null, orders: readonly PurchaseOrder[]) {
  return batchPurchasePrices([], steps, log, owner, orders).applied;
}

/** A held pledge and a consumed CCU must jointly fit the purchased quantity of a shared order line. */
export function batchPurchasePrices(pledges: readonly Pledge[], steps: readonly UpgradeHistoryStep[], log: readonly PurchaseLogRow[],
  owner: string | null, orders: readonly PurchaseOrder[]) {
  const base = purchaseMatches(pledges, log, owner);
  const evidence = appliedPurchaseMatches(steps, log, owner);
  const matches = new Map([...base.matches, ...evidence.matches]);
  const excluded = new Set([...base.excluded, ...evidence.excluded]);
  const present = new Set(pledges.map(pledge => pledge.pledgeId));
  for (const step of steps) if (step.ccuPledgeId && present.has(step.ccuPledgeId)) excluded.add(step.ccuPledgeId);
  for (const id of excluded) matches.delete(id);
  const prices = purchasePrices({ matches, excluded }, orders);
  const bases = new Map([...prices].filter(([id]) => present.has(id)));
  const applied = new Map<string, RsiPurchase>();
  const byOrder = new Map(orders.map(order => [order.id, order]));
  for (const step of steps) {
    const id = step.ccuPledgeId;
    if (!id) continue;
    const price = prices.get(id);
    const match = evidence.matches.get(id);
    const logDate = pledgeDate({sourceValues: {date: match?.date ?? ''}});
    const orderDate = pledgeDate({sourceValues: {date: match ? byOrder.get(match.order)?.date ?? '' : ''}});
    const appliedDate = step.appliedAt?.slice(0, 10);
    if (price?.status === 'documented' && price.source === 'order' && appliedDate && (logDate || orderDate) &&
        (!logDate || logDate <= appliedDate) && (!orderDate || orderDate <= appliedDate)) applied.set(id, price);
  }
  return { bases, applied };
}

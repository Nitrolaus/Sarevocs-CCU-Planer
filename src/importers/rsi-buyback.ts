import { z } from 'zod';
import { buybackSchema, type Buyback, type BuybackObservation } from '../domain/model';
import { RSI_ORIGIN } from '../main/policy';

const listPath = '/en/account/buy-back-pledges';
const pageSize = 250;
const maxEntries = 50_000;
const maxPages = maxEntries / pageSize + 1;

export function buybackPageUrl(page: number): string {
  if (!Number.isInteger(page) || page < 1 || page > maxPages) throw new Error('BUYBACK_PAGE');
  return `${RSI_ORIGIN}${listPath}?page=${page}&pagesize=${pageSize}`;
}

/** The general operation policy still blocks Buy Back. Only the active listing GET is exempt in its RSI window. */
export function isBuybackListRead(request: { url: string; method: string; resourceType: string; uploadData?: readonly unknown[] }, expected?: string): boolean {
  const prefix = RSI_ORIGIN + listPath + '?page=';
  if (!expected?.startsWith(prefix) || request.url !== expected || request.method !== 'GET' || request.resourceType !== 'xhr' || request.uploadData?.length) return false;
  const page = Number(expected.slice(prefix.length).split('&')[0]);
  return Number.isInteger(page) && page >= 1 && page <= maxPages && expected === buybackPageUrl(page);
}

const extract = String.raw`(root, page) => {
  const clean = text => (text || '').replace(/\s+/g, ' ').trim();
  if (root.querySelector('input[type="password"]') || /You must be authenticated to reach this area/i.test(root.textContent || '')) return null;
  const lists = root.querySelectorAll('ul.pledges');
  if (lists.length !== 1) return null;
  const rows = Array.from(lists[0].children).filter(node => node.tagName === 'LI');
  if (rows.length === 0 || rows.length > 250) return null;
  const empty = rows.length === 1 && rows[0].classList.contains('no-buy-backs');
  if (rows.some(row => row.classList.contains('no-buy-backs')) && !empty) return null;
  const buybacks = [];
  for (const row of empty ? [] : rows) {
    const card = row.querySelector('article.pledge') || row;
    const heading = card.querySelector('h1');
    const name = clean(heading?.getAttribute('title')) || clean(heading?.firstChild?.textContent) || clean(heading?.textContent);
    const upgrade = card.querySelector('a.js-open-ship-upgrades[data-pledgeid]');
    // An action link can evidence a numeric row identity. The URL is never returned or opened.
    const ids = new Set(Array.from(card.querySelectorAll('a[href]'), link =>
      /^\/(?:en\/)?account\/buy-back-pledges\/([1-9]\d{0,19})\/?$/.exec(link.getAttribute('href') || '')?.[1]).filter(Boolean));
    if (upgrade) ids.add(upgrade.getAttribute('data-pledgeid'));
    const [entryId] = ids;
    if (ids.size !== 1 || !/^[1-9]\d{0,19}$/.test(entryId || '') || !name || name.length > 500) return null;
    const originalShips = [...new Set(Array.from(card.querySelectorAll('.package-listing.ship li .info span'), node => clean(node.textContent)).filter(Boolean))];
    const items = Array.from(card.querySelectorAll('.package-listing.item li'), node => clean(node.textContent));
    const lti = items.find(value => /^(?:lifetime insurance|LTI)$/i.test(value));
    const monthMatches = items.map(value => /^(\d{1,4})\s+months?\s+insurance$/i.exec(value)).filter(Boolean);
    const months = monthMatches.find(match => Number(match[1]) > 0 && Number(match[1]) <= 1200);
    const insurance = lti ? {kind:'lti',evidence:lti} : months ? {kind:'months',months:Number(months[1]),evidence:months[0]} : undefined;
    const priceNodes = card.querySelectorAll('.final-price[data-value][data-currency]');
    const price = priceNodes.length === 1 ? priceNodes[0] : null;
    const amount = price?.getAttribute('data-value') || '';
    const currency = price?.getAttribute('data-currency');
    const tax = price?.getAttribute('data-tax-basis');
    const currentPrice = /^(?:0|[1-9]\d{0,8})$/.test(amount) && (currency === 'USD' || currency === 'EUR')
      ? {minor:Number(amount),currency,taxBasis:tax === 'net' || tax === 'gross' ? tax : 'unknown',evidence:'RSI Buy Back'} : null;
    buybacks.push({entryId,name,description:'',availability:'unverified',currentPrice,originalShips,insurance});
  }
  const notices = Array.from(root.querySelectorAll('p,.notice,.alert,[role="alert"]'), node => clean(node.textContent)).filter(value => value.length <= 320);
  const hasToken = notices.some(value => /^You (?:currently )?have (?:a|an|1|one) (?:credit )?buy[ -]back token\b/i.test(value));
  const noToken = notices.some(value => /^You (?:do not|don't) (?:currently )?have (?:a|an|any) (?:credit )?buy[ -]back token\b/i.test(value));
  const token = hasToken === noToken ? 'unknown' : hasToken ? 'available' : 'unavailable';
  const hasNext = Array.from(root.querySelectorAll('a[href]')).some(link => {
    try {
      const target = new URL(link.getAttribute('href'), ${JSON.stringify(RSI_ORIGIN)});
      const raw = target.searchParams.get('page') || '';
      return target.origin === ${JSON.stringify(RSI_ORIGIN)} && /^\/(?:en\/)?account\/buy-back-pledges\/?$/.test(target.pathname)
        && /^[1-9]\d{0,3}$/.test(raw) && Number(raw) > page;
    } catch { return false; }
  });
  return {buybacks,token,hasNext};
}`;

export function buybackFetchProbe(page: number): string {
  return `(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(${JSON.stringify(buybackPageUrl(page))}, {
        method:'GET',credentials:'same-origin',redirect:'error',cache:'no-store',signal:controller.signal
      });
      if (!response.ok || response.redirected || !/^text\\/html(?:;|$)/i.test(response.headers.get('content-type') || '')) return null;
      const reader = response.body?.getReader();
      if (!reader) return null;
      const decoder = new TextDecoder(); let html = '', bytes = 0;
      for (;;) {
        const {done,value} = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 4 * 1024 * 1024) { controller.abort(); return null; }
        html += decoder.decode(value,{stream:true});
      }
      const template = document.createElement('template');
      template.innerHTML = html + decoder.decode();
      return (${extract})(template.content,${page});
    } catch { return null; }
    finally { clearTimeout(timer); }
  })()`;
}

const pageSchema = z.object({ buybacks: z.array(buybackSchema).max(pageSize), token: z.enum(['available', 'unavailable', 'unknown']), hasNext: z.boolean() }).strict();
export type BuybackReadFailure = 'buyback-page-unreadable' | 'buyback-duplicate-entry' | 'buyback-limit-reached';

export async function readBuybacks(load: (page: number) => Promise<unknown>, assertActive: () => void,
  onFailure?: (reason: BuybackReadFailure) => void):
  Promise<{ entries: Buyback[]; observation: BuybackObservation } | null> {
  const entries: Buyback[] = [], ids = new Set<string>();
  let token: BuybackObservation['token'] = 'unknown';
  let verifyingEnd = false;
  const deadline = Date.now() + 60_000;
  const fail = (reason: BuybackReadFailure) => { onFailure?.(reason); return null; };
  for (let page = 1; page <= maxPages; page++) {
    if (Date.now() >= deadline) return fail('buyback-limit-reached');
    assertActive();
    const parsed = pageSchema.safeParse(await load(page));
    assertActive();
    if (!parsed.success) return fail('buyback-page-unreadable');
    const data = parsed.data;
    if (page === 1) token = data.token;
    if (data.buybacks.length === 0 && (data.hasNext || page !== 1 && !verifyingEnd)) return fail('buyback-page-unreadable');
    if (entries.length + data.buybacks.length > maxEntries) return fail('buyback-limit-reached');
    for (const row of data.buybacks) {
      if (ids.has(row.entryId)) return fail('buyback-duplicate-entry');
      ids.add(row.entryId); entries.push(row);
    }
    if (!data.hasNext && data.buybacks.length < pageSize) return { entries, observation: { observedAt: new Date().toISOString(), token, current: true } };
    // A full page without a next link can be the last one. Confirm it with the explicit empty page.
    verifyingEnd = !data.hasNext;
  }
  return fail('buyback-limit-reached');
}

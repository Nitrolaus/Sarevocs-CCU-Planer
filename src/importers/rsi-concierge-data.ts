// Authored inert parser. The two page variants return disjoint, narrowly typed data.
export function conciergePageProbe(html: string, mode: 'rank' | 'total'): string {
  return String.raw`(() => {
    const doc = new DOMParser().parseFromString(${JSON.stringify(html)}, 'text/html');
    const unavailable = { status: 'unavailable' };
    const clean = value => (value ?? '').replace(/\s+/g, ' ').trim();
    if (doc.querySelector('input[type="password"]') ||
        [...doc.querySelectorAll('p')].some(node => /^You must be authenticated to reach this area\.?$/i.test(clean(node.textContent)))) {
      return { status: 'session-required' };
    }
    const only = (parent, selector) => {
      const nodes = parent.querySelectorAll(selector);
      return nodes.length === 1 ? nodes[0] : null;
    };
    if (${JSON.stringify(mode)} === 'total') {
      const rows = [...doc.querySelectorAll('.spent-line')].filter(row =>
        [...row.children].some(child => child.tagName === 'SPAN' && /^total spent:?$/i.test(clean(child.textContent))));
      if (rows.length !== 1) return unavailable;
      const amount = clean(only(rows[0], ':scope > em')?.textContent);
      const match = /^([$€£])?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?)\s*(USD|EUR|GBP)?$/.exec(amount);
      if (!match) return unavailable;
      const symbol = ({ '$': 'USD', '€': 'EUR', '£': 'GBP' })[match[1]];
      const currency = match[3] || (match[1] === '€' || match[1] === '£' ? symbol : null);
      if (!currency || symbol && symbol !== currency) return unavailable;
      const [whole, fraction = '00'] = match[2].replaceAll(',', '').split('.');
      const amountMinor = Number(whole) * 100 + Number(fraction);
      return Number.isSafeInteger(amountMinor) ? { status: 'loaded', amountMinor, currency } : unavailable;
    }
    const ranks = ['High Admiral', 'Grand Admiral', 'Space Marshal', 'Wing Commander', 'Praetorian', 'Legatus Navium'];
    const label = node => ranks.find(rank => rank.toLowerCase() === clean(node?.textContent)
      .replace(/^(?:Your (?:current )?level|Current rank)\s*:\s*/i, '').toLowerCase()) ?? null;
    const current = only(doc, '.c-status__rank');
    const rank = current ? label(only(current, ':scope > p')) || label(current) : null;
    const nextRank = label(only(doc, '.c-next-level__title'));
    if (!rank) return !doc.querySelector('.c-status__rank') && nextRank === ranks[0] ? { status: 'no-rank' } : unavailable;
    // RSI's animated counter starts at zero. Its server-provided data attribute is the source.
    const counter = only(doc, '.c-next-level > [data-spend-until-next-rank]');
    const value = clean(counter?.getAttribute('data-spend-until-next-rank'));
    const percentage = /^\d{1,3}(?:\.\d+)?%?$/.test(value) ? Number(value.replace(/%$/, '')) : NaN;
    const progress = nextRank && percentage <= 100 ? Math.round(percentage) : null;
    return { status: 'loaded', rank, nextRank, progress };
  })()`;
}

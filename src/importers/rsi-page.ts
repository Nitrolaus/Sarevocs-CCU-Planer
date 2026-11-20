import { isPledgesPage, RSI_ORIGIN } from '../main/policy';

// Fixed browser-side reader. Remote HTML remains inert; scripts and arbitrary selectors never execute.
const extractPage = String.raw`(root, live) => {
  if (live) {
    const consent = [...root.querySelectorAll('button,a,[role="button"],input[type="button"]')].some(n => {
      const label = (n.textContent || n.value || '').trim().replace(/\s+/g, ' ');
      return /^(Use necessary cookies only|Allow selection|Allow all cookies)$/i.test(label) &&
        n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden' && getComputedStyle(n).display !== 'none';
    });
    if (consent) return { ok: false, reason: 'cookie-consent' };
  }
  const lists = [...root.querySelectorAll('.list-items')];
  if (lists.length !== 1) return { ok: false, reason: 'list-missing' };
  const list = lists[0], rows = [...list.children].filter(n => n.tagName === 'LI');
  if (!rows.length || rows.length > 100) return { ok: false, reason: 'pledge-fields' };
  const value = (n, selector) => n.querySelector(selector)?.value?.trim() ?? '';
  const txt = (n, selector) => n.querySelector(selector)?.textContent?.trim() ?? '';
  const empty = rows.length === 1 && !!rows[0].querySelector('.empty-list') && !rows[0].querySelector('.js-pledge-id');
  const handle = root.querySelector('.c-account-sidebar__profile-info-handle')?.textContent?.trim() || null;
  if (empty) return { ok: true, type: 'hangarexport', version: 2, handle, pledges: [] };
  if (rows.some(n => {
    const id = value(n, '.js-pledge-id'), name = value(n, '.js-pledge-name').split(':')[0].trim();
    return !id || id.length > 160 || !name || name.length > 500;
  })) return { ok: false, reason: 'pledge-fields' };
  const pledges = [];
  for (const n of rows) {
    const pledge = {
      pledgeId: value(n, '.js-pledge-id'), pledgeName: value(n, '.js-pledge-name').split(':')[0].trim(),
      pledgeValue: value(n, '.js-pledge-value'), pledgeConfigurationValue: value(n, '.js-pledge-configuration-value'),
      contains: txt(n, '.items-col'), date: txt(n, '.date-col'),
      items: [...n.querySelectorAll('.item')].filter(i => !i.closest('.without-images')).map(i => ({ title: txt(i, '.title'), kind: txt(i, '.kind'), liner: txt(i, '.liner') })),
      alsoContains: [...n.querySelectorAll('.without-images .item .title')].map(t => ({ title: t.textContent?.trim() ?? '' }))
    };
    // Fixed labels visible on RSI's pledge header. Contents and original package names are not assignment evidence.
    const normalize = text => text.replace(/\s+/g, ' ').trim().toUpperCase();
    const badgeGames = new Set();
    for (const badge of n.querySelectorAll('span,a,button,div,small,strong,em')) {
      if (badge.closest('.item,.without-images,.items-col,.date-col,.description,.hidden,.is-hidden,[hidden],[aria-hidden="true"],script,style,template')) continue;
      const label = normalize(badge.textContent || '');
      if (label !== 'SC GAME ACCESS' && label !== 'SQ42 GAME ACCESS') continue;
      if (label === normalize(pledge.pledgeName)) continue;
      if (badge.closest('[style*="display:none"],[style*="display: none"]')) continue;
      if (live && (!badge.getClientRects().length || getComputedStyle(badge).display === 'none' || getComputedStyle(badge).visibility === 'hidden')) continue;
      badgeGames.add(label === 'SC GAME ACCESS' ? 'sc' : 'sq42');
    }
    pledge.gameAccessAssignment = ['sc','sq42'].filter(game => badgeGames.has(game));
    const reclaim = n.querySelector('.js-reclaim.reclaim');
    if (badgeGames.size > 0) pledge.meltable = false;
    else if (reclaim && !reclaim.matches('[disabled],[aria-disabled="true"],.disabled,.is-disabled')) pledge.meltable = true;
    const upgrade = n.querySelector('.js-upgrade-data');
    if (upgrade) {
      const raw = upgrade.value || upgrade.textContent || '';
      // SC-Bridge's public import fixture includes insurance, paint and a schematic beside the target ship.
      // Exclude only the known component words; remaining names are not resolved to ship identities.
      const component = /\b(insurance|paint|livery|skin|schematic|blueprint)\b/i;
      const names = items => {
        if (!Array.isArray(items) || !items.length || items.length > 100 || items.some(item =>
          !item || typeof item.name !== 'string' || !item.name.trim() || item.name.trim().length > 500)) return null;
        return items.map(item => item.name.trim());
      };
      if (raw.length > 65536) pledge.upgradeIssue = 'unreadable';
      else try {
        const data = JSON.parse(raw), source = names(data?.match_items), target = names(data?.target_items);
        if (!source || !target) pledge.upgradeIssue = 'unreadable';
        else {
          // Only an acquired target item proves the upgrade's insurance; source insurance is not transferred.
          for (const title of target.filter(name => /^lifetime insurance$/i.test(name))) {
            if (pledge.alsoContains.length < 100 && !pledge.alsoContains.some(item => /^lifetime insurance$/i.test(item.title.trim()))) pledge.alsoContains.push({ title });
          }
          const from = [...new Set(source.filter(name => !component.test(name)))];
          const to = [...new Set(target.filter(name => !component.test(name)))];
          let selected = to.length === 1 ? to[0] : undefined;
          let resolution = 'structured-unique';
          if (from.length === 1 && to.length > 1) {
            // A display pair may select only an existing structured target, never invent an endpoint.
            // Match both ends of the same pair; conflicting candidate matches remain ambiguous.
            const pairs = [pledge.pledgeName, ...pledge.items.map(item => item.title)]
              .filter(title => title.length <= 1100)
              .map(title => /^Upgrade - (.+) to (.+)$/i.exec(title.trim()))
              .filter(pair => pair);
            const consistentSource = pairs.every(pair => pair[1].trim().toLowerCase() === from[0].toLowerCase());
            const displayedTargets = consistentSource ? pairs
              .map(pair => pair[2].trim().replace(/ Warbond Edition$/i, '').trim().toLowerCase()) : [];
            const matched = to.filter(name => displayedTargets.includes(name.toLowerCase()));
            if (matched.length === 1) { selected = matched[0]; resolution = 'structured-display-match'; }
          }
          if (from.length === 1 && selected) {
            pledge.upgrade = { from: from[0], to: selected };
            pledge.upgradeEvidence = { resolution, sourceCandidates: from.length, targetCandidates: to.length };
          } else pledge.upgradeIssue = 'ambiguous';
        }
      } catch { pledge.upgradeIssue = 'unreadable'; }
    }
    pledges.push(pledge);
  }
  return { ok: true, type: 'hangarexport', version: 2, handle, pledges };
}`;

export const RSI_PAGE_PROBE = `(() => { const extract = ${extractPage}; return extract(document, true); })()`;
export const RSI_CONNECTION_PROBE = `(() => {
  const result = (${RSI_PAGE_PROBE});
  if (result.ok) return 'ready';
  if (result.reason === 'cookie-consent') return 'consent';
  if (document.querySelector('input[type="password"]') || /You must be authenticated to reach this area/i.test(document.body?.innerText || '')) return 'login';
  return result.reason;
})()`;

export function rsiFetchPageProbe(page: number, hangarUrl: string): string {
  if (!Number.isInteger(page) || page < 1 || page > 5000) throw new Error('Invalid fixed hangar page');
  if (!isPledgesPage(hangarUrl)) throw new Error('Invalid fixed hangar URL');
  // Keep the language of the already validated, opened hangar. Unprefixed pages use RSI's English route.
  // Rebuild the target: source query/fragment, page links and arbitrary URLs are never forwarded.
  const language = new URL(hangarUrl).pathname.match(/^\/([a-z]{2}(?:-[A-Za-z]{2})?)\/account\/pledges\/?$/)?.[1] ?? 'en';
  const pageUrl = RSI_ORIGIN + '/' + language + '/account/pledges?page=' + page + '&pagesize=10';
  return `(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(${JSON.stringify(pageUrl)}, {
        method: 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: controller.signal
      });
      if (!response.ok) { const retryable = [429,502,503,504].includes(response.status); const retry = response.headers.get('retry-after') || ''; return { ok: false, reason: 'page-read-failed', retryable, retryAfterMs: retryable && /^\\d{1,5}$/.test(retry) ? Math.min(60000, Number(retry)*1000) : 0 }; }
      if (response.redirected || !/^(?:text\\/html|application\\/xhtml\\+xml)(?:;|$)/i.test(response.headers.get('content-type') || '')) return { ok: false, reason: 'page-read-failed' };
      const reader = response.body?.getReader();
      if (!reader) return { ok: false, reason: 'page-read-failed' };
      const decoder = new TextDecoder(), chunks = [];
      let bytes = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 8 * 1024 * 1024) {
            controller.abort();
            return { ok: false, reason: 'page-read-failed' };
          }
          chunks.push(decoder.decode(value, { stream: true }));
        }
      } finally { reader.releaseLock(); }
      chunks.push(decoder.decode());
      const template = document.createElement('template');
      template.innerHTML = chunks.join('');
      const extract = ${extractPage};
      return extract(template.content, false);
    } catch { return { ok: false, reason: 'page-read-failed', retryable: true }; }
    finally { clearTimeout(timer); }
  })()`;
}

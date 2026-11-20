import { createHash } from 'node:crypto';
import { z } from 'zod';
import { documentSchema, type ImportCandidate, type InventoryDocument, type Pledge, type Insurance, UserError } from '../domain/model';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const foreignText = z.string().max(4000);
const foreignItem = z.object({ title: foreignText, kind: foreignText, liner: foreignText.optional(), itemCustomName: foreignText.optional() });
const foreignUpgradeText = z.string().trim().min(1).max(500);
const foreignUpgrade = z.object({ from: foreignUpgradeText, to: foreignUpgradeText }).strict();
const foreignUpgradeEvidence = z.object({ resolution: z.enum(['structured-unique', 'structured-display-match']),
  sourceCandidates: z.number().int().min(1).max(100), targetCandidates: z.number().int().min(1).max(100) }).strict()
  .refine(e => e.sourceCandidates === 1 && (e.resolution === 'structured-unique' ? e.targetCandidates === 1 : e.targetCandidates > 1));
const foreignPledge = z.object({ pledgeId: z.string().min(1).max(160), pledgeName: z.string().min(1).max(500),
  pledgeValue: foreignText.optional(), pledgeConfigurationValue: foreignText.optional(), date: foreignText.optional(),
  contains: foreignText.optional(), items: z.array(foreignItem).max(100),
  alsoContains: z.array(z.object({ title: foreignText })).max(100),
  giftable: z.boolean().optional(), meltable: z.boolean().optional(), page: z.number().int().positive().optional(),
  gameAccessAssignment: z.array(z.enum(['sc','sq42'])).max(2).refine(games=>new Set(games).size===games.length).optional(),
  upgrade: foreignUpgrade.optional(), upgradeIssue: z.enum(['ambiguous', 'unreadable']).optional(),
  upgradeEvidence: foreignUpgradeEvidence.optional() });
const hangarlinkSchema = z.object({ type: z.literal('hangarexport'), version: z.literal(2),
  handle: z.string().trim().min(1).max(160), pledges: z.array(foreignPledge).max(50000),
  pledgesPagesize: z.number().int().positive().optional(), pledgesLastPage: z.number().int().positive().optional(),
  buybacks: z.array(z.object({ pledgeId: foreignText.optional(), pledgeName: z.string().min(1).max(500),
    contains: foreignText.optional(), buybackHref: foreignText.optional(), date: foreignText.optional(), page: z.number().optional() })).max(50000).optional(),
  buybacksPagesize: z.number().int().positive().optional(), buybacksLastPage: z.number().int().positive().optional() });

export function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function insurance(titles: string[]): Insurance {
  const lti = titles.find(t => /^lifetime insurance$/i.test(t.trim()));
  if (lti) return { kind: 'lti', evidence: lti };
  const months = titles.map(t => ({ t, m: /^(\d+)\s+months?\s+insurance$/i.exec(t.trim()) })).filter(x => x.m);
  if (months.length) {
    const best = months.sort((a, b) => Number(b.m![1]) - Number(a.m![1]))[0]!;
    const n = Number(best.m![1]);
    if (n > 0 && n <= 1200) return { kind: 'months', months: n, evidence: best.t };
  }
  return { kind: 'unknown', reason: 'Kein eindeutiger Versicherungsbestandteil im Export.' };
}
function fromHangarlink(raw: z.infer<typeof hangarlinkSchema>): InventoryDocument {
  return {
    type: 'sarevocs-ccu-inventory', schemaVersion: 1, appVersion: 'hangarexport-v2', createdAt: new Date().toISOString(),
    dataMode: 'real', account: { reference: raw.handle, identityKind: 'rsi-handle' },
    // The source has page metadata but no authoritative total or completion proof. Always additive.
    scope: { kind: 'partial', exportComplete: false, expectedPledges: null,
      pagesExpected: raw.pledgesLastPage ?? null, pagesRead: null },
    pledges: raw.pledges.map(p => {
      const ins = insurance([
        ...p.alsoContains.map(x => x.title),
        ...p.items.filter(x => /^insurance$/i.test(x.kind.trim())).map(x => x.title),
      ]);
      const titleUpgrade = /^Upgrade - (.+) to (.+)$/i.exec(p.pledgeName);
      // Structured export fields take precedence over translated or conflicting display titles.
      const upgrade = p.upgradeIssue ? undefined : p.upgrade ?? (titleUpgrade ? { from: titleUpgrade[1]!, to: titleUpgrade[2]! } : undefined);
      const occurrences = new Map<string, number>();
      const pledge: Pledge = { pledgeId: p.pledgeId, name: p.pledgeName, insurance: ins,
        originalDescription: p.contains ?? '',
        ships: p.items.filter(x => /^(ship|vehicle)$/i.test(x.kind.trim())).map(x => {
          const key = hash(JSON.stringify([x.kind, x.title, x.liner ?? ''])).slice(0, 24);
          const occurrence = (occurrences.get(key) ?? 0) + 1; occurrences.set(key, occurrence);
          return { childId: `${key}:${occurrence}`, modelName: x.title, modelId: null,
            identity: 'unresolved' as const, role: 'unverified' as const };
        }),
        ccus: upgrade ? [{ instanceId: `${p.pledgeId}:ccu`, from: upgrade.from, to: upgrade.to,
          status: 'unverified', applicability: 'unverified', insurance: ins }] : [],
        protected: true, baseReleased: false,
        restrictions: ['Schiffvariante, Paketkinder und CCU-Anwendbarkeit nicht am Konto geprüft.',
          ...(p.upgradeIssue ? ['CCU-Zuordnung ungeklärt. Ausgangs- und Zielschiff manuell prüfen; keine CCU-Kette daraus ableiten.'] : []),
          ...(p.meltable === false ? ['Laut Export nicht einschmelzbar.'] : []),
          ...(p.giftable === false ? ['Laut Export nicht verschenkbar.'] : [])],
        acquisitionCost: null, unknownCostReason: 'Persönliche Anschaffungskosten im Format nicht belegt.', meltValue: null,
        sourceValues: { pledgeValue: p.pledgeValue ?? '', pledgeConfigurationValue: p.pledgeConfigurationValue ?? '',
          date: p.date ?? '', alsoContains: JSON.stringify(p.alsoContains), items: JSON.stringify(p.items),
          ...(p.gameAccessAssignment!==undefined?{gameAccessAssignment:JSON.stringify(p.gameAccessAssignment)}:{}),
          ...(p.meltable!==undefined?{meltable:String(p.meltable)}:{}),
          ...(p.upgradeIssue ? { upgradeState: 'unresolved', upgradeIssue: p.upgradeIssue } : p.upgrade ? { upgrade: JSON.stringify(p.upgrade) } : {}),
          ...(p.upgrade && !p.upgradeIssue && p.upgradeEvidence ? { upgradeEvidence: JSON.stringify(p.upgradeEvidence) } : {}) },
      };
      return pledge;
    }),
    buybacks: (raw.buybacks ?? []).map(b => {
      const hrefId = /^\/account\/buy-back-pledges\/(\d+)$/.exec(b.buybackHref ?? '')?.[1];
      const entryId = b.pledgeId?.trim() || hrefId;
      if (!entryId) throw new UserError('Buyback ohne verlässliche Kennung. Datei wird nicht teilweise still übernommen.');
      return { entryId, name: b.pledgeName, description: b.contains ?? '', currentPrice: null, availability: 'unverified' };
    }),
  };
}
function validateIdentity(doc: InventoryDocument) {
  const pledges = new Set<string>(); const ccus = new Set<string>(); const buybacks = new Set<string>();
  for (const p of doc.pledges) {
    if (pledges.has(p.pledgeId)) throw new UserError('Doppelte Pledge-ID in derselben Datei.');
    pledges.add(p.pledgeId);
    const children = new Set<string>();
    for (const s of p.ships) { if (children.has(s.childId)) throw new UserError('Doppelte Kindkennung im Pledge.'); children.add(s.childId); }
    for (const c of p.ccus) { if (ccus.has(c.instanceId)) throw new UserError('Doppelte CCU-Exemplarkennung.'); ccus.add(c.instanceId); }
    if (p.acquisitionCost === null && !p.unknownCostReason) throw new UserError('Unbekannter Anschaffungspreis benötigt eine Begründung.');
  }
  for (const b of doc.buybacks) { if (buybacks.has(b.entryId)) throw new UserError('Doppelte Buyback-Kennung.'); buybacks.add(b.entryId); }
}
export function parseImport(input: Buffer | string): ImportCandidate {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  if (bytes.length > MAX_FILE_BYTES) throw new UserError('Datei zu groß. Maximal 20 MiB JSON.');
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')); }
  catch { throw new UserError('Keine gültige UTF-8-JSON-Datei. HTML, CSV und FleetView sind hier kein Hangarimport.'); }
  let doc: InventoryDocument; let adapter: string; const warnings: string[] = [];
  if (raw && typeof raw === 'object' && 'type' in raw && raw.type === 'sarevocs-ccu-inventory') {
    if (!('schemaVersion' in raw) || raw.schemaVersion !== 1) throw new UserError('Unbekannte Schemaversion. Unterstützt wird Version 1.');
    const parsed = documentSchema.safeParse(raw);
    if (!parsed.success) throw new UserError('Eigenes JSON ist strukturell ungültig. Felder, Datentypen oder Grenzwerte prüfen.');
    doc = parsed.data; adapter = 'sarevocs-json/1';
  } else if (raw && typeof raw === 'object' && 'type' in raw && raw.type === 'hangarexport') {
    const parsed = hangarlinkSchema.safeParse(raw);
    if (!parsed.success) throw new UserError('HangarLink-Export passt nicht zum geprüften Format hangarexport Version 2.');
    doc = documentSchema.parse(fromHangarlink(parsed.data)); adapter = 'hangarlink-v2/1';
    warnings.push('Quellformat anhand des öffentlichen Exportercodes geprüft; noch kein echter Nutzerexport getestet.',
      'Gesamtzahl und vollständiger Abschluss sind nicht verlässlich belegt: nur ergänzender Import.',
      'Preise bleiben Rohwerte ohne angenommene Währung oder Bedeutung; keine persönlichen Kaufkosten.',
      'Schiffidentitäten und CCU-Anwendbarkeit bleiben ungeprüft. Zusätzliche unbekannte Felder werden nicht übernommen.');
    if (parsed.data.pledges.some(pledge => pledge.upgradeIssue)) {
      warnings.push('Mindestens eine CCU-Zuordnung ist ungeklärt. Der Pledge bleibt erhalten; Ausgangs- und Zielschiff vor jeder Verwendung manuell prüfen.');
    }
  } else throw new UserError('Unbekanntes Format. Unterstützt: eigenes JSON v1 und HangarLink hangarexport v2.');
  validateIdentity(doc);
  const s = doc.scope;
  const complete = s.kind === 'full-hangar' && s.exportComplete && s.expectedPledges === doc.pledges.length &&
    s.pagesExpected !== null && s.pagesRead === s.pagesExpected;
  if (!complete) warnings.push('Unvollständiger oder ungeprüfter Umfang: fehlende alte Gegenstände bleiben erhalten.');
  if (doc.dataMode === 'demo') warnings.push('DEMO: synthetischer Bestand. Keine tatsächlichen RSI-Gegenstände.');
  return { adapter, document: doc, digest: hash(bytes.toString('utf8')), warnings,
    completeness: complete ? 'complete' : 'partial', evidence: complete ? 'file-declared' : 'scope-unverified' };
}

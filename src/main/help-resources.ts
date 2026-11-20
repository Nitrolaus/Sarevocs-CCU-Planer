import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const resources = {
  teces: 'https://robertsspaceindustries.com/en/orgs/TECES',
  kerberos: 'https://robertsspaceindustries.com/en/orgs/KERNAVY',
  bauaufsicht: 'https://robertsspaceindustries.com/en/orgs/BAUORG',
  arasil: 'https://www.twitch.tv/arasil__',
  erkul: 'https://erkul.games/calculator',
  fankit: 'https://support.robertsspaceindustries.com/hc/en-us/articles/360006895793-Star-Citizen-Fankit-and-Fandom-FAQ',
  fileHash: 'https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/get-filehash',
  kofi: 'https://ko-fi.com/sarevoc',
  paypal: 'https://www.paypal.com/ncp/payment/EKNGMDJFVKZHJ',
  bugReportDe: 'https://github.com/Nitrolaus/Sarevocs-CCU-Planer/issues/new?template=fehler.yml',
  bugReportEn: 'https://github.com/Nitrolaus/Sarevocs-CCU-Planer/issues/new?template=bug-report.yml',
} as const;

const documents = {
  terms: 'NUTZUNGSBEDINGUNGEN.txt',
  privacy: 'DATENSCHUTZ.md',
  notices: 'THIRD_PARTY_NOTICES.md',
} as const;

export type HelpResource = keyof typeof resources;
export type HelpDocument = keyof typeof documents;
export const helpResourceSchema = z.enum(Object.keys(resources) as HelpResource[]);
export const helpDocumentSchema = z.enum(Object.keys(documents) as HelpDocument[]);

export async function openHelpResource(resource: HelpResource, openExternal: (url: string) => Promise<void>) {
  await openExternal(resources[helpResourceSchema.parse(resource)]);
  return { opened: true as const };
}

export function readHelpDocument(document: HelpDocument, directory: string) {
  return readFile(path.join(directory, documents[helpDocumentSchema.parse(document)]), 'utf8');
}

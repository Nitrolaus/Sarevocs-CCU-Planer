import { z } from 'zod';

const urls = {
  gettingStarted: 'https://support.robertsspaceindustries.com/hc/en-us/articles/360037490754-Get-Started-Checklist',
  upgrades: 'https://support.robertsspaceindustries.com/hc/en-us/articles/115010056848-Ship-Upgrades-CCUs',
  storeCredit: 'https://support.robertsspaceindustries.com/hc/en-us/articles/115013173287-Spend-Store-Credit',
  revert: 'https://support.robertsspaceindustries.com/hc/en-us/articles/360042825053-Can-I-remove-or-revert-a-ship-upgrade',
} as const;

export type RsiHelpTopic = keyof typeof urls;
export const rsiHelpTopicSchema = z.enum(Object.keys(urls) as RsiHelpTopic[]);

export async function openRsiHelp(topic: RsiHelpTopic, openExternal: (url: string) => Promise<void>) {
  await openExternal(urls[rsiHelpTopicSchema.parse(topic)]);
  return { opened: true as const };
}

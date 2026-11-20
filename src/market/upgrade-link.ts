// Official Ship Upgrades entry linked by RSI's current help article. No invented SKU/from/to parameters.
export const RSI_UPGRADES_URL = 'https://robertsspaceindustries.com/en/pledge/';
export async function openRsiUpgrades(openExternal: (url: string) => Promise<unknown>): Promise<{ opened: true; prefilled: false }> {
  await openExternal(RSI_UPGRADES_URL);
  return { opened: true, prefilled: false };
}

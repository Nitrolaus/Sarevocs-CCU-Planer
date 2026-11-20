import { useEffect } from 'react';
import { shopPairs, SHOP_PRICE_MAX_AGE, type ShopPair } from '../market/shop-prices';
import type { ChainStep } from '../planner/chain';

export function useShopPrices(steps: readonly ChainStep[]) {
  const key = JSON.stringify(shopPairs(steps));
  useEffect(() => {
    const pairs: ShopPair[] = JSON.parse(key);
    if (!pairs.length) return;
    const check = () => void window.ccu.request({ action: 'market.shopPrices', pairs }).catch(() => {});
    check();
    const timer = setInterval(check, SHOP_PRICE_MAX_AGE + 1000);
    return () => clearInterval(timer);
  }, [key]);
}

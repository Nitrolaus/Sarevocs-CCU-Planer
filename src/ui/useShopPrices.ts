import { useEffect } from 'react';
import { shopPairs, MAX_SHOP_PAIRS, SHOP_PRICE_MAX_AGE, type ShopPair } from '../market/shop-prices';
import type { ChainStep } from '../planner/chain';

export function useShopPrices(steps: readonly ChainStep[]) {
  useShopPricePairs(shopPairs(steps), true);
}

export function useShopPricePairs(requested: readonly ShopPair[], refreshWhileOpen = false) {
  const key = JSON.stringify(requested);
  useEffect(() => {
    const pairs: ShopPair[] = JSON.parse(key);
    if (!pairs.length) return;
    const check = () => {
      for (let offset = 0; offset < pairs.length; offset += MAX_SHOP_PAIRS) {
        void window.ccu.request({ action: 'market.shopPrices', pairs: pairs.slice(offset, offset + MAX_SHOP_PAIRS) }).catch(() => {});
      }
    };
    check();
    if (!refreshWhileOpen) return;
    const timer = setInterval(check, SHOP_PRICE_MAX_AGE + 1000);
    return () => clearInterval(timer);
  }, [key, refreshWhileOpen]);
}

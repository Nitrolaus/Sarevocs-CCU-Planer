import { useEffect, useEffectEvent, useState } from 'react';
import type { TargetOffer } from '../market/model';
import type { AdvisorInput, PurchaseAdvice } from '../planner/advisor';

type Result = PurchaseAdvice | 'error';
const empty: ReadonlyMap<string, Result> = new Map();

/** One active calculation at a time, using the same read-only advisor as the planner. */
export function useFairPurchaseAdvice(input: AdvisorInput | null, signature: string, offers: TargetOffer[]) {
  const revision = input && offers.length ? JSON.stringify([signature, offers.map(offer => offer.key)]) : '';
  const readJob = useEffectEvent(() => ({ input, offers }));
  const [state, setState] = useState({ revision: '', results: empty });

  useEffect(() => {
    if (!revision) return;
    const job = readJob();
    let worker: Worker | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    let index = 0;
    const results = new Map<string, Result>();

    function next() {
      const offer = job.offers[index++];
      if (cancelled || !offer) {
        worker?.terminate();
        return;
      }
      function finish(result: Result) {
        if (cancelled) return;
        clearTimeout(timeout);
        if (result === 'error') {
          worker?.terminate();
          worker = undefined;
        }
        results.set(offer!.key, result);
        setState({ revision, results: new Map(results) });
        queueMicrotask(next);
      }
      try {
        worker ??= new Worker(new URL('./advisor-worker.js', window.location.href), { type: 'module' });
        worker.onmessage = (event: MessageEvent<{ ok: boolean; result?: PurchaseAdvice }>) => {
          const result = event.data?.result;
          finish(event.data?.ok && result?.offerKey === offer.key ? result : 'error');
        };
        worker.onerror = event => { event.preventDefault(); finish('error'); };
        timeout = setTimeout(() => finish('error'), 25000);
        worker.postMessage({ input: job.input, offer });
      } catch { finish('error'); }
    }
    next();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      worker?.terminate();
    };
  }, [revision]);

  return state.revision === revision ? state.results : empty;
}

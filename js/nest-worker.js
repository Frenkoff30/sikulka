// Web Worker: počítá skládání tvarů na pozadí a průběžně posílá nejlepší nalezené rozložení.
import { NestSolver } from './nest-engine.js';

self.onmessage = (e) => {
  const S = new NestSolver(e.data);
  let last = 0;
  const loop = () => {
    const r = S.step(80);
    const now = Date.now();
    if (S.best && (r.done || r.improved || now - last > 500)) {
      last = now;
      self.postMessage(Object.assign({ t: r.done ? 'done' : 'best' }, S.snapshot()));
    }
    if (!r.done) setTimeout(loop, 0);
  };
  loop();
};

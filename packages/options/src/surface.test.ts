import { describe, expect, it } from 'vitest';
import {
  constantMaturityIv,
  fitSmile,
  leaveOneOutResiduals,
  putSkew25Delta,
  smileIvAt,
  type SmilePoint,
} from './surface.js';

describe('fitSmile', () => {
  it('recovers a known quadratic', () => {
    const truth = { a: 0.28, b: -0.4, c: 1.2 };
    const points: SmilePoint[] = [];
    for (let x = -0.3; x <= 0.15 + 1e-9; x += 0.03) {
      points.push({ x, iv: smileIvAt(truth, x) });
    }
    const fit = fitSmile(points)!;
    expect(fit.a).toBeCloseTo(truth.a, 6);
    expect(fit.b).toBeCloseTo(truth.b, 6);
    expect(fit.c).toBeCloseTo(truth.c, 6);
  });

  it('is robust to a couple of outliers (Huber)', () => {
    const truth = { a: 0.3, b: -0.5, c: 1.0 };
    const points: SmilePoint[] = [];
    for (let x = -0.3; x <= 0.15 + 1e-9; x += 0.02) points.push({ x, iv: smileIvAt(truth, x) });
    points[3]!.iv += 0.5; // fat-fingered quote
    points[10]!.iv -= 0.4;
    const fit = fitSmile(points)!;
    expect(fit.a).toBeCloseTo(truth.a, 2);
    expect(fit.b).toBeCloseTo(truth.b, 1);
  });

  it('returns null with too few points', () => {
    expect(fitSmile([{ x: -0.1, iv: 0.3 }, { x: 0, iv: 0.28 }])).toBeNull();
  });
});

describe('leaveOneOutResiduals', () => {
  it('is ~0 for points that lie on the smile and large for an outlier', () => {
    const truth = { a: 0.3, b: -0.3, c: 0.8 };
    const points: SmilePoint[] = [];
    for (let x = -0.3; x <= 0.15 + 1e-9; x += 0.025) points.push({ x, iv: smileIvAt(truth, x) });
    points[5]!.iv += 0.06; // this contract is rich vs its surface
    const res = leaveOneOutResiduals(points);
    const cleanMax = Math.max(...res.filter((_, i) => i !== 5).map((r) => Math.abs(r ?? 0)));
    expect(cleanMax).toBeLessThan(5e-3);
    expect(res[5]!).toBeGreaterThan(0.03);
    expect(res[5]!).toBeGreaterThan(cleanMax * 8); // outlier clearly separates from the noise floor
  });
});

describe('constantMaturityIv', () => {
  it('interpolates total variance between two expirations', () => {
    // 20d @ 30% and 50d @ 40% → 30d somewhere between, in variance space
    const iv30 = constantMaturityIv([
      { t: 20 / 365, atmIv: 0.3 },
      { t: 50 / 365, atmIv: 0.4 },
    ])!;
    const w20 = 0.3 * 0.3 * (20 / 365);
    const w50 = 0.4 * 0.4 * (50 / 365);
    const w30 = w20 + ((30 - 20) / (50 - 20)) * (w50 - w20);
    expect(iv30).toBeCloseTo(Math.sqrt(w30 / (30 / 365)), 10);
  });

  it('flat-extrapolates a single expiration', () => {
    expect(constantMaturityIv([{ t: 40 / 365, atmIv: 0.33 }])).toBeCloseTo(0.33, 10);
  });
});

describe('putSkew25Delta', () => {
  it('is positive for a downward-sloping (equity) smile', () => {
    // b < 0, c > 0: IV rises as strike falls (x negative)
    const fit = { a: 0.3, b: -0.6, c: 1.5 };
    const skew = putSkew25Delta(fit, 0.3, 0.3, 0.04, 0, 35 / 365);
    expect(skew).toBeGreaterThan(0);
  });
});

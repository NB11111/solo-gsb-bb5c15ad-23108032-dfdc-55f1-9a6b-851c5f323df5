// 投料区间分析：在各反应物初始量（mol）的独立闭区间上联合求界。
// 生成物初始量为 0，反应按完全反应进行，反应进度 ξ = min_i(n_i / c_i)。
// 全程使用精确有理数（BigInt 分数），结果以约分分数展示。
//
// 各区间独立地从盒域 D = { n_i ∈ [L_i, U_i] } 中取值，但所有极值均对
// 整个联合域求取，绝不用各区间独立相减代替联合极值。
//
//   ξ_min = min_i L_i/c_i，ξ_max = min_i U_i/c_i
//   生成物 j 的量：c_j·ξ ∈ [c_j·ξ_min, c_j·ξ_max]
//   反应物 i 剩余量 R_i = n_i − c_i·ξ（固定其余投料时，R_i 关于 n_i 单调不减）：
//     R_i 最小 = 0（i 可在某组合中限量）当且仅当 L_i/c_i ≤ min_{k≠i} U_k/c_k；
//               否则 i 从不限量，最小为 L_i − c_i·min_{k≠i} U_k/c_k（>0），
//               在 n_i=L_i、其余全部取满处达到。
//     R_i 最大 = max(0, U_i − c_i·min_{k≠i} L_k/c_k)，
//               在 n_i=U_i、其余全部取下限处达到（被截断为 0 时 i 恒限量）。
// 限量分类（并列最小均算限量）：
//   always    —— 所有组合中 i 均为（并列）最小：U_i/c_i ≤ min_{k≠i} L_k/c_k
//   never     —— 所有组合中 i 都不最小：min_{k≠i} U_k/c_k < L_i/c_i（严格）
//   sometimes —— 仅部分组合限量（含恰好并列最小的边界）；以上两者对单点等比盒域
//                互斥且不会漏判（并列取 ≤ 归入 always）。

import { Frac } from './fraction.js';

export class FeedError extends Error {
  constructor(index, message) {
    super(message);
    this.name = 'FeedError';
    this.index = index; // 反应物下标（0 基）；-1 表示整体错误
  }
}

/** 同一请求中多个物质的区间错误聚合，便于一次性定位到每种物质。 */
export class FeedErrorsError extends Error {
  constructor(feedErrors) {
    super('投料区间存在错误');
    this.name = 'FeedErrorsError';
    this.feedErrors = feedErrors; // [{ index, message }]
  }
}

const MAX_BOUND = 1_000_000_000_000n; // 投料量上限（mol），防止 BigInt 膨胀

/** 解析非负十进制数（最多 6 位小数）为精确 Frac。非法输入抛出带物质下标的 FeedError。 */
export function parseDecimal(raw, index, field /* 'lower' | 'upper' */) {
  if (typeof raw !== 'string' || raw === '') {
    throw new FeedError(index, field === 'lower' ? '请填写下限' : '请填写上限');
  }
  const s = raw;
  if (/\s/.test(s)) {
    throw new FeedError(index, '数字中不能包含空格');
  }
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(s)) {
    if (s.startsWith('-') || s.startsWith('+')) {
      throw new FeedError(index, '投料量不能为负数');
    }
    throw new FeedError(index, '请输入非负十进制数字（如 0、1.5、0.25）');
  }
  if (s.includes('.') && s.split('.')[1].length > 6) {
    throw new FeedError(index, '最多保留 6 位小数');
  }
  const [intPart, fracPart = ''] = s.split('.');
  const digits = BigInt(intPart + fracPart);
  const den = 10n ** BigInt(fracPart.length);
  if (digits > MAX_BOUND * den) {
    throw new FeedError(index, `投料量不能超过 ${MAX_BOUND} mol`);
  }
  return new Frac(digits, den);
}

const le = (a, b) => a.n * b.d <= b.n * a.d; // a ≤ b
const lt = (a, b) => a.n * b.d < b.n * a.d; // a < b
const fracMin = (a, b) => (le(a, b) ? a : b);
const fracMax0 = (a) => (a.n > 0n ? a : new Frac(0n));

/** 输出约分分数：{ num, den, text }；整数时 den 为 "1"。 */
function out(x) {
  x = Frac.of(x);
  const num = x.n.toString();
  const den = x.d.toString();
  return { num, den, text: x.d === 1n ? num : `${num}/${den}` };
}

/** 排除下标 except 后数组的最小值；数组为空时返回 null（单一反应物情形，视为 +∞）。 */
function minExcept(arr, except) {
  let acc = null;
  for (let i = 0; i < arr.length; i++) {
    if (i === except) continue;
    acc = acc === null ? arr[i] : fracMin(acc, arr[i]);
  }
  return acc;
}

/**
 * coeffs：balanceEquationCore 返回的最简正整数系数（bigint[]，先反应物后生成物）。
 * nLeft：反应物数量。
 * ranges：[{ lower: string, upper: string }, ...]，长度必须等于 nLeft。
 * 任一反应物的区间错误都抛出 FeedError（携带反应物下标）。
 */
export function analyzeFeeds(coeffs, nLeft, ranges) {
  const c = coeffs.map((x) => BigInt(x));
  const m = Number(nLeft);

  if (!Array.isArray(ranges) || ranges.length !== m) {
    throw new FeedError(-1, '投料区间数量与反应物数量不一致，请重新配平后再分析');
  }

  const lower = [];
  const upper = [];
  const feedErrors = [];
  const collect = (fn) => {
    try {
      return fn();
    } catch (e) {
      if (e instanceof FeedError) {
        feedErrors.push({ index: e.index, message: e.message });
        return null;
      }
      throw e;
    }
  };

  for (let i = 0; i < m; i++) {
    const item = ranges[i] ?? {};
    lower.push(collect(() => parseDecimal(item.lower, i, 'lower')));
  }
  for (let i = 0; i < m; i++) {
    const item = ranges[i] ?? {};
    upper.push(collect(() => parseDecimal(item.upper, i, 'upper')));
  }
  for (let i = 0; i < m; i++) {
    if (lower[i] !== null && upper[i] !== null && !le(lower[i], upper[i])) {
      feedErrors.push({ index: i, message: '下限不能大于上限' });
    }
  }
  if (feedErrors.length > 0) throw new FeedErrorsError(feedErrors);

  // r_i = n_i/c_i 的区间端点（仅反应物）
  const lRatio = [];
  const uRatio = [];
  for (let i = 0; i < m; i++) {
    lRatio.push(lower[i].div(c[i]));
    uRatio.push(upper[i].div(c[i]));
  }

  // ξ 的可达最小/最大值（对联合盒域取 min）
  let xiMin = lRatio[0];
  let xiMax = uRatio[0];
  for (let i = 1; i < m; i++) {
    xiMin = fracMin(xiMin, lRatio[i]);
    xiMax = fracMin(xiMax, uRatio[i]);
  }

  const reactants = [];
  for (let i = 0; i < m; i++) {
    const ci = new Frac(c[i]);
    let classification;
    let remainMin;
    let remainMax;

    if (m === 1) {
      // 唯一反应物：它恒为限量者，完全反应后剩余恒为 0
      classification = 'always';
      remainMin = new Frac(0n);
      remainMax = new Frac(0n);
    } else {
      const minURatio = minExcept(uRatio, i); // 其余取满时别人能达到的最小比值
      const minLRatio = minExcept(lRatio, i); // 其余取下限时别人的最小比值

      // 限量分类（并列最小也算限量，故 always 用 ≤、never 用严格 <）
      if (le(uRatio[i], minLRatio)) {
        classification = 'always';
      } else if (lt(minURatio, lRatio[i])) {
        classification = 'never';
      } else {
        classification = 'sometimes';
      }

      // 剩余最小值：能否在某组合中成为（并列）最小 ⇔ L_i/c_i ≤ minURatio
      if (le(lRatio[i], minURatio)) {
        remainMin = new Frac(0n);
      } else {
        // 从不限量：n_i=L_i、其余全部取满时 ξ 最大，剩余最小且严格为正
        remainMin = lower[i].sub(ci.mul(minURatio));
      }

      // 剩余最大值：n_i=U_i、其余全部取下限（联合求界，非逐区间相减）
      remainMax = fracMax0(upper[i].sub(ci.mul(minLRatio)));
    }

    reactants.push({
      index: i,
      coefficient: c[i].toString(),
      feed: { lower: out(lower[i]), upper: out(upper[i]) },
      limiting: classification,
      remaining: { min: out(remainMin), max: out(remainMax) },
    });
  }

  const products = [];
  for (let j = m; j < c.length; j++) {
    const cj = new Frac(c[j]);
    products.push({
      index: j - m,
      coefficient: c[j].toString(),
      amount: { min: out(cj.mul(xiMin)), max: out(cj.mul(xiMax)) },
    });
  }

  return {
    extent: { min: out(xiMin), max: out(xiMax) },
    reactants,
    products,
  };
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFormula } from '../chem/parse.js';
import { balanceEquationCore } from '../chem/balance.js';
import { analyzeFeeds, parseDecimal, FeedError, FeedErrorsError } from '../chem/feed.js';

const core = (left, right) =>
  balanceEquationCore(left.map((s) => parseFormula(s)), right.map((s) => parseFormula(s)));

const analyze = (left, right, ranges) => {
  const r = core(left, right);
  assert.equal(r.status, 'balanced');
  return analyzeFeeds(r.coeffs, r.nLeft, ranges);
};

const text = (b) => b.text;

// ---------- 十进制解析 ----------

test('parseDecimal：精确分数解析与约分', () => {
  assert.equal(parseDecimal('0', 0, 'lower').n, 0n);
  assert.deepEqual(
    [parseDecimal('1.5', 0, 'lower').n, parseDecimal('1.5', 0, 'lower').d],
    [3n, 2n]
  );
  assert.deepEqual(
    [parseDecimal('0.250', 0, 'lower').n, parseDecimal('0.250', 0, 'lower').d],
    [1n, 4n] // 自动约分
  );
  assert.deepEqual(
    [parseDecimal('1.000000', 0, 'lower').n, parseDecimal('1.000000', 0, 'lower').d],
    [1n, 1n]
  );
});

test('parseDecimal：非法输入定位到物质', () => {
  const bad = ['', 'abc', '-1', '1.2.3', '1.0000001', '1e3', '.5', ' 1', '1 '];
  for (const v of bad) {
    assert.throws(
      () => parseDecimal(v, 2, 'lower'),
      (e) => e instanceof FeedError && e.index === 2,
      `${JSON.stringify(v)} 应报错并定位到下标 2`
    );
  }
  assert.throws(() => parseDecimal('0.0000001', 0, 'upper'), /6 位小数/);
});

// ---------- 基础：氢气燃烧 2H2 + O2 -> 2H2O ----------

test('氢气燃烧：ξ 与生成物量的联合边界', () => {
  const r = analyze(['H2', 'O2'], ['H2O'], [
    { lower: '2', upper: '4' }, // H2 ∈ [2,4] mol，比值 n/2 ∈ [1,2]
    { lower: '1', upper: '2' }, // O2 ∈ [1,2] mol，比值 n/1 ∈ [1,2]
  ]);
  assert.deepEqual(text(r.extent.min), '1');
  assert.deepEqual(text(r.extent.max), '2');
  // 生成物 H2O：系数 2，量 = 2ξ ∈ [2,4]
  assert.equal(r.products[0].coefficient, '2');
  assert.deepEqual(text(r.products[0].amount.min), '2');
  assert.deepEqual(text(r.products[0].amount.max), '4');
});

test('氢气燃烧：部分组合限量 + 并列最小算限量', () => {
  const r = analyze(['H2', 'O2'], ['H2O'], [
    { lower: '2', upper: '4' },
    { lower: '1', upper: '2' },
  ]);
  assert.equal(r.reactants[0].limiting, 'sometimes');
  assert.equal(r.reactants[1].limiting, 'sometimes');
  // 两者剩余均可低至 0；最大在“自己取满、对方取下限”处联合达到：
  //   H2：4 − 2·(1/1) = 2；O2：2 − 1·(2/2) = 1
  assert.deepEqual(text(r.reactants[0].remaining.min), '0');
  assert.deepEqual(text(r.reactants[0].remaining.max), '2');
  assert.deepEqual(text(r.reactants[1].remaining.min), '0');
  assert.deepEqual(text(r.reactants[1].remaining.max), '1');
});

test('恒限量 / 从不限量：O2 恒限量，H2 从不限量', () => {
  const r = analyze(['H2', 'O2'], ['H2O'], [
    { lower: '4', upper: '10' }, // H2 比值 ∈ [2,5]
    { lower: '1', upper: '1' }, // O2 比值 = 1
  ]);
  assert.equal(r.reactants[0].limiting, 'never');
  assert.equal(r.reactants[1].limiting, 'always');
  // H2 永远有剩余：[4-2*1, 10-2*1] = [2,8]
  assert.deepEqual(text(r.reactants[0].remaining.min), '2');
  assert.deepEqual(text(r.reactants[0].remaining.max), '8');
  // O2 完全反应
  assert.deepEqual(text(r.reactants[1].remaining.min), '0');
  assert.deepEqual(text(r.reactants[1].remaining.max), '0');
  // ξ 恒为 1
  assert.deepEqual(text(r.extent.min), '1');
  assert.deepEqual(text(r.extent.max), '1');
});

test('单点等比盒域：并列最小算恒限量', () => {
  const r = analyze(['H2', 'O2'], ['H2O'], [
    { lower: '2', upper: '2' },
    { lower: '1', upper: '1' },
  ]);
  assert.equal(r.reactants[0].limiting, 'always');
  assert.equal(r.reactants[1].limiting, 'always');
  for (const x of r.reactants) {
    assert.deepEqual(text(x.remaining.min), '0');
    assert.deepEqual(text(x.remaining.max), '0');
  }
});

test('单反应物：恒限量且剩余恒为零', () => {
  const r = analyze(['H2O2'], ['H2O', 'O2'], [{ lower: '3', upper: '9' }]);
  assert.equal(r.reactants[0].limiting, 'always');
  assert.deepEqual(text(r.reactants[0].remaining.min), '0');
  assert.deepEqual(text(r.reactants[0].remaining.max), '0');
  // 系数 2，ξ ∈ [3/2, 9/2]；H2O 系数 2 -> [3,9]，O2 系数 1 -> [3/2, 9/2]
  assert.deepEqual(text(r.extent.min), '3/2');
  assert.deepEqual(text(r.extent.max), '9/2');
  assert.deepEqual(text(r.products[0].amount.min), '3');
  assert.deepEqual(text(r.products[0].amount.max), '9');
  assert.deepEqual(text(r.products[1].amount.min), '3/2');
  assert.deepEqual(text(r.products[1].amount.max), '9/2');
});

test('三种反应物的限量分类', () => {
  // 构造配平：设反应 aA + bB + cC -> ...，直接用真实反应
  // 2Al + 6HCl -> 2AlCl3 + 3H2，比值 n/2 与 n/6
  const r = analyze(['Al', 'HCl'], ['AlCl3', 'H2'], [
    { lower: '2', upper: '2' }, // Al 比值 1
    { lower: '6', upper: '12' }, // HCl 比值 ∈ [1,2]
  ]);
  assert.equal(r.reactants[0].limiting, 'always'); // 2/2=1 ≤ 6/6=1（并列算限量）
  assert.equal(r.reactants[1].limiting, 'sometimes');
  assert.deepEqual(text(r.reactants[0].remaining.max), '0');
  assert.deepEqual(text(r.reactants[1].remaining.max), '6');
});

test('小数精确计算：无浮点误差', () => {
  const r = analyze(['H2', 'O2'], ['H2O'], [
    { lower: '0.1', upper: '0.3' }, // 比值 ∈ [1/20, 3/20]
    { lower: '0.1', upper: '0.2' }, // 比值 ∈ [1/10, 1/5]
  ]);
  assert.deepEqual(text(r.extent.min), '1/20');
  assert.deepEqual(text(r.extent.max), '3/20');
  assert.deepEqual(text(r.products[0].amount.min), '1/10');
  assert.deepEqual(text(r.products[0].amount.max), '3/10');
  // H2 最大剩余 = 0.3 − 2·min(0.1/1) = 1/10
  assert.deepEqual(text(r.reactants[0].remaining.max), '1/10');
  // O2 最大剩余 = max(0, 0.2 − 1·min(0.1/2)) = 3/20；截断下界为 0
  assert.deepEqual(text(r.reactants[1].remaining.min), '0');
  assert.deepEqual(text(r.reactants[1].remaining.max), '3/20');
});

test('联合求界不得用区间独立相减代替（关键反例）', () => {
  // 反应 A+2B+3C -> P（用具体反应不方便构造，改用三反应物真实反应）：
  // 2KMnO4 + 16HCl 难以三方；采用 N2 + 3H2 -> 2NH3，再叠加一个反应物：
  // N2 + 3H2 -> 2NH3
  // N2 ∈ [1, 10]，H2 ∈ [3, 3]（比值恒为 1）
  // N2 恒限量；其剩余 min=0、max=max(0, 10−1·1)=9
  const r = analyze(['N2', 'H2'], ['NH3'], [
    { lower: '1', upper: '10' },
    { lower: '3', upper: '3' },
  ]);
  assert.equal(r.reactants[0].limiting, 'sometimes'); // 1/1=1 可并列，10 时 H2 限量
  assert.equal(r.reactants[1].limiting, 'always');
  // 若用“独立区间相减”：H2 剩余 = [3,3] − 3·[min(nN2/1), ...] 易误得非零下界；
  // 联合求界要求 H2 剩余恒为 0：
  assert.deepEqual(text(r.reactants[1].remaining.min), '0');
  assert.deepEqual(text(r.reactants[1].remaining.max), '0');
  assert.deepEqual(text(r.reactants[0].remaining.max), '9');
  // NH3 ∈ [2·1, 2·1] = [2,2]（ξ 恒为 1）
  assert.deepEqual(text(r.products[0].amount.min), '2');
  assert.deepEqual(text(r.products[0].amount.max), '2');
});

test('下限大于上限报错并定位物质', () => {
  assert.throws(
    () =>
      analyze(['H2', 'O2'], ['H2O'], [
        { lower: '3', upper: '2' },
        { lower: '1', upper: '2' },
      ]),
    (e) =>
      e instanceof FeedErrorsError &&
      e.feedErrors.length === 1 &&
      e.feedErrors[0].index === 0 &&
      /下限不能大于上限/.test(e.feedErrors[0].message)
  );
});

test('区间数量不匹配报整体错误', () => {
  const r = core(['H2', 'O2'], ['H2O']);
  assert.throws(
    () => analyzeFeeds(r.coeffs, r.nLeft, [{ lower: '1', upper: '2' }]),
    (e) => e instanceof FeedError && e.index === -1
  );
});

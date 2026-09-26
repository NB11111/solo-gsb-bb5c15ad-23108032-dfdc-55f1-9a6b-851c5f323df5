import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../index.js';

let server;
let baseUrl;

await new Promise((resolve) => {
  server = app.listen(0, () => {
    baseUrl = `http://localhost:${server.address().port}`;
    resolve();
  });
});

after(() => server.close());

const post = (path, body) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

test('GET / 返回前端页面（若已构建）', async () => {
  const res = await fetch(`${baseUrl}/`);
  // 未构建 dist 时无路由，返回 404 也算正常（测试环境）
  assert.ok(res.status === 200 || res.status === 404);
});

test('/api/analyze：唯一正解时给出联合边界', async () => {
  const j = await post('/api/analyze', {
    left: ['H2', 'O2'],
    right: ['H2O'],
    ranges: [
      { lower: '2', upper: '4' },
      { lower: '1', upper: '2' },
    ],
  });
  assert.equal(j.ok, true);
  assert.deepEqual(j.analysis.extent, {
    min: { num: '1', den: '1', text: '1' },
    max: { num: '2', den: '1', text: '2' },
  });
  assert.equal(j.analysis.reactants[0].limiting, 'sometimes');
  assert.deepEqual(j.analysis.products[0].amount.max.text, '4');
});

test('/api/analyze：区间错误定位到具体物质', async () => {
  const j = await post('/api/analyze', {
    left: ['H2', 'O2'],
    right: ['H2O'],
    ranges: [
      { lower: '5', upper: '4' },
      { lower: '1', upper: '2' },
    ],
  });
  assert.equal(j.ok, false);
  assert.equal(j.feedErrors.length, 1);
  assert.equal(j.feedErrors[0].index, 0);
  assert.match(j.feedErrors[0].message, /下限不能大于上限/);
});

test('/api/analyze：非数字 / 小数位数错误定位到物质', async () => {
  const j = await post('/api/analyze', {
    left: ['H2', 'O2'],
    right: ['H2O'],
    ranges: [
      { lower: 'abc', upper: '4' },
      { lower: '1', upper: '1.1234567' },
    ],
  });
  assert.equal(j.ok, false);
  const byIndex = Object.fromEntries(j.feedErrors.map((e) => [e.index, e.message]));
  assert.match(byIndex[0], /非负十进制/);
  assert.match(byIndex[1], /6 位小数/);
});

test('/api/analyze：解不唯一时拒绝分析', async () => {
  const j = await post('/api/analyze', {
    left: ['H2', 'O2'],
    right: ['H2O', 'H2O2'],
    ranges: [
      { lower: '1', upper: '2' },
      { lower: '1', upper: '2' },
    ],
  });
  assert.equal(j.ok, false);
  assert.match(j.errors[0].message, /解不唯一/);
});

test('/api/analyze：语法错误仍按物质/字符位置返回', async () => {
  const j = await post('/api/analyze', {
    left: ['H2', 'o2'],
    right: ['H2O'],
    ranges: [
      { lower: '1', upper: '2' },
      { lower: '1', upper: '2' },
    ],
  });
  assert.equal(j.ok, false);
  assert.equal(j.errors[0].side, 'left');
  assert.equal(j.errors[0].index, 1);
});

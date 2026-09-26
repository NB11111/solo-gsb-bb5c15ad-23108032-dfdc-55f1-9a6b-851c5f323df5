import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseFormula, ParseError } from './chem/parse.js';
import { balanceEquation, balanceEquationCore } from './chem/balance.js';
import { analyzeFeeds, FeedError, FeedErrorsError } from './chem/feed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '64kb' }));

const MAX_SUBSTANCES = 20;
const MAX_FORMULA_LEN = 200;

/** 解析并校验左右两侧化学式，返回 { parsed, errors }。 */
function parseSides(body) {
  const errors = [];
  const parsed = {};
  const raw = {};

  for (const side of ['left', 'right']) {
    const list = body[side];
    if (!Array.isArray(list) || list.length === 0) {
      errors.push({ side, index: -1, position: null, message: '每侧至少填写一种物质' });
      continue;
    }
    if (list.length > MAX_SUBSTANCES) {
      errors.push({ side, index: -1, position: null, message: `每侧物质数量不能超过 ${MAX_SUBSTANCES}` });
      continue;
    }
    raw[side] = [];
    parsed[side] = list.map((formula, index) => {
      if (typeof formula !== 'string' || formula.trim() === '') {
        errors.push({ side, index, position: null, message: '化学式不能为空' });
        return null;
      }
      const trimmed = formula.trim();
      raw[side][index] = trimmed;
      if (trimmed.length > MAX_FORMULA_LEN) {
        errors.push({ side, index, position: null, message: `化学式过长（最多 ${MAX_FORMULA_LEN} 个字符）` });
        return null;
      }
      try {
        return parseFormula(trimmed);
      } catch (e) {
        if (e instanceof ParseError) {
          errors.push({
            side,
            index,
            position: e.position + 1, // 转为 1 基，便于用户定位
            message: e.message,
            formula: trimmed,
          });
          return null;
        }
        throw e;
      }
    });
  }

  return { parsed, raw, errors };
}

app.post('/api/balance', (req, res) => {
  const body = req.body ?? {};
  const { parsed, errors } = parseSides(body);
  if (errors.length > 0) return res.json({ ok: false, errors });

  const result = balanceEquation(parsed.left, parsed.right);
  res.json({ ok: true, result });
});

// 投料区间分析：复用化学式解析与配平，仅对唯一正系数解（balanced）开放。
app.post('/api/analyze', (req, res) => {
  const body = req.body ?? {};
  const { parsed, errors } = parseSides(body);
  if (errors.length > 0) return res.json({ ok: false, errors });

  const core = balanceEquationCore(parsed.left, parsed.right);
  if (core.status !== 'balanced') {
    return res.json({
      ok: false,
      errors: [
        {
          side: 'left',
          index: -1,
          position: null,
          message:
            core.status === 'not-unique'
              ? '该反应配平解不唯一，投料区间分析仅对唯一正系数解开放'
              : '该反应无正系数解，无法进行投料区间分析',
        },
      ],
    });
  }

  try {
    const analysis = analyzeFeeds(core.coeffs, core.nLeft, body.ranges);
    res.json({
      ok: true,
      analysis: {
        coefficients: {
          left: core.coeffs.slice(0, core.nLeft).map((x) => x.toString()),
          right: core.coeffs.slice(core.nLeft).map((x) => x.toString()),
        },
        ...analysis,
      },
    });
  } catch (e) {
    if (e instanceof FeedErrorsError) {
      return res.json({ ok: false, feedErrors: e.feedErrors });
    }
    if (e instanceof FeedError) {
      return res.json({
        ok: false,
        feedErrors: [{ index: e.index, message: e.message }],
      });
    }
    throw e;
  }
});

// 生产模式：托管前端构建产物
const dist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const PORT = process.env.PORT || 3000;

// 直接运行时才监听；被测试模块 import 时不占用端口
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  app.listen(PORT, () => {
    console.log(`化学反应式配平服务已启动: http://localhost:${PORT}`);
  });
}

export default app;

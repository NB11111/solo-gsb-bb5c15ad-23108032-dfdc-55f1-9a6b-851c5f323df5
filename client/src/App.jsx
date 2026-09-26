import { useState } from 'react';

const EXAMPLES = [
  { name: '氢气燃烧', left: ['H2', 'O2'], right: ['H2O'] },
  { name: '甲烷燃烧', left: ['CH4', 'O2'], right: ['CO2', 'H2O'] },
  { name: '实验室制氯气', left: ['KMnO4', 'HCl'], right: ['KCl', 'MnCl2', 'Cl2', 'H2O'] },
  { name: '磷酸钙（括号）', left: ['Ca(OH)2', 'H3PO4'], right: ['Ca3(PO4)2', 'H2O'] },
  { name: '两层括号', left: ['K4(Fe(CN)6)', 'H2SO4', 'H2O'], right: ['K2SO4', 'FeSO4', '(NH4)2SO4', 'CO'] },
  { name: '铜与稀硝酸', left: ['Cu', 'HNO3'], right: ['Cu(NO3)2', 'NO', 'H2O'] },
  { name: '无正解示例', left: ['H2', 'O2'], right: ['CO2'] },
  { name: '解不唯一示例', left: ['H2', 'O2'], right: ['H2O', 'H2O2'] },
];

const LIMITING_LABELS = {
  always: { text: '均限量', cls: 'limit-always', title: '在所有允许的投料组合中，该物质都是限量反应物（并列最小也算限量）' },
  sometimes: { text: '部分限量', cls: 'limit-sometimes', title: '仅在部分允许的投料组合中限量（含恰好并列最小的边界）' },
  never: { text: '从不限量', cls: 'limit-never', title: '在所有允许的投料组合中都不限量，必有剩余' },
};

function SubstancePanel({ title, accent, items, onChange, onRemove, onAdd }) {
  return (
    <section className={`panel panel-${accent}`}>
      <h2>{title}</h2>
      <div className="rows">
        {items.map((value, index) => (
          <div className="row" key={index}>
            <span className="row-index">{index + 1}</span>
            <input
              value={value}
              spellCheck="false"
              autoComplete="off"
              placeholder="如 Ca(OH)2"
              onChange={(e) => onChange(index, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onAdd();
              }}
            />
            <button
              type="button"
              className="icon-btn"
              title="删除该物质"
              disabled={items.length <= 1}
              onClick={() => onRemove(index)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="add-btn" onClick={onAdd}>
        ＋ 添加物质
      </button>
    </section>
  );
}

/** 将已验证的化学式中的数字渲染为下标。 */
function FormulaText({ formula }) {
  return formula.split(/(\d+)/g).map((part, i) =>
    /^\d+$/.test(part) ? <sub key={i}>{part}</sub> : <span key={i}>{part}</span>
  );
}

function ErrorItem({ err }) {
  const sideLabel = err.side === 'left' ? '左侧' : '右侧';
  const which = err.index >= 0 ? `第 ${err.index + 1} 个物质` : '整体';
  const pointer =
    err.position != null && err.formula != null ? (
      <pre className="pointer">
        {err.formula}
        {'\n'}
        {' '.repeat(err.position - 1)}^
      </pre>
    ) : null;
  return (
    <li>
      <div className="error-head">
        <strong>{sideLabel}</strong> · {which}
        {err.position != null ? ` · 第 ${err.position} 个字符` : ''}：{err.message}
      </div>
      {pointer}
    </li>
  );
}

function EquationTerm({ coefficient, formula }) {
  return (
    <span className="term">
      {Number(coefficient) > 1 && <span className="coef">{coefficient}</span>}
      <FormulaText formula={formula} />
    </span>
  );
}

/** 约分分数：整数直接显示，否则分子/分母上下堆叠。 */
function FracView({ value }) {
  if (!value) return null;
  if (value.den === '1') return <span className="frac-int">{value.num}</span>;
  return (
    <span className="frac" title={value.text}>
      <span className="frac-num">{value.num}</span>
      <span className="frac-line" />
      <span className="frac-den">{value.den}</span>
    </span>
  );
}

function RangeCell({ index, field, value, onChange, hasError }) {
  return (
    <input
      className={`range-input${hasError ? ' range-input-error' : ''}`}
      value={value}
      inputMode="decimal"
      spellCheck="false"
      autoComplete="off"
      placeholder="0.000"
      title="非负十进制数，最多 6 位小数，单位 mol"
      onChange={(e) => onChange(index, field, e.target.value)}
    />
  );
}

function FeedAnalysis({
  left,
  right,
  coefficients,
  ranges,
  onRangeChange,
  onAnalyze,
  analyzing,
  feedErrors,
  analysis,
}) {
  const formulas = left.map((f) => f.trim());
  const productFormulas = right.map((f) => f.trim());
  const errorMap = new Map((feedErrors ?? []).map((e) => [e.index, e.message]));

  return (
    <div className="feed-analysis">
      <h3>投料区间分析</h3>
      <p className="feed-intro">
        为每种反应物填写初始投料量的<strong>下限 / 上限</strong>（单位 mol，非负十进制数，最多 6 位小数，
        下限 ≤ 上限；各区间相互独立）。生成物初始量为 0，按<strong>完全反应</strong>计算
        反应进度 <em>ξ</em> = min(<em>n<sub>i</sub></em>/<em>c<sub>i</sub></em>)，
        所有可达最小值 / 最大值均在允许投料组合上<strong>联合求界</strong>，以约分分数给出。
      </p>

      <table className="feed-table">
        <thead>
          <tr>
            <th>反应物</th>
            <th>系数 <em>c<sub>i</sub></em></th>
            <th>下限 (mol)</th>
            <th>上限 (mol)</th>
            <th>限量情况</th>
            <th>剩余量最小值</th>
            <th>剩余量最大值</th>
            <th className="err-col">区间错误</th>
          </tr>
        </thead>
        <tbody>
          {formulas.map((formula, i) => {
            const info = analysis?.reactants?.[i];
            const tag = info ? LIMITING_LABELS[info.limiting] : null;
            return (
              <tr key={i} className={errorMap.has(i) ? 'row-error' : undefined}>
                <td className="el-symbol">
                  <FormulaText formula={formula} />
                </td>
                <td>{coefficients[i]}</td>
                <td>
                  <RangeCell
                    index={i}
                    field="lower"
                    value={ranges[i]?.lower ?? ''}
                    onChange={onRangeChange}
                    hasError={errorMap.has(i)}
                  />
                </td>
                <td>
                  <RangeCell
                    index={i}
                    field="upper"
                    value={ranges[i]?.upper ?? ''}
                    onChange={onRangeChange}
                    hasError={errorMap.has(i)}
                  />
                </td>
                <td>
                  {tag ? (
                    <span className={`limit-badge ${tag.cls}`} title={tag.title}>
                      {tag.text}
                    </span>
                  ) : (
                    <span className="muted-cell">—</span>
                  )}
                </td>
                <td className="num-cell">{info ? <FracView value={info.remaining.min} /> : <span className="muted-cell">—</span>}</td>
                <td className="num-cell">{info ? <FracView value={info.remaining.max} /> : <span className="muted-cell">—</span>}</td>
                <td className="err-cell">{errorMap.get(i) ?? ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {errorMap.has(-1) && <div className="feed-error-global">{errorMap.get(-1)}</div>}

      <div className="feed-action">
        <button type="button" className="analyze-btn" disabled={analyzing} onClick={onAnalyze}>
          {analyzing ? '计算中…' : '分析投料区间'}
        </button>
        <span className="syntax-hint">
          结果由服务端在整个联合投料域上精确求界（有理数），不是各区间独立相减
        </span>
      </div>

      {analysis && (
        <div className="feed-result">
          <div className="extent-line">
            反应进度 <em>ξ</em> 的可达范围：
            <span className="extent-range">
              <FracView value={analysis.extent.min} />
              <span className="sep"> ≤ ξ ≤ </span>
              <FracView value={analysis.extent.max} />
              <span className="unit"> mol</span>
            </span>
          </div>

          <table className="feed-table product-table">
            <thead>
              <tr>
                <th>生成物（初始量为 0）</th>
                <th>系数 <em>c<sub>j</sub></em></th>
                <th>生成量最小值 <em>c<sub>j</sub></em>ξ</th>
                <th>生成量最大值 <em>c<sub>j</sub></em>ξ</th>
              </tr>
            </thead>
            <tbody>
              {analysis.products.map((p) => (
                <tr key={p.index}>
                  <td className="el-symbol">
                    <FormulaText formula={productFormulas[p.index]} />
                  </td>
                  <td>{p.coefficient}</td>
                  <td className="num-cell">
                    <FracView value={p.amount.min} />
                  </td>
                  <td className="num-cell">
                    <FracView value={p.amount.max} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [left, setLeft] = useState(['H2', 'O2']);
  const [right, setRight] = useState(['H2O']);
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState(null);
  const [networkError, setNetworkError] = useState('');

  // 投料区间分析状态
  const [ranges, setRanges] = useState([{ lower: '', upper: '' }, { lower: '', upper: '' }]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [feedErrors, setFeedErrors] = useState([]);
  const [feedNetError, setFeedNetError] = useState('');

  /** 修改反应式（增删改、换示例、重新配平）时立即清除投料结果。 */
  const resetFeed = (count) => {
    setRanges(Array.from({ length: count }, () => ({ lower: '', upper: '' })));
    setAnalysis(null);
    setFeedErrors([]);
    setFeedNetError('');
  };

  const changeLeft = (index, value) => {
    setLeft((list) => list.map((v, i) => (i === index ? value : v)));
    // 修改反应式文本即立即清除投料结果（区间行数不变）
    setAnalysis(null);
    setFeedErrors([]);
    setFeedNetError('');
  };

  const changeRight = (index, value) => {
    setRight((list) => list.map((v, i) => (i === index ? value : v)));
    setAnalysis(null);
    setFeedErrors([]);
    setFeedNetError('');
  };

  const addLeft = () => {
    setLeft((list) => [...list, '']);
    resetFeed(ranges.length + 1);
  };

  const removeLeft = (index) => {
    if (left.length <= 1) return;
    setLeft(left.filter((_, i) => i !== index));
    resetFeed(ranges.length - 1);
  };

  const addRight = () => {
    setRight([...right, '']);
    setAnalysis(null);
    setFeedErrors([]);
    setFeedNetError('');
  };

  const removeRight = (index) => {
    if (right.length <= 1) return;
    setRight(right.filter((_, i) => i !== index));
    setAnalysis(null);
    setFeedErrors([]);
    setFeedNetError('');
  };

  const loadExample = (ex) => {
    setLeft(ex.left.slice());
    setRight(ex.right.slice());
    setResp(null);
    setNetworkError('');
    resetFeed(ex.left.length);
  };

  const handleBalance = async () => {
    setLoading(true);
    setResp(null);
    setNetworkError('');
    resetFeed(left.length);
    try {
      const res = await fetch('/api/balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ left, right }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setResp(await res.json());
    } catch (e) {
      setNetworkError(`请求失败：${e.message}。请确认后端服务已启动。`);
    } finally {
      setLoading(false);
    }
  };

  const handleRangeChange = (index, field, value) => {
    setRanges((list) => {
      const next = list.length === left.length ? list : Array.from({ length: left.length }, (_, i) => list[i] ?? { lower: '', upper: '' });
      return next.map((r, i) => (i === index ? { ...r, [field]: value } : r));
    });
    // 修改区间输入即清除旧的分析结果与错误提示（结果区恢复待计算）
    setAnalysis(null);
    setFeedErrors([]);
    setFeedNetError('');
  };

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setFeedErrors([]);
    setFeedNetError('');
    setAnalysis(null);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ left, right, ranges }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (j.ok) {
        setAnalysis(j.analysis);
      } else if (j.feedErrors) {
        setFeedErrors(j.feedErrors);
      } else {
        setFeedErrors(
          (j.errors ?? []).map((e) => ({
            index: e.side === 'left' ? e.index : -1,
            message:
              e.side === 'right' && e.index >= 0
                ? `右侧第 ${e.index + 1} 个物质：${e.message}`
                : e.message,
          }))
        );
      }
    } catch (e) {
      setFeedNetError(`请求失败：${e.message}。请确认后端服务已启动。`);
    } finally {
      setAnalyzing(false);
    }
  };

  const result = resp?.ok ? resp.result : null;

  return (
    <div className="page">
      <header>
        <h1>化学反应式配平</h1>
        <p className="subtitle">
          精确有理数消元 · 元素守恒矩阵 · 零空间一维且系数全为正时才给出解
        </p>
      </header>

      <div className="examples">
        <span className="examples-label">可编辑示例：</span>
        {EXAMPLES.map((ex) => (
          <button key={ex.name} type="button" className="chip" onClick={() => loadExample(ex)}>
            {ex.name}
          </button>
        ))}
      </div>

      <div className="panels">
        <SubstancePanel
          title="左侧：反应物"
          accent="left"
          items={left}
          onChange={changeLeft}
          onRemove={removeLeft}
          onAdd={addLeft}
        />
        <div className="arrow" aria-hidden="true">
          ⇌
        </div>
        <SubstancePanel
          title="右侧：生成物"
          accent="right"
          items={right}
          onChange={changeRight}
          onRemove={removeRight}
          onAdd={addRight}
        />
      </div>

      <div className="action">
        <button type="button" className="balance-btn" disabled={loading} onClick={handleBalance}>
          {loading ? '求解中…' : '配平'}
        </button>
        <span className="syntax-hint">
          语法：元素符号区分大小写（Na ≠ na）、正整数下标、圆括号最多三层；不支持电荷、水合点号和前置系数
        </span>
      </div>

      {networkError && <div className="notice notice-error">{networkError}</div>}

      {resp && !resp.ok && (
        <div className="result notice notice-error">
          <h2>语法错误</h2>
          <ul className="error-list">
            {resp.errors.map((err, i) => (
              <ErrorItem key={i} err={err} />
            ))}
          </ul>
        </div>
      )}

      {result && result.status === 'balanced' && (
        <div className="result">
          <h2>配平结果</h2>
          <div className="equation">
            {left.map((formula, i) => (
              <span key={`l${i}`} className="joined">
                {i > 0 && <span className="plus"> + </span>}
                <EquationTerm coefficient={result.coefficients.left[i]} formula={formula.trim()} />
              </span>
            ))}
            <span className="eq-arrow"> ⟶ </span>
            {right.map((formula, i) => (
              <span key={`r${i}`} className="joined">
                {i > 0 && <span className="plus"> + </span>}
                <EquationTerm coefficient={result.coefficients.right[i]} formula={formula.trim()} />
              </span>
            ))}
          </div>

          <h3>各元素原子总数</h3>
          <table className="atom-table">
            <thead>
              <tr>
                <th>元素</th>
                <th>左侧</th>
                <th>右侧</th>
                <th>是否守恒</th>
              </tr>
            </thead>
            <tbody>
              {result.elements.map((row) => (
                <tr key={row.symbol}>
                  <td className="el-symbol">{row.symbol}</td>
                  <td>{row.left}</td>
                  <td>{row.right}</td>
                  <td>{String(row.left) === String(row.right) ? '✓' : '✗'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <FeedAnalysis
            left={left}
            right={right}
            coefficients={result.coefficients.left}
            ranges={ranges}
            onRangeChange={handleRangeChange}
            onAnalyze={handleAnalyze}
            analyzing={analyzing}
            feedErrors={feedErrors}
            analysis={analysis}
          />
          {feedNetError && <div className="notice notice-error feed-net-error">{feedNetError}</div>}
        </div>
      )}

      {result && result.status === 'no-positive-solution' && (
        <div className="result notice notice-warn">
          <h2>无正解</h2>
          <p>
            该物质组合不存在一组<strong>全部严格为正整数</strong>的配平系数
            {result.reason === 'only-trivial'
              ? '：元素无法守恒，零空间只有零解。'
              : result.reason === 'zero-coefficient'
                ? '：唯一成比例的解中某些物质系数为 0。'
                : '：唯一成比例的解中系数存在异号，说明有物质应放到等式另一侧。'}
          </p>
          <p className="note">系统不会从无解或多解的情形中任意挑选系数；投料区间分析亦不开放。</p>
        </div>
      )}

      {result && result.status === 'not-unique' && (
        <div className="result notice notice-warn">
          <h2>解不唯一</h2>
          <p>
            该反应配平系数的<strong>零空间维数为 {result.nullity}</strong>，
            存在无穷多组（线性无关的）正整数系数，无法唯一配平。
          </p>
          <p className="note">
            请检查是否漏写/多写了物质，或该反应本身无法唯一确定。系统不会任意挑选一组解；投料区间分析仅对唯一正系数解开放。
          </p>
        </div>
      )}

      <footer>
        <small>
          系数为最大公约数等于 1 的最简正整数；配平与投料区间分析均采用 BigInt 有理数精确计算，结果为约分分数。
        </small>
      </footer>
    </div>
  );
}

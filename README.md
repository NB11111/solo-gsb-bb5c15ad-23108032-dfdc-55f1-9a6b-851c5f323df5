# 化学反应式配平网页

基于 **React + Node.js (Express)** 的化学反应式配平工具。用户在左右两侧分别输入反应物与生成物的化学式，服务端构建元素守恒矩阵，使用**精确有理数（BigInt 分数）消元**求解，仅在零空间为一维且全部系数严格为正时输出最大公约数为 1 的最简整数系数。

配平成功后还提供**投料区间分析**：给定每种反应物初始投料量（mol）的允许区间，在所有允许投料组合上用精确有理数联合求出生成量、剩余量与反应进度的可达最小/最大值，并标出每种反应物的限量情况。

## 一键启动

需要安装 Docker（含 Compose 插件）。在项目根目录执行：

```bash
docker compose up --build
```

该命令会自动完成前后端**依赖安装、前端构建与服务初始化**，无需任何手动 `npm install`。

启动后用浏览器访问：

> **http://localhost:3000** （页面与 API 均在 **3000** 端口）

- 页面地址：<http://localhost:3000/>
- 配平接口：`POST http://localhost:3000/api/balance`
- 投料区间分析接口：`POST http://localhost:3000/api/analyze`

停止服务：`Ctrl+C`；后台运行：`docker compose up --build -d`；停止并清除容器：`docker compose down`。

### 必要配置

- 默认端口 **3000**，无需任何环境变量。如需更改端口，可设置服务端环境变量 `PORT`，并在 `docker-compose.yml` 中同步修改端口映射（如 `"8080:8080"` + `PORT=8080`）。

## 功能

- **左右两侧分别输入物质**，可动态增删条目，回车快速添加
- **可编辑示例**：点击示例标签载入，载入后可任意修改再配平
- 化学式语法：
  - 元素符号**区分大小写**（`Na`、`Cl`、`CO` 与 `Co` 均按元素表校验）
  - 下标必须为**正整数**（`H2O`、`Ca3(PO4)2`，不允许 `0` 和前导零）
  - 圆括号**最多三层**嵌套（如 `H(He(Li)2)3`）
  - **不支持**电荷（`Fe^3+`）、水合点号（`CuSO4·5H2O`）和前置系数（`2H2O`）
- **语法错误精确定位**：指出左/右侧第几个物质、第几个字符，并用 `^` 标出出错位置
- **精确求解**：RREF（行最简形）高斯消元，全程 BigInt 分数运算，无浮点误差
  - 零空间一维且系数全为严格正数：输出 gcd = 1 的最简整数系数
  - 零空间大于一维：提示**解不唯一**，不任意挑选
  - 只有零解 / 系数异号 / 出现零系数：提示**无正解**
- 结果页展示**配平式**（数字自动下标、系数 1 省略）和**每种元素在两侧的原子总数**

### 投料区间分析（仅对唯一正系数解开放）

只有配平状态为唯一正整数解时，结果区才出现“投料区间分析”面板；解不唯一或无正解时不开放。

- 为**每种反应物**分别填写以 **mol** 为单位的**下限、上限**：非负十进制数、最多 **6 位小数**、下限 ≤ 上限，各物质的区间相互独立；**生成物初始量为 0**，反应按**完全反应**计算。
- 服务端复用同一套化学式解析与配平结果，令反应进度 **ξ = min(nᵢ/cᵢ)**，在所有允许投料组合构成的联合盒域上用**精确有理数**求：
  - 反应进度 ξ 的可达最小值、最大值；
  - 每种生成物的生成量 **cⱼ·ξ** 的可达最小值、最大值；
  - 每种反应物的剩余量 **nᵢ − cᵢ·ξ** 的可达最小值、最大值。
- 所有数值以**约分分数**展示（整数直接显示整数）。
- 每种反应物逐项标出限量情况（**并列最小也算限量**）：
  - **均限量**：在所有允许组合中都是（并列）最小比值的反应物；
  - **部分限量**：仅在部分组合中限量（含恰好并列的边界）；
  - **从不限量**：在任何允许组合中都不是最小者，必有剩余。
- 极值是对**整个联合投料域**求取的（例如剩余量上界在“自己取上限、其余反应物全部取下限”处达到），不会用各区间独立相减代替联合求界。
- 区间输入错误（空值、非数字、负数、超过 6 位小数、下限大于上限等）会**定位到具体物质**并在该行提示；多种物质的错误会同时标出。
- **修改反应式**（编辑化学式、增删物质、切换示例、重新配平）会**立即清除**已有的投料区间与分析结果。

## 本地开发（可选）

需要 Node.js 18+（内置 `fetch`）。

```bash
# 终端 1：后端（http://localhost:3000）
cd server && npm install && npm start

# 终端 2：前端开发服务器（http://localhost:5173，/api 自动代理到 3000）
cd client && npm install && npm run dev
```

- 页面地址（开发模式）：<http://localhost:5173/>
- API 地址：<http://localhost:3000/api/balance>、<http://localhost:3000/api/analyze>

后端单元测试与接口测试：

```bash
cd server && npm test
```

## 项目结构

```
├── Dockerfile            # 多阶段构建：前端构建 + 后端依赖 + 运行镜像
├── docker-compose.yml    # 单服务，映射 3000 端口
├── server/
│   ├── index.js          # Express 入口、/api/balance 与 /api/analyze、静态托管
│   ├── test/
│   │   ├── chem.test.js  # 解析与配平单元测试
│   │   ├── feed.test.js  # 投料区间分析单元测试（精确分数、限量分类）
│   │   └── api.test.js   # HTTP 接口测试
│   └── chem/
│       ├── fraction.js   # 精确有理数（BigInt）
│       ├── parse.js      # 化学式递归下降解析器（含错误定位）
│       ├── balance.js    # 元素守恒矩阵 + RREF 消元 + 零空间判定
│       └── feed.js       # 投料区间联合求界、限量分类、小数解析
└── client/               # React + Vite 前端
    └── src/
        ├── App.jsx       # 输入面板、示例、结果展示、投料区间分析
        └── styles.css
```

## API

### `POST /api/balance`

```json
{
  "left": ["H2", "O2"],
  "right": ["H2O"]
}
```

成功响应：

```json
{
  "ok": true,
  "result": {
    "status": "balanced",
    "coefficients": { "left": [2, 1], "right": [2] },
    "elements": [
      { "symbol": "H", "left": 4, "right": 4 },
      { "symbol": "O", "left": 2, "right": 2 }
    ]
  }
}
```

语法错误时 `ok` 为 `false`，`errors` 中每项含 `side`、`index`、`position`（1 基字符位置）、`message`、`formula`；无解时 `result.status` 为 `no-positive-solution`，解不唯一时为 `not-unique`（并给出 `nullity`）。

### `POST /api/analyze`

请求体在配平请求基础上增加 `ranges`（按左侧反应物顺序，每项为下限/上限字符串，单位 mol）：

```json
{
  "left": ["H2", "O2"],
  "right": ["H2O"],
  "ranges": [
    { "lower": "2", "upper": "4" },
    { "lower": "1", "upper": "2" }
  ]
}
```

成功响应（分数均已约分，`{ num, den, text }`）：

```json
{
  "ok": true,
  "analysis": {
    "coefficients": { "left": ["2", "1"], "right": ["2"] },
    "extent": {
      "min": { "num": "1", "den": "1", "text": "1" },
      "max": { "num": "2", "den": "1", "text": "2" }
    },
    "reactants": [
      {
        "index": 0,
        "coefficient": "2",
        "feed": {
          "lower": { "num": "2", "den": "1", "text": "2" },
          "upper": { "num": "4", "den": "1", "text": "4" }
        },
        "limiting": "sometimes",
        "remaining": {
          "min": { "num": "0", "den": "1", "text": "0" },
          "max": { "num": "2", "den": "1", "text": "2" }
        }
      }
    ],
    "products": [
      {
        "index": 0,
        "coefficient": "2",
        "amount": {
          "min": { "num": "2", "den": "1", "text": "2" },
          "max": { "num": "4", "den": "1", "text": "4" }
        }
      }
    ]
  }
}
```

`limiting` 取值为 `always`（均限量）、`sometimes`（部分限量）、`never`（从不限量）。

区间填写错误时：

```json
{ "ok": false, "feedErrors": [{ "index": 0, "message": "下限不能大于上限" }] }
```

`index` 为出错的反应物下标（0 基）；反应式本身存在语法错误时返回 `errors`（结构同 `/api/balance`），解不唯一/无正解时同样以 `errors` 说明分析不开放。

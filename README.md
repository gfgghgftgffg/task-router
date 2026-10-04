# Task Router

用一个 `routing.toml` 为 Codex 原生子 Agent 或 Pi 的 `pi-subagents` 配置不同的模型和思考强度（effort / thinking），由主 Agent 按任务选择。

coding 完成实现后，由 verify 独立验收。安装器为每个后端生成独立的 profile、角色配置和按需加载的 Skill：Codex 复用原生子 Agent 与 worktree，Pi 通过 `pi-subagents` 执行 Router 自己的 `tr_*` 角色，不覆盖 Pi 内置角色。

[Codex 快速开始](#codex-快速开始) · [配置角色](#配置角色) · [配置参考](docs/configuration.md) · [Pi / pi-subagents 适配](docs/pi.md)

## Pi / pi-subagents

同一份角色契约和模型候选也可安装到 Pi，由 `pi-subagents` 执行 Router 自己的 `tr_*` 角色，不复用或覆盖 Pi 内置角色：

```sh
pi install npm:pi-subagents
pi install npm:pi-web-access
node cli.mjs install --host pi          # 预览
node cli.mjs install --host pi --apply  # 应用
```

在工作项目中启动 Pi 或执行 `/reload`，再显式调用 `/skill:task-routing 你的任务`。安装不自动激活，不改主模型、`settings.json` 或认证。思考支持、工具边界、自定义目录和并发差异见 [Pi 配置说明](docs/pi.md)。独立构建使用 `node cli.mjs build --host pi`，默认输出 `dist/pi/`。

原有命令默认仍使用 Codex 后端；以下快速开始针对 Codex。

## Codex 快速开始

需要 Node.js 22+、支持命名 subagent 角色和独立 profile 的 Codex，以及已配置好的模型 provider。

### 1. 准备仓库

克隆或下载本仓库后，在仓库目录执行：

```sh
npm ci
```

### 2. 设置 V1 子 Agent 通讯

将以下配置合并到 `~/.codex/config.toml` 已有的 `[features]` 表中，保留其他配置：

```toml
[features]
multi_agent = true
multi_agent_v2 = false
```

如果通过 `model_catalog_json` 使用自定义模型目录，主 Agent 和所有可能选用的子模型也必须设置 `"multi_agent_version": "v1"`。仅设置全局 `multi_agent_v2 = false` 不足以覆盖模型条目中显式的 `"multi_agent_version": "v2"`，详见[模型目录与 V1 兼容](docs/configuration.md#模型目录与-v1-兼容)。安装器不会代改这些设置。

### 3. 选择模型并预览安装

编辑本仓库的 [`routing.toml`](routing.toml)，把 `orchestrator` 和各个 `roles.*` 的模型、effort 改成自己的 provider 可用的值。已有模型名称是配置示例。

在仓库目录预览将写入的文件：

```sh
node cli.mjs install
```

`install` 默认只预览。确认变更后应用安装：

```sh
node cli.mjs install --apply
```

默认安装到 `CODEX_HOME`，未设置时使用 `~/.codex`。自定义目录和安装保护见[配置参考](docs/configuration.md#安装路径与文件保护)。

### 4. 在工作项目启动

进入要工作的项目目录，启动新的 Codex 会话：

```sh
codex -p task-routing
```

该命令加载路由 profile。安装或更新之后都需要新会话，已有会话不会自动刷新配置。

## 配置角色

[`routing.toml`](routing.toml) 中的 `orchestrator` 设置主 Agent 的模型和 effort。五个子角色分别承担以下工作：

| 角色 | 职责 |
| --- | --- |
| `coding` | 有明确边界的编码、测试代码和重构 |
| `search` | 只读检索、代码探索和资料核实 |
| `verify` | 独立验收和运行检查，不修改业务代码或测试源码 |
| `reasoning` | 复杂判断和独立高风险审查 |
| `general` | 非编码分析、总结、写作和结构化产出 |

每个 `[roles.X]` 的 `model` 和 `effort` 构成默认候选。需要多个档位时，在 `options` 内联数组中添加候选，每行一项：

```toml
[roles.coding]
model = "deepseek-flash"
effort = "max"
options = [
  { model = "deepseek-flash", effort = "high", when = "低风险机械修改" },
  { model = "gpt-6.1-sol", effort = "high", when = "复杂、高风险或跨模块修改" }
]
```

`id` 可以省略，生成器会根据 `model`、`effort` 和显式 `provider` 生成稳定 ID；重排候选或修改 `when` 不会改变它。显式命名和候选文件规则见[候选配置](docs/configuration.md#候选配置)。

`when` 是给主 Agent 的选择提示。主 Agent 结合任务情况判断选型，生成器不会按硬编码关键词分类任务。同一角色的所有候选共享职责契约和 sandbox。

主模型、角色默认候选和可选候选都可设置 `provider = "已配置的-provider-id"`。`orchestrator` 省略 provider 时沿用现有 Codex 配置；子角色默认候选和 `options` 省略时继承主会话 provider，不继承同角色默认候选的显式 provider。认证和服务地址继续使用已有 Codex 配置。

具体任务如何选档，可读 `routing.toml` 中各候选的 `when` 和 [Skill](skill/SKILL.md)。并行协作方式见[并行工作参考](skill/references/parallel-work.md)。

上述角色与候选在两后端共用。Pi 的 `effort` 到 thinking 映射、provider 写法和派发差异见 [Pi 适配](docs/pi.md#角色与模型派发)。

## 日常使用与更新

在路由会话中直接描述任务即可，主 Agent 按需要分工。

临时要求某个模型或强度，例如“这次用 Sol 高强度验证”，只影响指定的任务或角色，不改写 `routing.toml`。存在匹配候选时优先使用该命名角色；其他覆盖取决于宿主能力，详见[配置优先与临时覆盖](docs/configuration.md#配置优先与临时覆盖)。

需要持久调整时，修改本仓库 `routing.toml`，在仓库目录执行 `node cli.mjs install --apply`，再进入工作项目目录用 `codex -p task-routing` 启动新会话。

`install --apply` 已包含模型目录检查，并同步 profile、角色和 Skill，无需每次单独构建。只更新模型目录不会改变路由分配，还需修改 `routing.toml` 并重新安装。

自定义源配置与安装目录的更新方式见 [CLI 参数](docs/configuration.md#cli-参数)；基础指令变更见[基础指令快照](docs/configuration.md#基础指令快照)，生成文件的修改限制见[安装路径与文件保护](docs/configuration.md#安装路径与文件保护)。

普通 `codex` 启动不会加载该 profile。也可在会话中显式调用 `$task-routing` 使用 Skill 政策；它的生效边界，以及停用和手动移除方式，见[配置参考](docs/configuration.md#停用与手动移除)。

## 命令参考与开发入口

以下命令在仓库目录执行：

| 命令 | 用途 |
| --- | --- |
| `node cli.mjs install` | 预览安装或更新 |
| `node cli.mjs install --apply` | 应用安装或更新 |
| `node cli.mjs doctor` | 单独检查配置与模型目录 |
| `node cli.mjs build` | 生成独立 bundle，默认输出到 `dist/` |

以上命令默认 `--host codex`；Pi 后端加 `--host pi` 并使用 `--pi-home`，见 [Pi 配置说明](docs/pi.md)。`doctor` 静态校验主模型和所有候选的模型 ID、effort 与 provider，具体边界见[检查范围](docs/configuration.md#检查范围)，参数选项见 [CLI 参数](docs/configuration.md#cli-参数)。

开发检查与构建：

```sh
npm test
npm run build
```

职责契约在 [`roles/`](roles/)，编排入口及参考材料在 [`skill/`](skill/)，Codex 配置生成和共享安装逻辑在 [`src/router.mjs`](src/router.mjs)，Pi 后端在 [`src/pi.mjs`](src/pi.mjs)。

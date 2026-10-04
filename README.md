# Task Router

Task Router 用一个 `routing.toml` 定义一个 orchestrator 和五个职责角色——`coding`、`search`、`verify`、`reasoning`、`general`——为每个角色配置默认模型和思考强度（Codex 的 effort / Pi 的 thinking），并可为同一角色追加多个候选档位。主 Agent 结合任务复杂度、风险和上下文规模选择档位；coding 完成后由独立的 verify 验收。

同一份角色契约和候选配置支持两种宿主，安装器为每个后端分别生成自己的受管文件，互不影响：

| 宿主 | 执行方式 | 安装产物 |
| --- | --- | --- |
| Codex | 原生子 Agent（V1 通讯），并行任务复用 worktree | 独立 profile、TOML 角色、按需加载的 Skill |
| [pi-subagents](https://github.com/nicobailon/pi-subagents) | Router 自己的 `tr_*` 角色，经 pi-subagents 派发，不覆盖 Pi 内置角色 | Markdown 角色、按需加载的 Skill |

安装器只写自己管理的文件：默认先预览，`--apply` 才写入，写入前做备份和并发校验。不改写 Codex 的 `config.toml`、Pi 的 `settings.json`，也不碰认证和 provider 配置。

## 快速开始

两种宿主都需要 Node.js 22+ 和一份本仓库副本。所有命令都在仓库目录执行：

```sh
git clone git@github.com:gfgghgftgffg/task-router.git
cd task-router
npm ci
```

然后按使用的宿主选择下面的步骤。

### Codex

1. 开启 V1 子 Agent 通讯。把以下内容合并进 `~/.codex/config.toml` 已有的 `[features]` 表，保留其他配置：

   ```toml
   [features]
   multi_agent = true
   multi_agent_v2 = false
   ```

   如果通过 `model_catalog_json` 使用自定义模型目录，主 Agent 和所有可能选用的子模型也必须设置 `"multi_agent_version": "v1"`。仅设置全局 `multi_agent_v2 = false` 不足以覆盖模型条目里显式的 `"multi_agent_version": "v2"`，详见[模型目录与 V1 兼容](docs/configuration.md#模型目录与-v1-兼容)。安装器不会代改这些设置。

2. 编辑 [`routing.toml`](routing.toml)，把 `orchestrator` 和各 `roles.*` 的 `model`、`effort` 换成自己 provider 可用的值。仓库里的模型名只是示例。

3. 预览并安装：

   ```sh
   node cli.mjs install          # 预览
   node cli.mjs install --apply  # 应用
   ```

   默认安装到 `CODEX_HOME`，未设置时使用 `~/.codex`。自定义目录和安装保护见[安装路径与文件保护](docs/configuration.md#安装路径与文件保护)。

4. 进入要工作的项目目录，启动新会话：

   ```sh
   codex -p task-routing
   ```

   普通 `codex` 不会加载该 profile。安装或更新之后都需要新会话，已有会话不会自动刷新。

### Pi

1. 安装执行与联网检索依赖（本仓库不代装）：

   ```sh
   pi install npm:pi-subagents
   pi install npm:pi-web-access
   ```

2. 编辑同一个 [`routing.toml`](routing.toml)。Pi 的 provider 写法、`effort` 到 thinking 的映射和派发规则见 [Pi 适配](docs/pi.md#角色与模型派发)。

3. 预览并安装：

   ```sh
   node cli.mjs install --host pi          # 预览
   node cli.mjs install --host pi --apply  # 应用
   ```

   默认安装到 `PI_CODING_AGENT_DIR`，未设置时使用 `~/.pi/agent`。用 `--pi-home` 指定其他目录时，启动 Pi 的 `PI_CODING_AGENT_DIR` 也应指向同一位置。

4. 在工作项目中启动 Pi 或执行 `/reload`，然后显式启用路由：

   ```text
   /skill:task-routing 你的任务
   ```

   安装本身不激活路由，也不改主模型、`settings.json` 或认证。独立构建用 `node cli.mjs build --host pi`，默认输出 `dist/pi/`。

### 更新 routing.toml 后重新安装

`routing.toml` 是唯一事实来源。改完必须重新安装，宿主才会看到新的角色和档位：

```sh
node cli.mjs install --apply             # Codex
node cli.mjs install --host pi --apply   # Pi
```

重新安装是幂等的：只更新受管文件，删除候选时按记录的哈希清理对应文件，人工改过的文件会被拒绝而不是被覆盖。已有会话不会自动刷新——Codex 需要 `codex -p task-routing` 启动新会话，Pi 需要新会话或 `/reload`。只更新模型目录不会改变路由分配，仍要修改 `routing.toml` 并重新安装。

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

`when` 是给主 Agent 的选择提示。主 Agent 结合任务情况判断选型，生成器不会按硬编码关键词分类任务。同一角色的所有候选共享职责契约。

主模型、角色默认候选和可选候选都可设置 `provider = "已配置的-provider-id"`。Codex 的 `orchestrator` 省略 provider 时沿用现有配置，子角色省略时继承主会话 provider，不继承同角色默认候选的显式 provider；认证和服务地址继续使用已有 Codex 配置。Pi 的 provider 写法和继承规则见 [Pi 适配](docs/pi.md#角色与模型派发)。

具体任务如何选档，可读 `routing.toml` 中各候选的 `when` 和 [Skill](skill/SKILL.md)。并行协作方式见[并行工作参考](skill/references/parallel-work.md)。

## 日常使用与更新

在路由会话中直接描述任务即可，主 Agent 按需要分工。

临时要求某个模型或强度，例如“这次用 Sol 高强度验证”，只影响指定的任务或角色，不改写 `routing.toml`。存在匹配候选时优先使用该命名角色；其他覆盖取决于宿主能力，详见[配置优先与临时覆盖](docs/configuration.md#配置优先与临时覆盖)。

需要持久调整时，修改本仓库 `routing.toml`，按上面的「更新 routing.toml 后重新安装」重装对应宿主，再启动新会话或 `/reload`。

`install --apply` 已包含模型目录检查，并同步 profile、角色和 Skill，无需每次单独构建。

自定义源配置与安装目录的更新方式见 [CLI 参数](docs/configuration.md#cli-参数)；基础指令变更见[基础指令快照](docs/configuration.md#基础指令快照)，生成文件的修改限制见[安装路径与文件保护](docs/configuration.md#安装路径与文件保护)。

Codex 方面，普通 `codex` 启动不会加载该 profile，也可在会话中显式调用 `$task-routing` 使用 Skill 政策；它的生效边界，以及停用和手动移除方式，见[配置参考](docs/configuration.md#停用与手动移除)。Pi 方面，安装后由 `/skill:task-routing` 显式启用，未启用时保持原有工作方式。

## 命令参考与开发入口

以下命令在仓库目录执行，默认 `--host codex`；Pi 后端加 `--host pi`（配合 `--pi-home`）：

| 命令 | 用途 |
| --- | --- |
| `node cli.mjs install` | 预览安装或更新 |
| `node cli.mjs install --apply` | 应用安装或更新 |
| `node cli.mjs doctor` | 单独检查配置与模型目录 |
| `node cli.mjs build` | 生成独立 bundle，Codex 默认输出 `dist/`，Pi 默认输出 `dist/pi/` |

`doctor` 静态校验主模型和所有候选的模型 ID、effort 与 provider，具体边界见[检查范围](docs/configuration.md#检查范围)，参数选项见 [CLI 参数](docs/configuration.md#cli-参数)。Pi 后端的检查范围见 [Pi 检查](docs/pi.md#检查)。

开发检查与构建：

```sh
npm test
npm run build
```

职责契约在 [`roles/`](roles/)，Codex 编排入口及参考材料在 [`skill/`](skill/)，共享配置生成与安装逻辑在 [`src/router.mjs`](src/router.mjs)，Pi 后端在 [`src/pi.mjs`](src/pi.mjs)，Pi 编排入口在 [`skill/pi/`](skill/pi/)。

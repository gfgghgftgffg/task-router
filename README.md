# Task Router

Task Router 用一份 [`routing.toml`](routing.toml) 配置主 Agent、五个职责角色及其模型候选，支持 Codex 和 Pi。主 Agent 根据任务复杂度、风险和上下文选择模型与思考强度；编码结果交给独立的 `verify` 验收。

| 宿主 | 执行方式 | 生成内容 |
| --- | --- | --- |
| Codex | 原生 V1 子 Agent | 独立 profile、TOML 角色和 Skill |
| Pi | [amox_pi_extensions_lean](https://github.com/gfgghgftgffg/amox_pi_extensions_lean) 的 `@gfgghgftgffg/pi-subagents-lean` | 扁平 `tr_*` Markdown 角色和按需启用的 Skill |

安装默认只预览，带 `--apply` 才写入。安装器备份将要修改或删除的文件，并检查文件是否被手动改动；不改写 Codex 的 `config.toml`、Pi 的 `settings.json`，也不修改认证或 provider 配置。

## 快速开始

Router CLI 需要 Node.js 22+。Pi 扩展另需 Pi >=1.1.0、Node >=22.19.0、npm 和 Git。先取得仓库并安装依赖，后续命令均在 `task-router` 目录执行：

```sh
git clone git@github.com:gfgghgftgffg/task-router.git
cd task-router
npm ci
```

编辑 [`routing.toml`](routing.toml)，把 `orchestrator` 和各 `roles.*` 的 `model`、`effort` 换成自己 provider 支持的值。仓库中的模型名只是示例，不代表你的环境可用。

### Codex

1. 将以下开关合并到 `~/.codex/config.toml` 已有的 `[features]` 表，保留其他配置：

   ```toml
   [features]
   multi_agent = true
   multi_agent_v2 = false
   ```

   使用 `model_catalog_json` 时，主模型和所有可能选用的子模型还须设置 `"multi_agent_version": "v1"`。模型条目显式设为 `v2` 时，仅关闭全局 `multi_agent_v2` 不够，见[模型目录与 V1 兼容](docs/configuration.md#模型目录与-v1-兼容)。安装器不会代改这些设置。

2. 预览并安装：

   ```sh
   node cli.mjs install          # 预览
   node cli.mjs install --apply  # 应用
   ```

   默认目标为 `CODEX_HOME`，未设置时使用 `~/.codex`。

3. 进入要工作的项目目录，启动新会话：

   ```sh
   codex -p task-routing
   ```

   普通 `codex` 不加载该 profile。安装或更新后都需要新会话。

### Pi

1. 单独安装执行和联网检索扩展。扩展仓库不发布 npm 包，不能把 workspace 根目录当作单个 Pi 扩展安装。首次使用时，在 Task Router 目录执行：

   ```sh
   git clone https://github.com/gfgghgftgffg/amox_pi_extensions_lean.git ../amox_pi_extensions_lean
   node ../amox_pi_extensions_lean/scripts/install-extension.mjs pi-subagents-lean
   node ../amox_pi_extensions_lean/scripts/install-extension.mjs pi-web-access-lean
   ```

   已有副本先更新，无需重复 clone，也无需在扩展仓库根目录运行 `npm ci`。Router 不要求 `rpiv-todo-lean`。

   用 `pi list` 核对来源，避免同时加载多个 subagents/web-access 门面。旧来源的移除命令、推荐的 `subagents.json` 设置和角色发现规则见 [Pi 安装](docs/pi.md#安装)。替换扩展后执行 `/reload` 或重启 Pi。

2. 安装 Router 角色和 Skill：

   ```sh
   node cli.mjs install --host pi          # 预览
   node cli.mjs install --host pi --apply  # 应用
   ```

   默认目标为 `PI_CODING_AGENT_DIR`，未设置时使用 `~/.pi/agent`。指定 `--pi-home` 后，启动 Pi 的 `PI_CODING_AGENT_DIR` 也须指向该目录。

3. 在工作项目中启动 Pi 或执行 `/reload`，确认 `/agents` 可见 `tr_*`，再显式启用：

   ```text
   /skill:task-routing 你的任务
   ```

   安装不自动启用路由，也不切换主模型。每次新派发都要从生成的角色映射中显式传入 model 和 thinking；只按角色名启动会继承父模型。详见 [Pi 角色与模型派发](docs/pi.md#角色与模型派发)。

> [!NOTE]
> Pi 集成的审查基线是扩展仓库 `v0.1.2`、subagents 引擎 `0.22.0`，安装脚本不会自动固定到此版本。实际加载的包、工具接口和权限范围仍须核对，见 [Pi 适配](docs/pi.md)。

## 共享行为规则

仓库根目录的 [`AGENTS.md`](AGENTS.md) 是所有 Router 任务共用的规则文件。Codex 和 Pi 的入口 Skill、各角色与模型候选都引用它的绝对路径，并在开始工作前读取；不复制父线程完整上下文，也不把规则正文固化进生成产物。

修改这份文件即可供后续任务读取，无需重新安装。它独立于宿主全局 `AGENTS.md`；角色权限、项目约束和用户授权仍然有效。移动仓库后需重新安装，更新生成的路径。Pi 的所有角色启用 Skill 按需发现，并可通过 codemode 批量调用原有白名单内的工具，不增加其他工具权限或再次委派能力。显式调用型 Skill 仍不自动选用。

Pi 安装器不修改宿主全局 `AGENTS.md`，路由仍通过 `/skill:task-routing` 显式启用。

## 配置角色

`orchestrator` 设置 Codex 主模型及 effort；在 Pi 中，它是推荐的启动选择，Skill 不会切换父模型。五个子角色的职责如下：

| 角色 | 职责 |
| --- | --- |
| `coding` | 有明确边界的编码、测试代码和重构 |
| `search` | 只读检索、代码探索和资料核实 |
| `verify` | 独立验收和运行检查，不修改业务代码或测试源码 |
| `reasoning` | 复杂判断和独立高风险审查 |
| `general` | 非编码分析、总结、写作和结构化产出 |

每个 `[roles.X]` 的 `model` 和 `effort` 是默认候选，可在 `options` 中追加其他档位：

```toml
[roles.coding]
model = "deepseek-flash"
effort = "max"
options = [
  { model = "deepseek-flash", effort = "high", when = "低风险机械修改" },
  { model = "gpt-6.1-sol", effort = "high", when = "复杂、高风险或跨模块修改" }
]
```

`when` 是主 Agent 选型时的提示，生成器不按关键词分类任务。同一角色的所有候选共享职责契约。省略 `id` 时，生成器根据 model、effort 和显式 provider 生成稳定 ID；重排候选或修改 `when` 不会改变 ID。

主模型、默认候选和 `options` 均可设置 `provider`。子候选省略时继承实际主会话 provider，不继承同角色其他候选的 provider。Codex 的认证和服务地址仍由原有配置提供；Pi 的模型 ID 与 provider 分开填写。

完整字段、候选命名和 Codex provider 规则见[配置参考](docs/configuration.md#候选配置)；Pi 的 thinking、继承及覆盖规则见 [Pi 适配](docs/pi.md#角色与模型派发)。

## 编排方式

模型档位与编排方式分别选择。主 Agent 先检查实际可用的操作，再按当前阶段的依赖、分支、输入输出和停止条件组织工作。

| 可用能力 | 做法 |
| --- | --- |
| subagents 和 workflow 都有 | 需要根据发现调整方向、少量明确分工时直接调度；批处理、流水线或复用有实际收益时使用 workflow，可分阶段混用 |
| 只有 subagents | 主线程协调并行、依赖、批次和跟进 |
| 只有 workflow | 使用短而有边界的阶段，先返回证据，再决定下一阶段 |
| 两者都没有 | 主线程处理允许自行完成的部分，报告缺失的委派或独立验收能力 |

多个 Agent、多步骤或独立验收都不自动要求 workflow。用户指定的方式不可用时，要报告限制；模型、权限或运行故障不能用静默切换方式绕过。

Agent 间的证据由主线程中转，不自动同步上下文。各模式都要保留独立验收、文件所有权、合计并发上限和同一工作单元的修复次数。并行写入需隔离工作目录，不能让多个 writer 同时修改共享目录。

决策规则和例子见[阶段级编排](skill/references/orchestration.md)；执行细节分别见 [Codex 并行工作规则](skill/references/parallel-work.md)和 [Pi execution](skill/pi/execution.md)。这些是 Skill 政策，实际调用仍须遵循宿主工具的接口。

## 日常使用与更新

路由启用后，直接描述任务即可。临时指定某个模型或强度，只影响指定任务或角色，不改写 `routing.toml`；有匹配候选时优先使用，否则检查宿主是否支持按次覆盖，不能静默换模型。

### 更新 routing.toml 后重新安装

持久调整应修改源配置，再重装对应宿主：

```sh
node cli.mjs install --apply             # Codex
node cli.mjs install --host pi --apply   # Pi
```

Codex 随后用 `codex -p task-routing` 启动新会话；Pi 执行 `/reload` 或启动新会话。只更新模型目录不会改变路由分配。

`install --apply` 已包含目录检查和产物生成，无需先单独 build。重复安装在内容不变时为空计划；删除候选会按 manifest 哈希清理旧文件，手动改过的文件会阻止更新。

使用自定义 `--config` 或安装目标时，更新应继续指定同一配置和目录。重命名本仓库文件夹不会改变安装目标或 profile 名称，但需重新安装以更新共享 `AGENTS.md` 的绝对路径；已有脚本若引用旧仓库绝对路径，也需同步修改。

停用、手动移除和基础指令快照见[配置参考](docs/configuration.md)；Pi 的受管文件、旧布局迁移和更新边界见 [Pi 文档](docs/pi.md#托管文件与更新)。

## 命令参考与开发入口

以下命令默认 `--host codex`，Pi 后端加 `--host pi`：

| 命令 | 用途 |
| --- | --- |
| `node cli.mjs install` | 预览安装或更新 |
| `node cli.mjs install --apply` | 应用安装或更新 |
| `node cli.mjs doctor` | 检查配置与模型目录 |
| `node cli.mjs build` | 生成独立 bundle；Codex 默认 `dist/`，Pi 默认 `dist/pi/` |

`doctor` 不调用模型。静态检查通过不代表服务可达、扩展已加载或子 Agent 派发成功。参数见 [CLI 参数](docs/configuration.md#cli-参数)，检查边界见 [Codex](docs/configuration.md#检查范围)和 [Pi](docs/pi.md#检查)。

```sh
npm test
npm run build
```

| 目录或文件 | 内容 |
| --- | --- |
| [`AGENTS.md`](AGENTS.md) | 所有 Router 任务按需读取的共享行为规则 |
| [`roles/`](roles/) | 两种宿主共用的职责契约 |
| [`skill/`](skill/) | Codex Skill 与编排参考 |
| [`skill/pi/`](skill/pi/) | Pi Skill 与执行参考 |
| [`src/router.mjs`](src/router.mjs) | 共享配置、Codex 生成和文件安装逻辑 |
| [`src/pi.mjs`](src/pi.mjs) | Pi 生成与静态检查 |
| [`test/`](test/) | 离线回归测试 |

# 配置参考

[返回 README](../README.md)

本页针对 Codex 后端。命令默认 `--host codex`，保持原有行为；Pi 安装、thinking 映射和 pi-subagents-lean 派发规则见 [Pi 适配](pi.md)。

## 模型目录与 V1 兼容

本项目使用 V1 子 Agent 通讯。先将 README 中的功能开关合并到基础 `config.toml`，再检查自定义模型目录。

使用 `model_catalog_json` 时，主 Agent 和所有可能选用的子模型条目都必须设置 `"multi_agent_version": "v1"`。下面只展示单个条目的相关字段，编辑时保留其余字段：

```json
{
  "slug": "gpt-6-astra",
  "multi_agent_version": "v1"
}
```

在 Codex CLI 0.159 中，仅设置 `multi_agent_v2 = false` 不足以覆盖模型目录中显式的 `"multi_agent_version": "v2"`。修改功能开关或模型目录后，需要启动新会话。安装器不会自动改写这些设置，`doctor` 也不会检查通讯版本。

现有原生配置曾在 Codex CLI 0.156.1 上做过解析验证，字段参考 [Codex 0.156.1 schema](https://github.com/openai/codex/blob/rust-v0.156.1/codex-rs/core/config.schema.json)。上述 V1 开关行为和下文的指令替换语义对应 CLI 0.159；其他版本、provider 与宿主需要分别确认兼容性。桌面应用没有 profile 入口时，安装不会使其自动启用。

## 配置优先与临时覆盖

`orchestrator` 设置主会话的模型和 effort。每个子角色的默认候选与 `options` 候选都有固定的模型、effort 和可选 provider，主 Agent 从已配置候选中选择。

用户明确指定的模型或强度，优先于其指定任务或角色范围内的默认值，不改变其他角色或持久配置。只更换主模型，不会自动改变所有子模型。

请求与已有候选匹配时，优先使用对应命名角色。没有匹配候选时，临时覆盖依赖宿主是否支持按次派发指定模型和 effort，并保留所需 provider、职责和权限。无法满足时应报告限制，不能静默替换模型。生成器产出政策和原生配置，实际派发由 Codex 宿主执行。

provider 可在 `orchestrator`、角色默认候选或单个 `options` 项上设置；候选上的 provider 只作用于该候选。`orchestrator` 省略 provider 时沿用现有 Codex 配置；子角色默认候选和 `options` 省略时继承主会话 provider，不继承同角色默认候选的显式 provider。凭据和服务地址保留在原有 Codex 配置中。

角色 sandbox 为：search/reasoning 使用 `read-only`，coding/verify/general 使用 `workspace-write`。verify 不修改源码的边界由职责契约约束，`workspace-write` 本身并不限制它只能写检查产物。安装不会改变全局默认权限或授予额外外部操作权限。

## 候选配置

各角色都必须提供 `model` 和 `effort`，`when` 可选。`options` 支持 README 中的一行一候选内联数组，也支持 `[[roles.X.options]]` 写法；每个同名表头追加一个候选。模型与 effort 的可用值由 provider 和模型目录决定。

省略 `options[*].id` 时，生成器根据 `model`、`effort` 和显式 `provider` 生成 `auto_<16位小写十六进制>`；未设置 provider 时使用固定占位值。重排候选、修改 `when` 或换机器不会改变 ID，修改模型、effort 或 provider 会改变 ID。

显式 ID 必须以小写字母开头，只含小写字母、数字、`_`、`-`，长度不超过 32 字符，不能是 `default`。同一角色内 ID 不可重复，显式与自动 ID 碰撞会报错；重复的无 ID 模型/effort/provider 组合也会报错，可为其中一个设置显式 ID 区分。

默认候选生成 `tr_<role>` 和 `agents/task-routing/<role>.toml`；可选候选生成 `tr_<role>_<id>` 和 `agents/task-routing/<role>_<id>.toml`。没有 `options` 时只生成各角色的默认文件。五个逻辑角色由生成器定义，增加逻辑角色需扩展生成器和职责契约。

| 顶层配置 | 含义 |
| --- | --- |
| `version` | 当前必须为 `1` |
| `profile` | profile 名称，当前示例为 `task-routing`；以小写字母开头，只含小写字母、数字、`-`，最长 48 字符 |
| `max_concurrent` | 全会话并发子 Agent 上限，范围 `1..32`，当前配置为 `30` |
| `max_coding_repairs` | 每个工作单元首次实现之后的编码修复跟进上限，范围 `0..5`，当前配置为 `5` |

并发上限不要求每次创建相应数量的子 Agent。修复次数耗尽后交回主 Agent 判断。完整选择提示见 [`routing.toml`](../routing.toml)，职责和工作流程见 [Skill](../skill/SKILL.md)。

## 阶段级编排

编排形态与模型选档分开，先检查实际可用能力，不按宿主、插件名字、Agent 数量或步骤数量一刀切：两种能力都有时按阶段的决策结构选；只有 subagents 时由主线程协调并行、依赖和批次；只有 workflow 时用较短阶段返回证据、再决定后继任务；两者都没有时，只在主线程处理允许自行完成的部分并报告缺失的委派/验收能力。

能力在派发前检查，不是先调用不存在的工具失败后再回退。用户明确要求不可用的执行方式时仍须报告限制。具体调用遵守实际 schema；本后端的执行参考描述原生 spawn、跟进和生命周期工具，不要求其他集成也使用同一 API。“Subagent workflows”这样的文档名称也不能证明脚本执行器存在。所有形态都保持角色、精确模型、权限、独立验收和同一工作单元的修复上限。详见[阶段级编排](../skill/references/orchestration.md)和[并行工作规则](../skill/references/parallel-work.md)。

## Agent 续聊与上下文

相关任务优先在原 Agent 中续聊；正常提交、修复或可核对的增量基线变化无需重开。旧上下文无关、难以局部更新或噪声过大时再新建。独立任务仍可并行。实现与验收保持独立上下文；同一补丁的复验可继续原 verifier，沿用原验收标准和配置的修复上限。

独立新任务使用 fresh 上下文并给足必要说明；父会话大部分历史相关，且宿主能保留所选角色、模型、provider 和权限时，才按需 fork。当前 `fork_context=true` 只复制父会话快照，不共享兄弟 Agent 的完整上下文，也不持续同步。已关闭 Agent 仅在宿主支持且能恢复原上下文时续聊，恢复失败则说明并新建；不保证跨父会话或重启恢复，也不能靠 prompt 或 resume 强行更换候选设置。

共享资料优先使用现有 README、模块文档和源码索引，缺少导航时才补充注明版本和适用范围的短索引；事实过期时回查原文。会话复用不保证缓存命中或节省 token。详见 [并行工作规则](../skill/references/parallel-work.md) 与 [编码验收契约](../skill/references/coding-quality.md)。

## CLI 参数

| 参数 | 适用命令 | 行为 |
| --- | --- | --- |
| `--config <文件路径>` | `build`、`doctor`、`install` | 指定源配置，默认使用本仓库的 `routing.toml` |
| `--codex-home <目录>` | `doctor`、`install` | 指定检查或安装目标，默认使用 `CODEX_HOME`，未设置时使用 `~/.codex` |
| `--catalog <文件路径>` | `doctor`、`install` | 指定本次校验使用的模型目录，不改写 Codex 的目录配置 |
| `--out <目录>` | `build` | 指定独立 bundle 输出目录，默认是本仓库的 `dist/` |
| `--apply` | `install` | 应用变更，未指定时只预览 |
| `--help`、`-h` | CLI | 显示命令帮助 |

`--out` 只能用于 `build`，`--apply` 只能用于 `install`。

默认不会读取 `~/.codex/routing.toml`。使用多份仓库或自定义配置时，更新应继续指定同一份 `--config`；使用自定义安装目录时，也要保留相同的 `--codex-home` 或 `CODEX_HOME`。

目录校验优先使用 `--catalog`，其相对路径按执行命令时的工作目录解析；否则读取目标 `config.toml` 的 `model_catalog_json`，其中的相对路径按目标 Codex home 解析。JSON 必须含 `models` 数组，模型以 `slug` 匹配，effort 根据 `supported_reasoning_levels` 检查。更换校验目录不会自动改变运行时目录。

## 安装路径与文件保护

以下路径相对于安装目标；profile 路径以当前 `task-routing` 名称为例。

| 路径 | 安装行为 |
| --- | --- |
| `task-routing.config.toml` | 新增或更新独立 profile |
| `agents/task-routing/*.toml` | 新增或更新默认角色和命名候选 |
| `skills/task-routing/` | 新增或更新 Skill、职责契约和参考文件 |
| `AGENTS.md` | 创建文件，或追加、更新带标记的路由区块 |
| `.task-router/manifest.json` | 记录托管文件及其 hash，用于后续更新检查 |
| `.task-router/backups/` | 修改或删除已有文件前保存备份 |

已有 `config.toml`、认证、其他 Skills、其他角色文件和 `AGENTS.md` 标记之外的内容不会被改写。基础配置只用于读取指令快照和校验配置。长期自定义的 AGENTS 规则应放在 `task-router:start/end` 区块外，区块内会随生成器更新。早期版本写入的 `codex-task-router:start/end` 区块会在下次安装时就地替换为新标记，不会留下重复区块。

profile 和角色配置按整个文件管理，不合并其中手工添加的 `[tui]` 等设置。已有文件与生成内容不同时，只有其 hash 仍匹配安装记录才允许更新；未托管或手改文件会触发拒绝覆盖。即使额外设置已被纳入安装记录，重新生成仍可能移除它们。遇到冲突先核对差异并备份需要保留的内容；删除 manifest 会丢失保护所需记录。直接恢复额外设置后，下一次更新仍可能发生冲突。

从 `options` 删除候选，或修改模型/effort/provider 导致自动 ID 改变后，下次安装预览会将旧候选路径显示为 `DELETE`。只删除安装记录中的已知角色候选路径，且文件 hash 必须未变；手改候选会阻止安装并保留原文件。默认角色文件和其他过期托管路径不走自动删除流程。

因此，已安装后不能在同一目标目录直接重命名 profile，否则安装器会因旧托管路径拒绝更新；需使用独立目标目录。

更新和删除之前会保存备份；应用失败会尝试回滚已执行的变更。重复安装在内容未变化时为空计划。计划与应用之间，基础 `config.toml` 或任何托管文件的存在性、内容若发生变化，即使计划原本为空，应用也会拒绝失效计划。单独运行预览不会保存可供下一条 CLI 命令应用的计划，`install --apply` 会重新生成计划。

## 基础指令快照

在 Codex CLI 0.159 中，profile 的 `developer_instructions` 会替换基础配置的同名文本，不会自动合并。依据见 [Codex 配置参考](https://developers.openai.com/codex/config-reference/) 与 [0.159 的 `config/mod.rs`](https://raw.githubusercontent.com/openai/codex/rust-v0.159.0/codex-rs/core/src/config/mod.rs)。其他版本和宿主需要另行确认该语义。

安装时，生成器把当时基础 `config.toml` 中的 `developer_instructions` 原样快照进 `<profile>.config.toml`，再接上路由激活说明。基础文件本身不会被改写。

基础文本修改或删除后，重新运行 `install --apply` 才会刷新快照，然后启动新会话。安装器保留文本，不会分析或修复它与路由政策之间的语义冲突；`AGENTS.override.md` 和其他宿主设置也可能影响入口加载。

`npm run build` 生成的可移植 bundle 只含激活说明，不包含基础指令、凭据或本机配置内容。

## 停用与手动移除

普通 `codex` 启动不加载路由 profile。不加载 profile 且不显式调用 `$task-routing` 时，入口要求维持原有工作方式；全局安装的 Skill 仍可被宿主发现，安装文件仍然存在。

显式调用 `$task-routing` 只让当前会话使用 Skill 政策，不能改变当前主模型，也不能让未加载的角色、模型或工具自动可用。需要完整角色配置时，在新会话中加载 profile。

当前没有自动卸载命令。手动移除时，根据安装目标中的 manifest 核对文件，仅移除本项目的 profile、`agents/task-routing/` 候选、`skills/task-routing/` 和安装记录；`AGENTS.md` 只移除 `task-router:start/end` 标记及其区块，保留其他内容。若安装停留在旧版本，旧区块使用 `codex-task-router:start/end`。备份目录可按是否还需恢复自行保留或移除，不要删除整个 Codex home 或基础 `config.toml`。

## 检查范围

`doctor` 检查配置格式，并根据有效模型目录逐个核对主模型与所有候选，包括非默认候选。provider 按目标基础配置中的定义检查；模型目录缺失或没有声明 reasoning levels 时，会提示未验证。当前目录检查按 `slug` 匹配，不能据此判断不同 provider 的同名模型是否支持相同档位。功能开关和目录条目的 `multi_agent_version` 均需手动核对。

`install` 和 `install --apply` 使用同一套目录检查，无需为每次更新先运行 `doctor`。这些检查不会发起模型调用；实际服务访问和子 Agent 派发需要在新会话中确认。

构建后可执行 `node scripts/check-native.mjs <Codex原生可执行文件路径>`。脚本先核对 `dist/` 与当前源配置是否一致，再检查原生配置解析，启动应用服务和临时线程检查角色发现警告，不提交对话轮次或发起模型推理。它也可能发现当前用户目录中的无效角色；更新角色文件后应先同步安装。

阶段级编排改动的离线回归覆盖两宿主产物、安装幂等、四种能力组合和 API 隔离。本次另在本机 Codex CLI 0.160.0 上通过了 profile 与全部 13 个候选的原生配置解析，以及 app-server 临时线程的角色发现检查；未提交模型对话轮次。Pi 主模型的选型场景不属于 Codex 运行测试，上述检查也不等于 Codex 实际子 Agent 派发或端到端行为验证。

原生检查验证解析与角色发现，实际调用还取决于 provider、凭据与宿主能力。测试和构建入口见 [README](../README.md#命令参考与开发入口)。

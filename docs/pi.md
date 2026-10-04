# Pi / pi-subagents 适配

[返回 README](../README.md)

Pi 后端保留 Task Router 的五个职责契约、模型候选、`when` 选档提示和编码验收规则，仅适配安装格式与派发接口。它不复用、不覆盖 Pi 的 worker、delegate、scout、researcher、reviewer、oracle 或其他内置角色，不安装新的调度器或模型 provider。

## 安装

需要已配置模型 provider 的 Pi，以及能提供当前脚本、模型覆盖和续聊接口的 `pi-subagents`。本适配依据 Pi 1.0.2、pi-subagents 0.75.0 的接口编写；没有以真实模型调用验证其他宿主或版本。

先安装执行与搜索依赖：

```sh
pi install npm:pi-subagents
pi install npm:pi-web-access
```

`tr_search` 的显式工具白名单包含四个网络工具，缺失其中之一会使派发失败，即使该任务只是本地查找。后台子会话默认发现已有扩展；若设置了 `subagents.defaultExtensions`、候选扩展覆盖或能力限制，应确认 provider 和 pi-web-access 都能在子会话加载。不能仅因父会话有工具就假定子会话也有。

在本仓库执行 `npm ci`，继续编辑同一份 `routing.toml`。`model` 写模型的原始注册 ID，`provider` 单独填写 Pi provider ID；不要把 `provider/id:thinking` 整串放进 `model`。Codex 和 Pi 的 provider ID 不一定相同，若显式 ID 不同，可以使用独立源配置并通过 `--config` 选择，角色和生成器仍共用。

预览和应用：

```sh
node cli.mjs install --host pi
node cli.mjs install --host pi --apply
```

默认目标为 `PI_CODING_AGENT_DIR`，未设置时为 `~/.pi/agent`。自定义目标：

```sh
node cli.mjs install --host pi --pi-home /path/to/agent --config routing-pi.toml
node cli.mjs install --host pi --pi-home /path/to/agent --config routing-pi.toml --apply
```

`--pi-home` 只决定检查或安装目录，不会改变另一个 Pi 进程的 agent directory。使用自定义目标时，启动 Pi 的 `PI_CODING_AGENT_DIR` 也应指向该目录。

安装器不会自动执行 `pi install`，不会改写 `settings.json`、认证、provider 配置或 pi-subagents 的全局设置。

## 启用与主模型

安装后在工作项目中启动 Pi，或在现有会话执行 `/reload`。确认依赖加载、生成角色可见后，显式调用：

```text
/skill:task-routing 你的任务
```

没有调用该 Skill，也没有适用指令明确启用时，保持 Pi 原来的工作方式。安装和 Skill 可发现性本身不授权自动派发；生成 Skill 禁用自动模型调用。已分配职责的子 Agent 不激活父级路由。

Pi 没有使用这里生成的 Codex profile。`orchestrator` 是推荐的主模型启动选择；加载 Skill 不会切换主模型。可先按自己的真实 provider 启动，例如：

```sh
pi --model sub2api/gpt-6-astra --thinking medium
```

`--model` 和 `--thinking` 应与源配置中的主模型匹配，或遵循本次用户明确选择。注意：Pi 的 `-p` 是 print 模式，不能照搬 `codex -p task-routing`。

## 角色与模型派发

默认候选仍名为 `tr_coding`、`tr_search`、`tr_verify`、`tr_reasoning`、`tr_general`；每个 `options` 候选仍生成 `tr_<role>_<id>`。自动候选 ID、选择提示和职责契约与 Codex 后端相同，不为了这次迁移重写角色组织方式。

Pi 后端把 `effort` 转成 agent frontmatter 的 `thinking`。支持的标签为 `off/minimal/low/medium/high/xhigh/max`。其他 provider-specific 标签会报错，不直接翻译成相近标签。

未指定 provider 的候选，按 Router 政策继承当前父会话 provider，不继承同角色其他候选的 provider。生成角色允许 bare model ID，但正式派发前主 Agent 必须检查当前注册表、解析准确 provider，并显式传入完整模型与强度；这避免 Pi 的 provider 偏好、模糊匹配或模型设置覆盖改变路由。命名角色始终保留自己的职责和工具。

单个有边界的子任务形如：

```js
subagent({
  agent: "tr_coding",
  model: "sub2api/deepseek-flash:max",
  context: "fresh",
  async: true,
  task: "具体目标、文件所有权、已确认的接口与证据、验收条件和停止规则"
});
```

示例不是已验证的模型能力声明。执行前需核对模型与所需 thinking 是否可用。`subagent` 的顶层 `thinking` 参数只用于 watchdog 配置；派发强度使用 `model` 的 `:level` 后缀，不能编造按次 `effort` 参数。

编码后独立验收仍由 Router 的 `tr_verify` 候选执行，不替换成 Pi 内置 reviewer。生成角色不声明 `acceptanceRole: writer`，从而不引入依赖内置 reviewer 的自动推断；宿主已有 evidence gates 仍生效，父 Agent 仍负责真实的独立验收。

## 并行、续聊与执行边界

多步骤或并行使用 pi-subagents 自己的 async workflow，由 `runs.run`、`runs.all` 组合；所有子派发在同一个顶层 workflow 中。生成 Skill 会要求主 Agent 先阅读安装版本的指南，检查当前 schema，不照搬已移除的 Codex `send_input` 等接口。

- 同一共享目录只有一个 writer；有意并行写入时使用宿主支持的独立 worktree。
- `max_concurrent` 转成工作流请求的 `globalConcurrencyLimit` 和父 Agent 的协调规则。Pi 的该参数只限制单个 workflow，不等于原 Codex 的全会话并发上限；本项目不改全局配置来伪造等价性，其他宿主限制仍可能更低。
- 正常相关工作通过 `status` 后的 `resume` 继续；活跃子 Agent 使用 `steer`。恢复保留原 agent、模型和工具，不能借此切换候选。
- coder/verifier 使用独立上下文。默认新任务 fresh，需要父历史时才按宿主能力 fork。
- 普通 async 子任务有原生完成通知；没有独立工作时让出控制，不用轮询或 sleep 等待。
- 运行、provider、扩展或工具设置失败时记录准确路由与运行状态、cwd/worktree/branch/ref 和部分改动，不静默换模型、角色、前台模式、其他 CLI 或工作流引擎。

详细规则在生成的 `skills/task-routing/references/pi-execution.md`。

这里的 `workflow` 指 **pi-subagents 工具自己的 `workflow` 参数**。单独安装的 `pi-dynamic-workflows` / `workflow` 工具有不同角色注册、模型覆盖与扩展加载机制，本版本不适配它。

## 工具与权限差异

| 角色 | Pi 工具边界 |
| --- | --- |
| coding | 读、检索、shell、edit/write、原生 supervisor |
| search | 读、检索、四个网络工具、supervisor；没有 bash/edit/write |
| verify | 读、检索、shell、supervisor；没有 edit/write |
| reasoning | 读、检索、supervisor；没有 bash/edit/write |
| general | 读、检索、shell、edit/write、supervisor；契约限制为非编码交付 |

Pi 工具白名单不是 Codex 的操作系统 sandbox。verify 的 shell 可以产生检查产物，也有能力修改源码；“不修改产品和测试源码”依赖职责契约，不是文件系统级禁止。coding/general 的 shell 也不具备等价的 workspace-write 系统隔离。需要更强边界时应配置宿主安全扩展，本安装器不放宽或伪造权限。

子 Agent 使用原始角色契约，继承项目与全局操作约束，不继承技能目录，也没有嵌套 subagent 工具。父会话的路由激活不会放进子角色正文。

## 检查

```sh
node cli.mjs doctor --host pi
```

检查配置、所有候选的 Pi thinking 标签以及安装目标设置中的 `subagents.maxThinking` 子模型上限，并提示未验证项。该上限不用于主模型。CLI 不加载 Pi 扩展、不读取认证、不查询远端模型目录、不发起模型调用；没有注册表快照时，模型存在性和模型特定的思考档位标为 `UNVERIFIED`，不能把退出零当作派发通过。

可提供一份经过核对、无凭据的 Pi 注册表快照：

```json
{
  "models": [
    {
      "provider": "example-relay",
      "id": "example-model",
      "thinkingLevels": ["off", "low", "medium", "high"]
    }
  ]
}
```

快照要覆盖主模型及所有候选；示例只说明格式，不能直接用于仓库默认配置。`thinkingLevels` 应来自实际 Pi 模型能力，而不是推测或 Codex wire effort 列表。Pi provider 可把 UI thinking 映射成另一 wire 值；本后端不擅自把 `max` 当成 `ultra`。

```sh
node cli.mjs doctor --host pi --catalog pi-registry.json
node cli.mjs install --host pi --catalog pi-registry.json --apply
```

按准确 `provider/id` 检查模型；未明确 provider 且没有本机启动默认 provider 时，同名多 provider 会报歧义。指定 `thinkingLevels` 后，不支持的档位会报错，拒绝依赖静默 clamping；省略该字段则标记未验证。快照本身是输入证据，不证明它当前仍真实或服务可访问。源中的显式主 provider 会作为推荐启动选择用于检查，但实际派发仍按当前父会话重新解析。

在 Pi 中使用 `/subagents-doctor`、`/subagents-models` 和能力列表检查真实注册状态；主 Agent 正式派发前还需核对项目覆盖及有效权限。后台 runner 在 Windows standalone Pi 上的支持仍应按 pi-subagents 的实验性说明处理，不能从 Markdown 生成成功推断可运行。

## 托管文件与更新

以下路径相对于 Pi agent directory：

| 路径 | 用途 |
| --- | --- |
| `agents/task-routing/*.md` | Router 自己的默认角色和命名候选 |
| `skills/task-routing/` | Pi 专用入口、角色映射和参考契约 |
| `AGENTS.md` | 仅合并 `pi-task-router:start/end` 标记区块 |
| `.task-router/pi/manifest.json` | Pi 独立安装记录 |
| `.task-router/backups/` | 更新或删除前的备份 |

不修改 `settings.json`、模型配置、认证、其他角色或其他 Skills。未托管或手改生成文件会拒绝覆盖。删除候选仅清理该 manifest 中 hash 未变的已知候选 `.md` 路径，不删除默认角色或未知旧路径。

重复安装不变时为空计划。设置文件和所有托管目标都检查预览前镜像；规划后发生变化，即使原计划为空也拒绝应用。应用失败使用原有安装器回滚已执行的文件变更。

修改源配置后重新 `install --host pi --apply`，再 `/reload` 或启动新会话；已运行子 Agent 和其续聊保留启动时的模型与工具，不热切换。新任务才采用新候选。

独立构建不安装到本机：

```sh
node cli.mjs build --host pi
node cli.mjs build --host pi --out /path/to/pi-bundle
```

默认输出 `dist/pi/`，原 Codex 输出仍是 `dist/`。不要将两套 bundle 安装到同一个 home，也不要直接用 Codex profile 覆盖 Pi 的同名 Skill。

当前没有自动卸载命令。手动停用先停止显式调用 Skill；移除时依据 Pi manifest 核对，仅删除该项目托管文件，并只移除 `AGENTS.md` 的 Pi 标记区块，保留其他指令、Pi 内置角色、设置与凭据。

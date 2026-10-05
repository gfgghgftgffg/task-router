# Pi / pi-subagents-lean 适配

[返回 README](../README.md)

Pi 后端保留五个职责契约、模型候选、`when` 选档提示和独立编码验收。执行依赖是 [@ssk_dev/pi-subagents-lean](https://github.com/kunkun9527/pi-subagents-lean)，其内部使用 [@tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents)。这不是 nicobailon 的 `pi-subagents`，不能混用两套参数或把它当作原插件的轻量开关。

lean 后端曾以 Node 22.23.3 上的 Pi 1.0.2、lean 0.19.4 / tintinweb 0.19.0 做过真实执行验证。仓库 CLI 要求 Node 22+；Pi 1.0.2 自身要求 Node 22.19+。本项目不安装 provider，也不复用或覆盖内置角色。

## 安装

先替换执行插件，再安装 Router 角色。如果装过旧版：

```sh
pi remove npm:pi-subagents
```

安装执行和联网检索依赖：

```sh
pi install npm:@ssk_dev/pi-subagents-lean@0.19.4
pi install npm:@ssk_dev/pi-web-access-lean
```

不要同时加载多个 subagents 或 web-access 门面，也不要把 lean 的上游依赖另行启用为扩展。替换插件后 `/reload` 或重启 Pi，确认只有一个 `subagent` 工具。旧会话可能仍持有旧接口；插件安装成功不等于旧运行时已刷新。

建议把以下设置合并进 `~/.pi/agent/subagents.json`，保留已有字段：

```json
{
  "fallbackSubagent": "none",
  "strictAgentFiles": true,
  "workflowsEnabled": true
}
```

`fallbackSubagent` 禁止未知/禁用角色被替换成 general-purpose；`strictAgentFiles` 在启动时拒绝损坏角色；`workflowsEnabled` 显式启用本引擎的原生 workflow。项目 `.pi/subagents.json` 会覆盖全局同名项。旧 nicobailon 的 `settings.json subagents.*`（含 maxThinking、agentOverrides）不适用于这个引擎。安装器不会代改上述配置。

`tr_search` 使用 lean 的 `web_access`，支持 search/check/fetch/get 四种操作，不要求暴露四个原始工具。扩展选择器按包的短名匹配；本后端的搜索工具配置针对 `@ssk_dev/pi-web-access-lean`，不是直接启用 `pi-web-access`。不要仅因父会话能联网就假定子会话也能。

在仓库执行 `npm ci`，编辑同一份 `routing.toml`。`model` 写注册表中的原始模型 ID，`provider` 单独写 provider ID，不附加 thinking 后缀。Codex/Pi 的 provider ID 若不同，可通过 `--config` 选择独立源配置，生成器和契约仍共用。

```sh
node cli.mjs install --host pi          # 预览
node cli.mjs install --host pi --apply  # 应用
```

目标是 `PI_CODING_AGENT_DIR`，未设置时为 `~/.pi/agent`。自定义：

```sh
node cli.mjs install --host pi --pi-home /path/to/agent --config routing-pi.toml --apply
```

`--pi-home` 只决定检查/安装目录；实际 Pi 进程的 `PI_CODING_AGENT_DIR` 也需指向它。CLI 不执行 `pi install`，不改 `settings.json`、`subagents.json`、凭据或 provider。

## 启用与主模型

安装角色后再次 `/reload` 或启动新会话，使 lean 的启动角色列表和 Skill 刷新。确认 `/agents` 中可见 `tr_*`，然后显式启用：

```text
/skill:task-routing 你的任务
```

未调用 Skill、也没有适用指令明确启用时，保持原工作方式。安装不授权自动派发；Skill 设置 `disable-model-invocation: true`。子 Agent 只遵守其职责和任务，不递归激活 Router。

Pi 不加载 Codex profile。`orchestrator` 是推荐启动选择，Skill 不切换父模型，例如：

```sh
pi --model sub2api/gpt-6-astra --thinking medium
```

用户明确的本次主模型选择优先。Pi `-p` 是 print 模式，不是 `codex -p task-routing` 的等价入口。

## 角色与模型派发

默认候选为 `tr_coding`、`tr_search`、`tr_verify`、`tr_reasoning`、`tr_general`；options 生成 `tr_<role>_<id>`，稳定 ID 和契约与 Codex 一致。

上游只扫描扁平的 `agents/*.md`，因此安装到 `agents/tr_*.md`，不能继续用嵌套目录。直接 Agent 调用中 frontmatter 的 model/thinking 会压过按次参数；为了保留临时覆盖和当前父 provider 继承，生成角色**不写模型/强度锁定字段**。它们保存在生成的 `references/role-map.md`，主 Agent 每次新派发必须显式传入两者。只按名称 `@tr_coding` 启动会继承父模型，不等于 Router 路由。

未指定 provider 的候选继承**实际父会话 provider**，不继承同角色其他候选或推荐的 orchestrator provider。显式用户模型/档位要求只覆盖其指定任务/角色，不改持久配置；匹配候选优先，否则保持职责和工具做支持的按次覆盖。

直接派发示例（示例模型须在自己的环境重新核验）：

```js
subagent({
  op: "run",
  subagent_type: "tr_coding",
  description: "Implement bounded behavior change",
  prompt: "具体目标、cwd/ref、所有权、适用约束、证据、验收和停止规则",
  run_in_background: true,
  input: JSON.stringify({ model: "sub2api/deepseek-flash", thinking: "max" })
});
```

lean 使用 `op/prompt/subagent_type/run_in_background/input`，不是旧 `agent/task/context/async/action`。直接派发的 model 和 thinking 是**分开的参数**；`input` 是 JSON 对象字符串，直接字段覆盖同名 JSON 字段。原生 workflow 使用 `agentType/model/effort`，不能附加 `:thinking` 后缀。

直接 thinking 支持 off/minimal/low/medium/high/xhigh/max。上游 0.19.0 的 workflow effort **不接受 off**：off 候选仅能直接运行，涉及原生 workflow 时应报告不支持，不能省略 effort 后继承另一档位或静默换协议。

上游允许模糊匹配、跨 provider 回退和 thinking clamping，Router 政策禁止依赖它们。必须事前核对精确可用 ID 和档位，并在验收前检查实际子会话的 model/thinking；请求参数和子模型自述都不是执行证据。发生变化时报告基础设施故障，不把替代模型当作成功。

项目 `.agents/agents` 和 `.pi/agents` 可覆盖全局定义，后者优先。检查有效角色文件，包括是否有人添加锁定字段、嵌套 delegation 或更宽工具。默认 replace prompt 不继承 AGENTS.md/CLAUDE.md；主 Agent 应读取并在冷启动 brief 中供应适用约束，不能声称自动继承。

## 并行、续聊与执行边界

### 按阶段选择

编排先看实际可用能力，不根据 Pi 或插件名字推断模式。模型档位按复杂度、风险和上下文选；编排方式按当前阶段的输入输出、依赖、分支、停止条件和交互需求选。多 Agent、多步骤、并行或独立验收都不自动触发 workflow。

- **两种能力都有**：开放排障、少量明确分工、需要根据发现调整方向时直接调度；决策结构明确，批处理、流水线、复用或汇总有实际收益时使用 workflow。可以直接探索 → 局部 workflow → 主线程处理异常。
- **只有 subagents**：主线程协调并行、依赖、批次和跟进，不尝试调用 workflow。coder 实现 → 独立 verifier → 原 coder 修复也可直接调度。
- **只有 workflow**：使用较短、有边界的阶段，探索结果先交回主线程判断，再定义下一阶段；不因为没有直接子任务接口就猜一条覆盖整个项目的固定流程。
- **两者都没有**：主线程只处理允许自行完成的工作；需要委派或独立验收的部分报告能力缺失。

下面的 lean API 说明描述当前安装后端，不是所有插件的通用字段。其他执行器必须按实际 schema 调用，并保留 Router 的角色、精确选档、权限和证据边界；不能只凭同名能力声称兼容。

通信由主线程中转相关证据和原始来源，用 direct steer/resume 跟进；未向子 Agent 开放彼此发消息或自动同步上下文的工具。workflow 内的孩子仍归 workflow 所有，不能用 direct result/steer/resume 接管。

改变模式要等阶段结束或确认停止，并核实剩余子任务、局部 diff 和基线；pause 不意味着在途 writer 已停止。所有模式共用 Router 的合计并发协调上限和原工作单元的修复计数，保持独立验收、所有权及精确选档。模型、权限或运行故障不授权静默切换模式。

选择标准、反例及 Anthropic / OpenAI 官方依据见[阶段级编排](../skill/references/orchestration.md)，安装后为 `references/orchestration.md`。这是政策改进，不引入新框架、分类器或调度服务。

### 原生 workflow API

仅在选定脚本化阶段后使用 lean 自己的 `op: "workflow"`，通过 input JSON 传 `script` / `scriptPath` / `args`。例如一批目标按相同标准审查和复核；不是所有任务都要套用此模板：

```js
export const meta = { name: "bounded_audit", description: "Audit settled targets and independently check findings" };
if (!Array.isArray(args.targets) || args.targets.length === 0) throw new Error("targets are required");
const outcomes = [];
// 顺序示例；并行批次还要按 Router/宿主上限约束，不能把并发额度当每种模式各一份。
for (const target of args.targets) {
  const finding = await agent(`按已确认的标准审查 ${target}，返回证据和未解决问题`, {
    agentType: "tr_search", model: "provider/exact-id", effort: "high"
  });
  const verdict = finding === null ? null : await agent(`独立复核 ${target}；使用原始标准和实际来源，发现：${finding}`, {
    agentType: "tr_verify", model: "provider/exact-id", effort: "medium"
  });
  outcomes.push({ target, finding, verdict });
}
return { outcomes, executionIncomplete: outcomes.some(item => item.finding === null || item.verdict === null) };
```

使用注册模型/实际候选，示例不是可直接执行的配置。`agent()` 返回最终文本（schema 时为对象），失败/跳过返回 null；有文本也不自动等于验收 PASS。示例的 `executionIncomplete` 只标记 null 执行缺口，不解析 verdict 或代表验收通过；主线程仍须检查每项实际证据、FAIL/INCOMPLETE 和适用标准。并行用 `parallel` 函数数组；跨阶段流水线用 `pipeline`。不是旧 `runs.run/runs.all`，也不是单独的 `pi-dynamic-workflows` 工具。本后端不适配后者。

- 原生 workflow 总是后台；每个 run 并发上限为 `max(1, min(16, cpus - 2))`，没有可设置的 globalConcurrencyLimit。Router 的 max_concurrent 是额外协调上限；小于宿主上限时分批并 await，不能通过多个 workflow 绕过。
- 直接后台 Agent 受 `subagents.json maxConcurrent` 限制（默认 10）。workflow 子 Agent 不占这个池，不能声称它们共享一个全会话硬上限；主线程仍应合计约束两类活跃子 Agent 和流水线重叠阶段。
- 共享目录只有一个 writer。并行写入需要独立 worktree 和明确所有权；读正在变化的内容必须等待 writer。
- `isolation: "worktree"` 使用提交后的 HEAD，看不到未提交/暂存 diff；没有 baseRef。先检查全局/项目 worktreeIsolation 未禁用，否则引擎可能静默丢弃隔离请求。
- 修改在完成时保存成 `pi-agent-*` 本地分支，临时 worktree 随后移除。父 Agent 用分支交接集成；不要使用已删除的路径。gate 在 worktree 清理前运行，Windows gate 使用 cmd。
- 直接结果查询为 `op: "result", agent_id`；活跃直接子 Agent 为 `op: "steer", agent_id, message`；完成后的续聊用 `op: "run"` 的 input resume ID。先核对存储模型、工具、定义和 baseline。
- workflow 内通过 `agent(prompt, { resume: "原label" })` 续聊；不可同时传 model/effort/agentType 等。工作流子 Agent 不可用直接 result/steer 管理，运行管理在 `/agents → Workflows`。
- `resumeFromRunId` 是同会话内 journal 前缀重放，不是子会话续聊，也不支持跨会话恢复。磁盘重开的 mentions 会重读当前角色定义，不能保证历史工具契约不变。
- 新任务 fresh，coder/verifier 独立；生成角色固定不继承父对话。不支持保持契约的 fork 就报告不支持。
- 原生后台完成有通知；只剩等待工作时让出控制，不轮询/sleep，也不换前台、CLI 或其他引擎。

详细规则在 [Pi execution](../skill/pi/execution.md)，安装后位于 `skills/task-routing/references/pi-execution.md`。

## 工具与权限差异

| 角色 | 实际可见工具 |
| --- | --- |
| coding | read/grep/find/ls、bash、edit/write |
| search | read/grep/find/ls、web_access；无 bash/edit/write |
| verify | read/grep/find/ls、bash；无 edit/write |
| reasoning | read/grep/find/ls；无 bash/edit/write |
| general | read/grep/find/ls、bash、edit/write；职责限非编码 |

所有角色保持 `extensions: true`，保留 provider/权限扩展的生命周期 hooks；`skills: false`、`allowed_subagents: none`。仅指定内置 tools 不会关闭上游默认的扩展工具继承，因此每个角色都使用 ext 选择器建立明确白名单。

`ext:pi-subagents-lean/subagent` 配合 `disallowed_tools: subagent, ...` 是有意的“选入后拒绝”：以必装执行插件打开 closed 扩展工具范围，同时禁止该门面及其他编排工具。search 另外仅选 `ext:pi-web-access-lean/web_access`。这样不需要关闭所有扩展来阻止工具泄漏。

工具白名单不是 OS sandbox。verify 的 bash 能产生检查产物，也有能力改源码；不改产品/测试源码是契约而非文件系统禁令。扩展 factory 仍可能执行，不能将工具范围当成隔离不可信扩展的安全边界。

lean 没有 contact_supervisor/subagent_supervisor。子 Agent 遇阻报告问题并停止，父 Agent 解决后续聊；不伪造阻塞的 supervisor 请求。独立验收仍用 tr_verify，测试 gate、runner 完成、coder 自述不替代其 verdict。

## 检查

```sh
node cli.mjs doctor --host pi
```

CLI 离线检查 thinking 标签和可读配置，不加载扩展、读认证、请求远端或调用模型。没有注册表快照时 availability/档位支持是 UNVERIFIED，退出零不代表派发成功。

可输入当前、无凭据的可用注册表快照：

```json
{
  "activeProvider": "example-relay",
  "models": [
    { "provider": "example-relay", "id": "example-model", "thinkingLevels": ["off", "low", "medium", "high"] }
  ]
}
```

快照应覆盖主模型与所有候选；示例只说明格式。thinkingLevels 来自真实 Pi 能力，不能推测或照搬 Codex wire efforts。可选 activeProvider 是实际父 provider，用于未指定 provider 的子候选；没有它时仅按推荐启动配置/本机 defaultProvider 做静态检查，派发仍需重新解析。精确 ID 不存在、多 provider 歧义或不支持档位均报错；未提供档位则标未验证。

```sh
node cli.mjs doctor --host pi --catalog pi-registry.json
node cli.mjs install --host pi --catalog pi-registry.json --apply
```

doctor 读取 `<pi-home>/subagents.json` 以及**命令当前目录**的 `.pi/subagents.json`，提示未知角色回退、off workflow 限制、禁用 worktree 和旧设置。`workflowsEnabled: false` 只警告脚本化阶段不可用，不阻止直接调度的安装；用户明确要求 workflow 时仍须报告不支持，不能伪装为等价执行。检查别的工作项目时，从该项目调用仓库 CLI 的绝对路径。静态 CLI 不证明有效角色覆盖、扩展加载或凭据/服务可达。

Pi 中用 `/agents` 和 `subagent({ op: "help", input: "run" })` 检查加载及 schema；`pi --list-models` 列出可用模型但不证明 thinking 档位。此引擎没有旧 `/subagents-doctor`、`/subagents-models` 或 action 模型查询。实际模型和有效 thinking 应读子 session/invocation 或 workflow inspector，尤其注意 asked 与实际值不同的情况。

此前后端迁移验证包括 13 个真实候选的模型/档位/精确工具集合、fresh context、三个原测试不变的编码夹具与独立验收、按次模型覆盖、联网 fetch 官方文档，以及原生 parallel/pipeline/同子会话续聊。未进行模型质量 A/B；联网 fetch 不代表所有搜索服务账号都已验证。`npm test` 的回归只使用隔离本地夹具，不调用远端模型。

lean 的 token 宣传针对工具 schema/提示词贡献，使用字符估计且以空配置测量；它不代表本路由会话固定只用 275 tokens，也不是 provider 账单或子 Agent 执行成本的承诺。

阶段级编排回归检查两宿主的政策产物、四种能力组合、批处理条件、阶段交接、验收/修复/并发边界和禁用 workflow 后的直接安装。它们是离线内容及安装检查，不代表模型必然遵守。另在 Pi 1.0.3 上用 `sub2api/gpt-6.1-sol / xhigh` 的 12 个 fresh 父上下文做决策检查，覆盖两种能力都有、只有 subagents、只有 workflow、两者都没有，以及用户明确选型、故障和独立验收要求，12/12 符合预期。能力组合由测试 brief 声明，执行工具禁用，没有实际启动子 Agent/workflow；这不等于端到端执行、任意插件 API 兼容或普遍可靠性保证。

## 托管文件与更新

| 相对 Pi agent directory 的路径 | 用途 |
| --- | --- |
| `agents/tr_*.md` | 扁平 Router 角色和候选 |
| `skills/task-routing/` | Pi 入口、模型映射与参考契约 |
| `AGENTS.md` | 仅合并 pi-task-router:start/end 区块 |
| `.task-router/pi/manifest.json` | 后端独立安装记录 |
| `.task-router/backups/` | 安装器变更前的受管文件备份 |

旧 nicobailon 布局中的 `agents/task-routing/<已知角色>[_候选].md` 按 manifest/hash 迁到扁平目录，包含旧默认角色。只有受管、内容未变的已知旧路径会删除；手改旧文件、新路径碰撞、未知受管路径会拒绝迁移。候选删除同样只清理已知命名空间和未变哈希。

保留其他角色、Skills、设置和凭据；Pi/Codex manifest 和 AGENTS 标记独立。设置、runtime tuning 与所有受管目标都有预镜像校验，规划后变化（即使原计划为空）拒绝应用；应用失败回滚已执行的文件变更。

更新 routing.toml 后：

```sh
node cli.mjs install --host pi --apply
```

再 `/reload` 或启动新 Pi。重复安装不变时为空计划；已有子会话不热换模型，恢复前核对定义，新的选档只用于新任务。

独立构建为 `node cli.mjs build --host pi [--out PATH]`，默认 dist/pi；Codex 默认仍是 dist。不要把两套 bundle 安装到同一 home 或互相覆盖同名 Skill。

没有自动卸载 Router 命令。停用先不再调用 Skill；手动移除时根据 Pi manifest 核对，只删除受管文件和 Pi AGENTS 区块，保留其他指令与配置。

# Pi / pi-subagents-lean 适配

[返回 README](../README.md)

Pi 后端保留五个职责契约、模型候选、`when` 选档提示和独立编码验收。执行依赖是 [@ssk_dev/pi-subagents-lean](https://github.com/kunkun9527/pi-subagents-lean)，其内部使用 [@tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents)。这不是 nicobailon 的 `pi-subagents`，不能混用两套参数或把它当作原插件的轻量开关。

本版本以 Node 22.23.3 上的 Pi 1.0.2、lean 0.19.4 / tintinweb 0.19.0 验证。仓库 CLI 要求 Node 22+；Pi 1.0.2 自身要求 Node 22.19+。本项目不安装 provider，也不复用或覆盖内置角色。

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

使用 lean 自己的 `op: "workflow"`，通过 input JSON 传 `script` / `scriptPath` / `args`，脚本为：

```js
export const meta = { name: "bounded_work", description: "Implement then independently verify" };
const change = await agent("完整编码 brief", {
  agentType: "tr_coding", model: "provider/exact-id", effort: "high", label: "implementation"
});
if (change === null) throw new Error("implementation failed");
const verdict = await agent("原始验收条件和实际 diff 位置，不继承 coder 推理", {
  agentType: "tr_verify", model: "provider/exact-id", effort: "medium", label: "acceptance"
});
if (verdict === null) throw new Error("verification failed");
return { change, verdict };
```

使用注册模型/实际候选，示例不是可直接执行的配置。`agent()` 返回最终文本（schema 时为对象），失败/跳过返回 null；有文本也不自动等于验收 PASS。并行用 `parallel` 函数数组；跨阶段流水线用 `pipeline`。不是旧 `runs.run/runs.all`，也不是单独的 `pi-dynamic-workflows` 工具。本后端不适配后者。

- 原生 workflow 总是后台；每个 run 并发上限为 `max(1, min(16, cpus - 2))`，没有可设置的 globalConcurrencyLimit。Router 的 max_concurrent 是额外协调上限；小于宿主上限时分批并 await，不能通过多个 workflow 绕过。
- 直接后台 Agent 受 `subagents.json maxConcurrent` 限制（默认 10）。workflow 子 Agent 不占这个池，不能声称它们共享一个全会话硬上限。
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

doctor 读取 `<pi-home>/subagents.json` 以及**命令当前目录**的 `.pi/subagents.json`，提示未知角色回退、off workflow 限制、禁用 worktree 和旧设置。检查别的工作项目时，从该项目调用仓库 CLI 的绝对路径。静态 CLI 不证明有效角色覆盖、扩展加载或凭据/服务可达。

Pi 中用 `/agents` 和 `subagent({ op: "help", input: "run" })` 检查加载及 schema；`pi --list-models` 列出可用模型但不证明 thinking 档位。此引擎没有旧 `/subagents-doctor`、`/subagents-models` 或 action 模型查询。实际模型和有效 thinking 应读子 session/invocation 或 workflow inspector，尤其注意 asked 与实际值不同的情况。

本次验证包括 13 个真实候选的模型/档位/精确工具集合、fresh context、三个原测试不变的编码夹具与独立验收、按次模型覆盖、联网 fetch 官方文档，以及原生 parallel/pipeline/同子会话续聊。未进行模型质量 A/B；联网 fetch 不代表所有搜索服务账号都已验证。`npm test` 的回归只使用隔离本地夹具，不调用远端模型。

lean 的 token 宣传针对工具 schema/提示词贡献，使用字符估计且以空配置测量；它不代表本路由会话固定只用 275 tokens，也不是 provider 账单或子 Agent 执行成本的承诺。

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

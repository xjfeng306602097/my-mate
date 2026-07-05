# My Mate x OpenClaw 镜像集成方案

## 1. 文档目标

这份文档只回答一个问题：

`my-mate` 作为控制层，如何对接当前已经 Docker 化部署的 `openclaw-image`。

这里不讨论车机，不展开移动端 UI，而是聚焦：

1. 现有 `openclaw-local` 暴露了什么真实能力
2. `my-mate` 应该如何接入
3. 当前已经打通到了什么程度
4. 后续还差什么

## 2. 当前结论

### 2.1 不建议的接法

不要让 `my-mate` 直接依赖 OpenClaw 内部 workflow state machine。

原因：

- `4315` approval console 更适合查看和人工控制，不适合做业务主 dispatch 面
- `18789` gateway 当前不是一个对外稳定的“业务节点派发 API”
- 实际执行仍依赖运行时内部约定：
  - `register_task.py`
  - dispatch file
  - short task
  - `openclaw agent`
  - `[AGENT_REPORT]`
  - trajectory export

所以当前最稳的边界仍然是：

`my-mate control-plane -> execution-adapter -> openclaw-local`

### 2.2 推荐定位

- `my-mate control-plane`
  - 持有 DAG、Run、Node、审批、人工补参、控制动作的真相
- `execution-adapter`
  - 负责把节点派发语义翻译成 OpenClaw 容器执行语义
- `openclaw-local`
  - 负责 agent runtime、skills/tools/workspace 执行、trajectory 产出

换句话说：

- `my-mate` 是控制平面
- `openclaw` 是执行内核
- `execution-adapter` 是翻译层和回调桥

## 3. 已验证的本地 OpenClaw 形态

本地 Docker 部署已确认如下：

- 容器名：`openclaw-local`
- 容器状态：`running` 且 `healthy`
- gateway：`18789`
- approval console：`4315`
- web console：`7681`
- runtime root：`/home/node/.openclaw/.openclaw`
- architect scripts root：
  - `/home/node/.openclaw/.openclaw/workspace-architect/scripts`
- registry：
  - `/home/node/.openclaw/.openclaw/workspace-architect/projects/registry.json`
- CLI：
  - `/home/node/.npm-global/bin/openclaw`

这与 `execution-adapter` 当前的 `container-exec` 假设是一致的。

## 4. 当前真实拓扑

```mermaid
flowchart LR
    M[Mobile / PC] --> CP[My Mate Control Plane]
    CP --> BR[Execution Adapter]
    BR --> OC[openclaw-local]
    OC --> BR
    BR --> CP
```

职责边界：

- `control-plane`
  - 模板、RunPlan、调度、状态机、事件、审批、补参、控制动作
- `execution-adapter`
  - dispatch/control API
  - task 注册
  - direct-agent 启动
  - 轮询 task 状态
  - trajectory 导出
  - report 归一化
- `openclaw-local`
  - agent 执行
  - workspace/tool/skill
  - 任务事实和 trajectory

## 5. Bridge 的实现模式

当前 bridge 支持三种模式中的两层组合：

### 5.1 control-plane 视角

`MY_MATE_OPENCLAW_BRIDGE_EXECUTION_MODE=container-exec`

表示控制层派发给 bridge 时，声明目标执行模式是容器执行。

### 5.2 bridge 内部执行策略

`MY_MATE_OPENCLAW_CONTAINER_EXECUTION_STRATEGY`

目前支持：

- `register-only`
  - 只注册 task，落 handoff，不继续跑 agent
- `direct-agent`
  - 注册 task 后，直接在容器里启动一个隔离 agent task
  - 异步轮询直至拿到最终结果

### 5.3 当前推荐模式

对于本地 Docker OpenClaw，当前推荐：

- `control-plane`: `container-exec`
- `execution-adapter`: `direct-agent`

也就是：

`control-plane -> bridge(container-exec) -> openclaw-local(direct-agent async poller)`

## 6. 当前已打通的异步执行链路

### 6.1 执行步骤

当前 `direct-agent` 已不是同步等待模式，而是异步桥接模式：

1. `control-plane` 发起 `POST /api/v1/dispatches`
2. `execution-adapter` 写入 dispatch record
3. bridge 回调 `accepted`
4. bridge 在容器内：
   - materialize requirement bundle
   - 运行 `register_task.py`
   - 获取 `dispatch_file`、`short_task`、`task_id`
5. bridge 执行：
   - `docker exec -d openclaw-local openclaw agent ...`
6. bridge 立即回调 `running`
7. bridge 后台 poller 周期查询：
   - `openclaw tasks show --json`
   - 必要时回退 `openclaw tasks list --json`
8. task 成功后导出 trajectory：
   - `openclaw sessions export-trajectory --json --session-key ...`
9. bridge 从以下位置提取最终 `[AGENT_REPORT]`：
   - `metadata.json`
   - `events.jsonl`
10. bridge 归一化回调：
   - `completed`
   - `failed`
   - `waiting_human`
11. `control-plane` 更新 node/run 状态并落 artifact/event

### 6.2 为什么要这样做

因为本地 OpenClaw task 完成和最终结果提取，不适合在单个同步 HTTP 请求里等待：

- 任务执行时间不可控
- task store 查询存在非纯 JSON 输出情况
- trajectory 最终 report 不一定只在 `metadata.json`
- 服务重启后需要恢复未完成 dispatch

所以 bridge 现在做的是：

- 派发同步化
- 执行异步化
- 结果归一化

## 7. 当前实现细节

### 7.1 dispatch store 持久化的关键字段

bridge 现在会记录：

- `openclaw_result_session_key`
- `openclaw_result_session_file`
- `openclaw_result_run_id`
- `openclaw_result_trajectory_dir`
- `poll_started_at`
- `last_polled_at`
- `last_reported_status`
- `direct_agent`

这样做是为了：

- 支持异步轮询
- 支持 bridge 重启恢复
- 支持后续排障

### 7.2 session key 约束

一个真实坑点已经确认：

- `disp_...` 后缀在 OpenClaw task store 里要求 lower-case

所以 bridge 现在统一生成：

- `agent:{agent}:explicit:bridge-disp_...lowercase...`

如果这里大小写不一致，会导致：

- `tasks show` 查不到
- trajectory 导出链路断开

### 7.3 trajectory 提取策略

最终 report 提取不能只读 `metadata.json`。

真实成功 case 表明：

- 有时 `metadata.finalAssistantRawText` 有内容
- 有时最终 `[AGENT_REPORT]` 只出现在 `events.jsonl`

所以 bridge 现在是：

1. 先看 `metadata.json`
2. 再扫 `events.jsonl`
3. 最终抽取 `[AGENT_REPORT]`

### 7.4 容错策略

bridge 已补以下容错：

- `tasks show --json` 输出非纯 JSON 时，做宽松 JSON 提取
- `tasks show` 失败时，回退 `tasks list --json` 扫描匹配
- poller 报错不会打崩 adapter 进程
- 服务重启时 `resumeBackgroundWork()` 会重挂未完成轮询

## 8. 当前已验证结果

### 8.1 编译验证

已通过：

- `services/execution-adapter`: `npm run check`
- `services/execution-adapter`: `npm run build`
- `services/control-plane`: `npm run build`

### 8.2 隔离验证环境

为了不影响主实例，验证使用：

- `control-plane`：`4011`
- `execution-adapter`：`4020`

对应数据目录：

- `tmp/async-e2e/control-plane-data`
- `tmp/async-e2e/execution-adapter-data`
- `tmp/async-e2e/logs`

### 8.3 已成功跑通的真实 run

已验证成功的一条真实 run：

- `run_id = run_20260607T080822072Z_000_4dcsxf`
- `node_run_id = nr_node-backend_20260607T080822072Z_001_tspsgq`
- `dispatch_id = disp_20260607T080822099Z_000_ok0bjc`
- `taskId = 56faad5a-80d8-435b-bb38-2bd95ff539e8`
- `runId = 56239359-0a4b-4f74-8f67-103aa86538c2`
- `sessionKey = agent:backend:explicit:bridge-disp_20260607t080822099z_000_ok0bjc`

最终结果：

- `GET http://127.0.0.1:4011/api/runs/run_20260607T080822072Z_000_4dcsxf`
- `status = completed`

对应事件已经包含：

- `node.progress`
- `artifact.created`
- `node.completed`
- `run.completed`

对应 artifacts：

- handoff
- agent-report

### 8.4 trajectory 导出

成功导出过的目录示例：

- `/workspace/.openclaw/trajectory-exports/openclaw-trajectory-bridge-d-2026-06-07T08-39-39`

这说明：

- task 完成
- trajectory 可读
- 最终 report 可提取

## 9. control-plane 当前需要如何理解 bridge

### 9.1 callback 状态集合

bridge 回给 `control-plane` 的状态建议固定为：

- `accepted`
- `running`
- `waiting_human`
- `completed`
- `failed`
- `cancelled`

不要把 OpenClaw 内部 stage/status 原样透传成业务态。

### 9.2 waiting_human 的分流

当前控制层已补好：

- `approval_kind` -> 生成审批请求
- `human_input_schema` -> 生成人工补参请求

审批通过或补参提交后：

- 当前节点重新置为 `ready`
- 再次触发一次 dispatch

### 9.3 artifacts 的控制层职责

bridge 只负责返回 artifact metadata。

`control-plane` 负责：

- 持久化 artifact record
- 让移动端或管理端查询
- 把 artifact 生命周期纳入 run 视图

## 10. 当前仍然存在的限制

### 10.1 还没有重接 architect 多阶段图

当前 `direct-agent` 只覆盖：

- 单节点
- 单次 direct agent task
- 最终 report 回传

还没有做：

- 回到原 architect 会话图继续推进复杂多阶段 runtime

### 10.2 还存在旧脏 dispatch

隔离 adapter 数据里仍有一条旧 dispatch 残留为 `running`：

- `disp_20260607T023241098Z_000_4711n3`

它来自早期大小写和超时问题阶段，不影响已成功链路，但后续应清理或修复标记。

### 10.3 测试还偏集成验证

当前已经有真实 e2e 证明链路能跑通，但还缺：

- 任务查询回退逻辑单测
- trajectory 抽取单测
- restart recovery 单测

## 11. 推荐的后续动作

### 11.1 近期

1. 再跑一条全新 run，证明不是依赖旧 dispatch 恢复
2. 处理旧脏 dispatch
3. 补 focused tests
4. 固化 async bridge 文档和运维手册

### 11.2 中期

1. 给移动端/BFF 暴露 run、events、artifacts、approvals、human-inputs
2. 支持更多模板节点类型
3. 补 pause/resume/cancel 在真实 OpenClaw task 上的进一步控制

### 11.3 长期

如果后续要产品化，再考虑把 bridge 内嵌进 OpenClaw 或 sidecar 化，统一暴露：

- `POST /api/v1/dispatches`
- `POST /api/v1/controls`
- `GET /api/v1/dispatches/:id`

但在当前阶段，没有必要先改 OpenClaw 镜像本体。

## 12. 最终判断

现在最合理的工程结论仍然是：

1. `my-mate` 持有 DAG / Run / Node / 审批 / 干预真相
2. `execution-adapter` 吸收 OpenClaw 容器运行时复杂性
3. `openclaw-local` 作为多 agent 执行内核

并且这条路已经不是纸面方案，而是已经在本地 Docker 环境下跑通了真实异步执行闭环。

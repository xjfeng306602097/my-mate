# My Mate 总体架构设计

## 1. 文档目标

本文定义 `My Mate` 的总体产品和技术架构。

`My Mate` 的目标不是重做一个新的 Agent Runtime，而是基于现有 `OpenClaw` 内核，构建一个：

- 手机优先的任务协同产品
- 可配置工作流/DAG 平台
- 支持人工干预、审批、暂停、恢复、重试的控制层
- 支持针对不同业务模板进行编排的 Agent 产品

本文覆盖：

- 移动端产品形态
- PC 端模板配置台
- 后端控制层
- OpenClaw 集成方式
- 状态、事件、产物、通知流
- DAG 模板化与可控动态化策略

## 2. 核心结论

### 2.1 总体原则

`My Mate` 采用分层架构：

- `OpenClaw` 作为执行内核
- `My Mate Control Plane` 作为工作流控制层
- `Mobile / PC Client` 作为交互层

### 2.2 不做什么

当前阶段不做：

- 不重写底层 Agent Runtime
- 不重写模型路由、Skill Host、Workspace 执行机制
- 不让手机端直接改底层工作流状态文件
- 不让 Orchestrator 无约束地自由发明工作流语言

### 2.3 要做什么

`My Mate` 要做：

- 手机端提交意图
- 控制层将意图翻译成可执行 Run Plan
- 支持模板化 DAG
- 支持配置 Agent Profile、Skill Allowlist、审批点、超时、重试、并发
- 支持 Orchestrator 在模板约束内针对业务做动态细化
- 支持人工在手机端进行审批、补充输入、暂停、恢复、取消、重试

## 3. 产品定义

### 3.1 产品定位

`My Mate` 是一个面向手机协同场景的 Agent 任务控制平台。

它解决的问题不是“让 AI 会聊天”，而是：

- 让用户在手机上发起复杂任务
- 让后台多 Agent 异步执行
- 让用户随时跟进进度和结果
- 让用户在关键节点介入和控制

### 3.2 目标用户

- 一人公司 / 小团队操盘者
- 需要异步安排复杂任务的开发者/产品/运营
- 希望把多 Agent 能力封装成可重复工作流的人
- 希望在移动端完成“发起 - 跟进 - 干预 - 收口”的用户

### 3.3 用户面能力

#### 手机端

- 新建任务
- 首页概览（home overview）
- 待处理收件箱（inbox）
- 选择模板
- 填写参数
- 查看任务进度
- 查看当前节点
- 查看产物和摘要
- 查看单个 Run 的 follow-up 视图
- 审批 / 暂停 / 恢复 / 重试 / 取消
- 处理“等待你输入”的卡点

#### PC 端

- 配置工作流模板
- 画/编排 DAG
- 为节点绑定 Agent Profile
- 为节点设置 Skill Allowlist
- 配置审批点、超时、重试、并发
- 发布模板版本

#### 管理/运营端

- 查看运行中的 Run
- 查看失败节点
- 查看事件时间线
- 查看审计记录
- 人工强制解锁 / Block / Override

## 4. 总体架构

```text
Mobile App / PC Workflow Studio
  -> API Gateway / BFF
  -> Workflow Control Plane
  -> OpenClaw Execution Adapter
  -> OpenClaw Kernel
  -> State / Event / Artifact / Notification Stores
```

### 4.1 分层说明

#### A. 客户端层

包括：

- iOS / Android App
- PC 端 Workflow Studio

职责：

- 收集用户意图
- 展示 Run 状态
- 展示 DAG / 模板信息
- 接收通知
- 发起干预操作

不负责：

- 工作流状态真相
- DAG 执行决策
- 风险权限策略

#### B. API Gateway / BFF

职责：

- 用户鉴权
- Session/Token 管理
- 为移动端和 PC 提供友好的 API 聚合
- 将 Control Plane 的底层 Run / Node / Approval / Human Input 真相聚合成移动端视图模型
- 为手机端提供低跳转、低认知负担的首页/收件箱/follow-up 聚合接口
- 推送连接管理
- 上传下载附件代理

不负责：

- 工作流编排
- Run 状态转移
- DAG 编译

当前建议的 Mobile BFF 聚合接口：

- `GET /api/mobile/home`
  - 首页视图
  - 聚合总览、焦点 Run、最近 Run、待处理数量
- `GET /api/mobile/inbox`
  - 待处理视图
  - 聚合 pending approvals / pending human inputs
- `GET /api/mobile/runs`
  - Run 卡片列表
- `GET /api/mobile/runs/{runId}`
  - Run 详情页
- `GET /api/mobile/runs/{runId}/follow-up`
  - 单个 Run 的跟进页
  - 聚合 blocker、active task、latest timeline、next actions

#### C. Workflow Control Plane

这是 `My Mate` 的产品核心。

职责：

- 模板管理
- Run 创建
- 模板参数化
- DAG 编译
- 节点调度
- 运行时状态机
- 审批/人工输入/人工控制
- 并发预算和限制
- 事件标准化
- 与 OpenClaw 交互的统一控制入口

#### D. OpenClaw Execution Adapter

职责：

- 将 Control Plane 的节点执行请求翻译为 OpenClaw 可执行任务
- 将 Agent Report/Task Progress 标准化回传给 Control Plane
- 管理 OpenClaw Agent 与 My Mate Agent Profile 的映射

#### E. OpenClaw Kernel

职责：

- Agent Runtime
- Subagent 执行
- Skill Host
- Model/Provider 路由
- Tool/Shell/Browser/File 执行
- Workspace 执行隔离

不负责：

- 模板工作流语义
- 移动端协同语义
- 审批与运营策略

## 5. 核心对象模型

`My Mate` 至少有四个核心对象：

- `Workflow Template`
- `Run`
- `Node Run`
- `Artifact/Event`

### 5.1 Workflow Template

模板是可复用的业务工作流定义。

包含：

- 输入参数定义
- 节点定义
- 边定义
- Agent Profile 绑定
- Skill Allowlist
- Gate / Approval / Retry / Timeout / Parallelism

### 5.2 Run

Run 是模板的一次实例化执行。

包含：

- 模板版本
- 用户输入
- 编译后的执行计划
- 当前整体状态
- 当前 frontier
- 审批/干预上下文

### 5.3 Node Run

Node Run 是一个具体节点的一次执行实例。

包含：

- 节点类型
- 绑定的 Agent Profile
- 执行状态
- 进度
- 产物
- 重试信息
- OpenClaw Task/Session 关联信息

### 5.4 Event / Artifact

Event：

- 只追加，不覆盖
- 供移动端时间线、运营端审计、问题复盘使用

Artifact：

- 文档
- 报告
- 补丁
- 输出结果
- 过程文件

## 6. DAG 与工作流策略

## 6.1 为什么不能继续使用固定工作流

当前固定工作流适合软件交付路径，但不适合 `My Mate` 的产品目标。

问题包括：

- 角色语义被写死
- 节点顺序被写死
- 不利于跨业务复用
- 不利于移动端模板化选择
- 不利于让 Orchestrator 在约束内进行业务级动态细化

## 6.2 目标：模板化、受控动态化

`My Mate` 的工作流能力分三层：

### 第一层：固定模板

例如：

- 软件需求交付
- Bug 修复
- 调研汇总
- 素材处理

### 第二层：可配置 DAG 模板

由 PC Workflow Studio 配置：

- 节点
- 边
- Agent Profile
- Skill Allowlist
- Retry/Timeout
- 人工审批点
- Fanout 节点

### 第三层：受约束的 Orchestrator 动态细化

允许 Orchestrator：

- 选择模板
- 填模板参数
- 生成候选图分支
- 细化某个节点内部拆分方式

但不允许：

- 自由定义新的工作流语言
- 自由赋予节点任意权限
- 绕过模板验证
- 直接改运行真相状态

## 6.3 关键原则

### 原则 1：模板不直接执行

模板不能直接执行，必须先编译成 `Run Plan`。

### 原则 2：Run Plan 才是执行真相

执行层永远只执行编译后的 `Run Plan`。

### 原则 3：Orchestrator 只能提案，不能直接生效

LLM 可以提候选 DAG 或候选分支，但必须经过：

- Schema 校验
- Policy 校验
- Capability 校验
- 编译器确认

## 7. Agent Profile 与 Skill 模型

## 7.1 为什么要引入 Agent Profile

`OpenClaw Agent` 和 `My Mate Agent Profile` 不能完全等同。

原因：

- `OpenClaw Agent` 偏 Runtime 实体
- `My Mate Agent Profile` 偏产品编排语义

举例：

- `backend`
- `review`
- `devops`
- `tester`
- `research_worker`
- `content_worker`

其中后两者可能最终映射到 OpenClaw 中相同内核 Agent，但产品语义不同。

## 7.2 Skill 控制原则

Skill 不能完全由 LLM 自由选择。

建议采用三层约束：

- 平台定义默认 Skill Allowlist
- 模板缩小可用 Skill 范围
- Run 可在允许范围内进一步裁剪

这样可以做到：

- 有动态性
- 但可审计、可控、可收敛

## 8. 关键运行流程

## 8.1 手机发起任务

流程：

1. 用户在手机端输入意图
2. 手机端发送 `CreateRunRequest`
3. BFF 鉴权并注入用户/工作区上下文
4. Control Plane 选择模板或调用 Planner 提议模板
5. Control Plane 编译 `Run Plan`
6. 验证器校验
7. Run 持久化
8. 调度器激活可运行节点
9. Adapter 派发给 OpenClaw
10. OpenClaw 执行并回传
11. Control Plane 写事件
12. 手机端收到通知/实时状态

## 8.2 运行中干预

触发条件：

- 等待审批
- 等待人工补充输入
- 节点失败建议重试
- 运行被阻塞

用户在手机端可执行：

- approve
- reject
- add_input
- pause
- resume
- retry_node
- cancel_run

## 8.3 PC 端配置模板

流程：

1. Builder 在 PC 端创建模板
2. 配置节点和边
3. 绑定 Agent Profile 和 Skill
4. 设定 Gate/Retry/Timeout/Parallelism
5. 模板校验
6. 发布新版本

## 9. 状态、事件、产物、通知

## 9.1 状态模型

### Run 状态

- `draft`
- `queued`
- `running`
- `waiting_human`
- `paused`
- `blocked`
- `completed`
- `failed`
- `cancelled`

### Node 状态

- `pending`
- `ready`
- `running`
- `waiting_human`
- `completed`
- `failed`
- `skipped`
- `cancelled`

## 9.2 事件模型

事件至少包括：

- `run.created`
- `run.started`
- `node.started`
- `node.progress`
- `node.completed`
- `node.failed`
- `approval.requested`
- `approval.granted`
- `human_input.requested`
- `run.blocked`
- `run.completed`

## 9.3 产物模型

产物包括：

- 文档
- 报告
- 差异补丁
- 测试结果
- 输出摘要
- 附件

## 9.4 通知策略

移动端通知应重点覆盖：

- 任务开始
- 等待你审批
- 等待你输入
- 任务被阻塞
- 任务完成
- 任务失败

## 10. 安全与治理

## 10.1 权限边界

客户端不能：

- 直接修改底层 YAML/Task Store
- 直接触发高危工具
- 直接绕过审批

Control Plane 才能：

- 修改 Run 状态
- 决定节点转移
- 接受或拒绝 Planner 候选图

OpenClaw 只负责：

- 执行
- 报告

## 10.2 审批模型

至少支持：

- 人工 Review
- Prod 发布审批
- 高风险工具审批
- 成本/预算超额审批

## 10.3 审计模型

必须可追踪：

- 谁创建了 Run
- 谁批准了什么
- 谁暂停/恢复/取消了什么
- 哪个模型生成了候选计划
- 哪个版本的模板与校验器最终放行

## 11. 技术选型建议

### 客户端

- `React Native` 或 `Flutter`

### BFF / API 层

- 推荐 `TypeScript / Node.js`

### Control Plane

- 推荐 `TypeScript` 为主
- 必要时调用 Python Adapter 复用已有 OpenClaw 周边脚本

### 数据存储

推荐：

- `Postgres`：模板、Run、Node、审批、事件索引
- `Object Storage` 或本地文件存储：产物
- `Redis`：推送会话、实时事件广播、短期缓存

## 12. 实施建议

落地顺序建议：

1. 先搭 `Control Plane + Mobile API`
2. 再搭 `Template/RunPlan` 模型
3. 再做 `OpenClaw Adapter`
4. 再做 `PC Workflow Studio`
5. 最后做 `Planner-Assisted DAG Specialization`

## 13. 最终建议

`My Mate` 应该被做成：

- 一个独立的新项目
- 一个工作流控制产品
- 一个移动端协同入口
- 一个建立在 OpenClaw 之上的平台层

不要把 `My Mate` 做成“有手机界面的 OpenClaw”。

更准确的做法是：

- `OpenClaw` 提供执行能力
- `My Mate` 提供产品能力

这也是后续可持续演进、可配置 DAG、可引入 Planner、可做多业务模板的正确方向。

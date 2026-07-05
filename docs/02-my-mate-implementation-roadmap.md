# My Mate 技术实施路线图 / Milestone

## 1. 目标

本文定义 `My Mate` 的实施顺序、阶段目标、交付物和验收标准。

目标是避免一开始同时重做：

- Mobile
- DAG 引擎
- OpenClaw Runtime
- Workflow Studio

正确策略是：

- 先把控制层立起来
- 再把工作流模板化
- 再把 OpenClaw 适配做实
- 最后做 Studio 和 Planner 动态化

## 2. 实施原则

1. 先做控制层，再做 DAG 灵活性
2. 先做模板化，再做 LLM 动态生成
3. 先做可用闭环，再做复杂泛化
4. 先保留 OpenClaw 内核，再决定是否需要更深改造

## 3. 总体里程碑

建议分为 6 个 Milestone。

---

## Milestone 0：项目初始化与边界冻结

### 目标

明确 `My Mate` 与 `OpenClaw` 的边界。

### 范围

- 建立 `My Mate` 独立仓库结构
- 明确模块边界
- 决定数据存储策略
- 定义 Control Plane 基础目录结构

### 交付物

- 项目目录结构
- 架构设计文档
- 技术路线图
- 初版 Schema/API 草案

### 验收标准

- 团队对边界达成一致
- 明确不直接改老项目主流程
- 明确新项目如何接 OpenClaw

---

## Milestone 1：Mobile Control API MVP

### 目标

先把手机协同的最小闭环打通。

### 用户能力

- 手机创建任务
- 手机查看任务列表
- 手机查看任务详情
- 手机暂停/恢复/取消

### 后端能力

- 用户鉴权
- Run CRUD 基础能力
- Event Timeline 查询
- 基础状态机

### 技术范围

- `BFF/API Server`
- `Run Store`
- `Event Store`
- 简化的通知接口

### 暂不做

- 可配置 DAG
- Planner 动态图
- PC Studio
- 复杂审批

### 交付物

- `/runs` API
- `/runs/{id}` API
- `/runs/{id}/actions/*`
- `/api/mobile/home`
- `/api/mobile/inbox`
- `/api/mobile/runs/{id}/follow-up`
- Run/Event 数据表
- 基础移动端页面原型
- Mobile App Shell（Home / Inbox / Follow-up）

### 验收标准

- 用户能在手机端发一个任务
- 后端能创建一条 Run
- 用户能看到状态变化
- 用户能执行 pause/resume/cancel
- 用户能在手机首页看到焦点 Run 和待处理数量
- 用户能在手机 Inbox 处理 approval / human input

---

## Milestone 2：OpenClaw Execution Adapter MVP

### 目标

让 `My Mate` 能驱动 OpenClaw 真正执行。

### 用户能力

- 手机发起任务后，后台会真正运行
- 能看到 OpenClaw 执行带来的进度和结果

### 技术范围

- `Execution Adapter`
- Node Dispatch Envelope
- Agent Report 标准化
- Artifact 映射
- OpenClaw Task/Session 关联

### 建议实现方式

- 先固定少量 Agent Profile：
  - `architect`
  - `backend`
  - `review`
  - `tester`
  - `devops`

- 先支持少量 Node Type：
  - `agent_task`
  - `approval`
  - `notify`
  - `end`

### 交付物

- Adapter 模块
- OpenClaw dispatch contract
- Report normalizer
- Artifact bridge

### 验收标准

- 一个 My Mate Run 能驱动至少 1 个 OpenClaw Agent 执行
- 产物能回到 My Mate
- 错误/阻塞能被标准化回传

---

## Milestone 3：Template + Run Plan 引擎

### 目标

从“固定流程”升级为“模板驱动流程”。

### 用户能力

- 用户创建 Run 时可以选择模板
- 模板可传参数
- 系统根据模板生成 Run Plan

### 技术范围

- Template Registry
- Template Versioning
- Template Validator
- Run Plan Compiler
- Node Scheduler

### 先支持的能力

- 有向无环图
- 简单顺序边
- Fanout
- Approval Node
- Retry Policy
- Timeout Policy

### 暂不做

- 自由循环图
- 任意自定义 Node Type
- Planner 动态生成完整 DAG

### 交付物

- Template Schema
- Run Plan Schema
- Graph Validator
- Compiler
- Node readiness evaluator

### 验收标准

- 至少 3 个模板可运行
- 模板能稳定编译成 Run Plan
- 能驱动 OpenClaw 跑完整个图

---

## Milestone 4：Intervention / Approval / Notification 完整化

### 目标

把“协同”和“控制”做完整。

### 用户能力

- 手机审批
- 手机补充输入
- 手机收到等待操作通知
- 手机对失败节点重试
- 手机对某个节点单独取消

### 技术范围

- Approval Engine
- Human Input Node
- Push Notification
- WebSocket / SSE
- Intervention Audit

### 交付物

- `approval.requested / granted / rejected`
- `human_input.requested / submitted`
- Push 服务接入
- 通知偏好设置
- Mobile 干预闭环页面完善
  - approval action sheet
  - human input submit form
  - follow-up timeline refresh

### 验收标准

- Run 卡在审批时，手机能收到通知
- 用户审批后，图能继续跑
- 用户补充输入后，节点能恢复执行

---

## Milestone 5：PC Workflow Studio

### 目标

让模板配置从代码/YAML 迁移到可视化管理。

### 用户能力

- 创建模板
- 编辑 DAG
- 配置节点
- 绑定 Agent Profile / Skills
- 发布模板版本

### 技术范围

- Visual Graph Editor
- Template Draft / Publish
- Validation UI
- Simulation / Preview

### 交付物

- 模板管理页面
- DAG 编辑器
- 校验结果页
- 发布流程

### 验收标准

- 非研发也能完成基础模板配置
- 模板发布后能直接被手机端使用

---

## Milestone 6：Planner-Assisted Workflow Specialization

### 目标

在模板约束内引入 LLM 的业务级动态化能力。

### 用户能力

- 直接输入业务意图
- 系统自动推荐模板
- 系统自动补全参数
- 系统自动生成候选图分支/节点策略

### 技术范围

- Template Selector
- Planner Prompting
- Candidate Graph Generation
- Policy/Schema Validation
- Run Plan Finalizer

### 核心约束

Planner 只能：

- 选模板
- 补参数
- 生成候选结构
- 调整受限并发/分支

Planner 不能：

- 发明新节点类型
- 绕过 Skill/Agent 权限
- 直接生效 Run 状态

### 交付物

- Planner Service
- Candidate Plan Validator
- Fallback 策略

### 验收标准

- 针对典型业务意图，系统能生成可执行候选计划
- 候选计划校验可通过
- 不会突破权限边界

## 4. 推荐团队分工

### 产品/架构

- 模板模型
- 人工干预模型
- 审批与治理模型
- 交互流

### 后端

- Control Plane
- BFF/API
- State/Event/Artifact 存储
- OpenClaw Adapter

### 客户端

- Mobile App
- Workflow Studio

### 平台/运维

- OpenClaw 运行环境
- Push/实时链路
- 日志/监控/告警

## 5. 推荐落地顺序

最推荐的顺序是：

1. `M0`
2. `M1`
3. `M2`
4. `M3`
5. `M4`
6. `M5`
7. `M6`

原因：

- M1 先解决“能不能用”
- M2 解决“能不能真跑”
- M3 解决“能不能不写死”
- M4 解决“能不能协同”
- M5 解决“能不能规模化配置”
- M6 才解决“能不能智能生成”

## 6. 关键风险

### 风险 1：过早做动态图生成

问题：

- 业务看起来很酷
- 但平台会很快失控

策略：

- 先模板化
- 再受约束动态化

### 风险 2：过早重做 OpenClaw 内核

问题：

- 时间成本高
- 维护成本高
- 容易重复造轮子

策略：

- 先通过 Adapter 利用现有能力

### 风险 3：把移动端做成“只会看状态”

问题：

- 协同价值不够

策略：

- M4 必须把审批、补充输入、重试、暂停做完整

### 风险 4：模板模型不收敛

问题：

- 自定义程度太高
- Studio 和执行器都很复杂

策略：

- 先限制 Node Type 集合
- 先支持 DAG，不支持通用图

## 7. 第一阶段最小闭环建议

如果只做一个最小闭环，我建议：

- Mobile 创建 Run
- Run 调用 OpenClaw 跑一个 `agent_task`
- 返回 progress / artifact
- Mobile 能 pause / resume / cancel

只要这个闭环跑通，后面 DAG、模板、Studio 都是叠加。

## 8. 最终建议

`My Mate` 不应该一开始就追求“全能智能编排平台”。

正确路径是：

- 先建立稳定控制层
- 再建立模板能力
- 再建立可视化配置
- 最后再加智能生成

这是成本最低、演进最稳、最适合独立新项目的路线。

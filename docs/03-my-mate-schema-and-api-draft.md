# My Mate Template Schema / Run Plan Schema / API 草案

## 1. 文档目标

本文给出 `My Mate` 第一版可落地的数据结构和 API 草案。

范围包括：

- Template Schema
- Run Plan Schema
- Agent Profile Schema
- Event Schema
- API 草案

本文重点是：

- 先定义稳定边界
- 不求一次穷尽
- 优先支撑 Milestone 1~4

## 2. 设计原则

1. 模板是声明式的
2. Run Plan 是执行真相
3. Event 是移动端消费真相
4. OpenClaw 适配信息必须显式记录
5. 任何动态行为都必须落入受限 Schema

## 3. Workflow Template Schema

## 3.1 顶层结构

```json
{
  "template_id": "software_delivery_v2",
  "version": 1,
  "name": "软件交付完整流程",
  "status": "draft",
  "description": "从需求到测试环境部署的完整交付流程",
  "workspace_scope": "default",
  "input_schema": {},
  "policy": {},
  "agent_profile_bindings": {},
  "nodes": [],
  "edges": [],
  "metadata": {},
  "created_at": "2026-06-06T00:00:00Z",
  "updated_at": "2026-06-06T00:00:00Z",
  "published_at": null
}
```

## 3.2 顶层字段定义

| 字段 | 类型 | 说明 |
|---|---|---|
| `template_id` | string | 模板唯一标识 |
| `version` | integer | 模板版本 |
| `name` | string | 模板名 |
| `status` | enum | `draft/published/archived` |
| `description` | string | 模板描述 |
| `workspace_scope` | string | 适用工作区 |
| `input_schema` | object | 用户输入参数约束 |
| `policy` | object | 模板级策略 |
| `agent_profile_bindings` | object | Profile 别名绑定 |
| `nodes` | array | 节点列表 |
| `edges` | array | 边列表 |
| `metadata` | object | 标签/分类等 |

## 3.3 input_schema

建议沿用 JSON Schema 子集。

示例：

```json
{
  "type": "object",
  "required": ["goal"],
  "properties": {
    "goal": {
      "type": "string",
      "title": "目标"
    },
    "project_slug": {
      "type": "string"
    },
    "urgency": {
      "type": "string",
      "enum": ["low", "normal", "high"]
    }
  }
}
```

## 3.4 policy

模板级策略建议：

```json
{
  "max_parallel_nodes": 6,
  "default_timeout_seconds": 1800,
  "budget_policy": {
    "max_openclaw_dispatches": 20
  },
  "approval_policy": {
    "require_human_for": ["prod_release"]
  }
}
```

## 3.5 Node Schema

```json
{
  "id": "implement",
  "name": "实现",
  "type": "agent_task",
  "agent_profile": "backend",
  "allowed_skills": ["coding-agent", "github"],
  "config": {},
  "retry_policy": {
    "max_attempts": 2,
    "backoff_seconds": 30
  },
  "timeout_seconds": 1800,
  "parallelism": 1,
  "approval_kind": null,
  "human_input_schema": null
}
```

### Node 字段说明

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 节点 ID |
| `name` | string | 节点名 |
| `type` | enum | 节点类型 |
| `agent_profile` | string/null | 绑定的 Agent Profile |
| `allowed_skills` | string[] | 本节点允许的 Skill |
| `config` | object | 节点配置 |
| `retry_policy` | object | 重试策略 |
| `timeout_seconds` | int | 超时 |
| `parallelism` | int | 节点并发 |
| `approval_kind` | string/null | 审批类型 |
| `human_input_schema` | object/null | 等待人工输入的结构 |

## 3.6 Node Type 建议

第一版只支持以下 Node Type：

- `planner`
- `agent_task`
- `tool_task`
- `fanout`
- `reducer`
- `approval`
- `human_input`
- `notify`
- `condition`
- `end`

## 3.7 Edge Schema

```json
{
  "from": "implement",
  "to": "review",
  "condition": null,
  "label": "完成后进入审查"
}
```

## 4. Agent Profile Schema

## 4.1 顶层结构

```json
{
  "profile_id": "backend",
  "name": "Backend",
  "description": "通用后端执行角色",
  "openclaw_agent_id": "backend",
  "default_skills": ["coding-agent", "github"],
  "allowed_tools": ["read", "write", "shell"],
  "disallowed_skills": ["prod-deploy"],
  "policy_tags": ["code", "repo-write"]
}
```

## 4.2 设计说明

这里要注意：

- `Agent Profile` 是平台语义
- `openclaw_agent_id` 是内核映射

多个 Profile 可以映射到同一个 `openclaw_agent_id`，但策略不同。

## 5. Run Plan Schema

## 5.1 顶层结构

```json
{
  "run_id": "run_20260606_001",
  "template_id": "software_delivery_v2",
  "template_version": 1,
  "workspace_id": "default",
  "requested_by": "user_123",
  "intent": "帮我完成这个需求并部署到测试环境",
  "inputs": {},
  "compiled_nodes": [],
  "edges": [],
  "frontier": [],
  "policy_snapshot": {},
  "planner_context": {},
  "status": "queued",
  "created_at": "2026-06-06T00:00:00Z"
}
```

## 5.2 compiled_nodes

```json
[
  {
    "node_run_id": "node_001",
    "node_id": "implement",
    "name": "实现",
    "type": "agent_task",
    "agent_profile": "backend",
    "openclaw_agent_id": "backend",
    "allowed_skills": ["coding-agent", "github"],
    "allowed_tools": ["read", "write", "shell"],
    "status": "ready",
    "retry_policy": {
      "max_attempts": 2,
      "attempt": 0
    },
    "timeout_seconds": 1800,
    "parallelism_budget": 1,
    "input_payload": {},
    "output_contract": {
      "expected_artifacts": ["TECH_DESIGN.md", "TEST_CASES.md"]
    },
    "execution_ref": {
      "openclaw_task_id": null,
      "openclaw_session_id": null
    }
  }
]
```

## 5.3 frontier

`frontier` 表示当前可调度节点。

示例：

```json
["node_001", "node_002"]
```

## 5.4 planner_context

用于记录 LLM 介入信息：

```json
{
  "template_selected_by": "planner",
  "planner_model": "gpt-5.5",
  "candidate_hash": "abc123",
  "validation_passed": true
}
```

## 6. Run State Schema

## 6.1 Run 状态

```json
{
  "run_id": "run_20260606_001",
  "status": "running",
  "current_summary": "实现节点运行中",
  "waiting_reason": null,
  "blocked_reason": null,
  "started_at": "2026-06-06T00:01:00Z",
  "finished_at": null,
  "last_event_id": "evt_123"
}
```

状态枚举：

- `draft`
- `queued`
- `running`
- `waiting_human`
- `paused`
- `blocked`
- `completed`
- `failed`
- `cancelled`

## 6.2 Node Run 状态

```json
{
  "node_run_id": "node_001",
  "run_id": "run_20260606_001",
  "status": "running",
  "progress": {
    "percent": 40,
    "message": "Code changes in progress",
    "updated_at": "2026-06-06T00:10:00Z"
  },
  "attempt": 1,
  "started_at": "2026-06-06T00:02:00Z",
  "finished_at": null
}
```

Node 状态枚举：

- `pending`
- `ready`
- `running`
- `waiting_human`
- `completed`
- `failed`
- `skipped`
- `cancelled`

## 7. Event Schema

## 7.1 顶层结构

```json
{
  "event_id": "evt_123",
  "run_id": "run_20260606_001",
  "node_run_id": "node_001",
  "type": "node.progress",
  "actor_type": "agent",
  "actor_id": "backend",
  "payload": {},
  "created_at": "2026-06-06T00:10:00Z"
}
```

## 7.2 建议事件类型

- `run.created`
- `run.queued`
- `run.started`
- `run.paused`
- `run.resumed`
- `run.cancelled`
- `run.blocked`
- `run.completed`
- `run.failed`
- `node.ready`
- `node.started`
- `node.progress`
- `node.completed`
- `node.failed`
- `approval.requested`
- `approval.granted`
- `approval.rejected`
- `human_input.requested`
- `human_input.submitted`
- `artifact.created`

## 8. Artifact Schema

```json
{
  "artifact_id": "art_001",
  "run_id": "run_20260606_001",
  "node_run_id": "node_001",
  "type": "document",
  "name": "TECH_DESIGN.md",
  "storage_uri": "s3://.../TECH_DESIGN.md",
  "mime_type": "text/markdown",
  "size_bytes": 10240,
  "created_at": "2026-06-06T00:12:00Z"
}
```

## 9. API 草案

## 9.1 鉴权

建议：

- 用户登录后获得 JWT / Session Token
- 所有 API 带 `Authorization: Bearer ...`

---

## 9.2 Template APIs

### 创建模板

`POST /api/templates`

Request:

```json
{
  "name": "软件交付完整流程",
  "description": "从需求到测试的完整流程",
  "input_schema": {},
  "policy": {},
  "nodes": [],
  "edges": []
}
```

Response:

```json
{
  "template_id": "software_delivery_v2",
  "version": 1,
  "status": "draft"
}
```

### 获取模板列表

`GET /api/templates`

### 获取模板详情

`GET /api/templates/{template_id}`

### 更新模板草稿

`PUT /api/templates/{template_id}`

### 发布模板版本

`POST /api/templates/{template_id}/publish`

---

## 9.3 Run APIs

### 创建 Run

`POST /api/runs`

Request:

```json
{
  "intent": "帮我完成这个需求并部署到测试环境",
  "template_id": "software_delivery_v2",
  "inputs": {
    "goal": "完成某项需求",
    "project_slug": "my-project"
  }
}
```

Response:

```json
{
  "run_id": "run_20260606_001",
  "status": "queued"
}
```

### 获取 Run 列表

`GET /api/runs`

支持参数：

- `status`
- `template_id`
- `workspace_id`
- `requested_by`

### 获取 Run 详情

`GET /api/runs/{run_id}`

### 获取 Run 时间线

`GET /api/runs/{run_id}/events`

### 获取 Run 产物

`GET /api/runs/{run_id}/artifacts`

---

## 9.4 Intervention APIs

### 暂停

`POST /api/runs/{run_id}/actions/pause`

### 恢复

`POST /api/runs/{run_id}/actions/resume`

### 取消

`POST /api/runs/{run_id}/actions/cancel`

### 重试节点

`POST /api/runs/{run_id}/nodes/{node_run_id}/actions/retry`

### 跳过节点

`POST /api/runs/{run_id}/nodes/{node_run_id}/actions/skip`

---

## 9.5 Approval APIs

### 获取待审批项

`GET /api/approvals`

### 审批通过

`POST /api/approvals/{approval_id}/approve`

Request:

```json
{
  "comment": "可以继续"
}
```

### 审批拒绝

`POST /api/approvals/{approval_id}/reject`

Request:

```json
{
  "comment": "请先补充风险说明"
}
```

---

## 9.6 Human Input APIs

### 获取待输入项

`GET /api/human-inputs`

### 提交输入

`POST /api/human-inputs/{input_request_id}/submit`

Request:

```json
{
  "payload": {
    "answer": "选择方案 B"
  }
}
```

---

## 9.7 Realtime APIs

### WebSocket

`GET /ws`

用途：

- 接收 run 更新
- 接收 approval 通知
- 接收 human_input 请求

### SSE 备选

`GET /api/runs/{run_id}/stream`

---

## 9.8 Planner APIs

### 让系统推荐模板

`POST /api/planner/template-selection`

Request:

```json
{
  "intent": "帮我调研竞争对手并输出总结"
}
```

### 让系统生成候选 Run Plan

`POST /api/planner/candidate-plan`

Request:

```json
{
  "intent": "帮我调研竞争对手并输出总结",
  "template_id": "research_summary_v1",
  "inputs": {}
}
```

Response:

```json
{
  "candidate_plan": {},
  "validation": {
    "passed": true,
    "warnings": []
  }
}
```

## 10. OpenClaw Adapter API 草案

Control Plane 到 Adapter 的内部接口建议：

### DispatchNode

```json
{
  "run_id": "run_20260606_001",
  "node_run_id": "node_001",
  "node_type": "agent_task",
  "agent_profile": "backend",
  "openclaw_agent_id": "backend",
  "allowed_skills": ["coding-agent", "github"],
  "allowed_tools": ["read", "write", "shell"],
  "goal": "实现某功能",
  "timeout_seconds": 1800,
  "input_payload": {}
}
```

### AdapterResult

```json
{
  "dispatch_id": "disp_001",
  "openclaw_task_id": "architect-task-backend-20260606120000-abc123",
  "openclaw_session_id": "sess_001",
  "status": "accepted"
}
```

### ReportNormalized

```json
{
  "run_id": "run_20260606_001",
  "node_run_id": "node_001",
  "status": "running",
  "progress": {
    "percent": 50,
    "message": "halfway done"
  },
  "artifacts": [],
  "raw_ref": {
    "openclaw_task_id": "architect-task-backend-20260606120000-abc123"
  }
}
```

## 11. 第一版必须保持的约束

第一版必须坚持：

1. 节点类型集合是封闭的
2. Agent Profile 必须显式映射到 OpenClaw Agent
3. Skill 必须走 allowlist
4. Planner 不能绕过校验器
5. Run 状态只能由 Control Plane 修改
6. 手机端只能发意图和干预命令

## 12. 下一步建议

建议按下面顺序继续收敛：

1. 把这份 Schema 落为正式 JSON Schema / Zod 定义
2. 先实现 `Run API + Event API`
3. 再实现 `Template Registry + Compiler`
4. 再实现 `OpenClaw Adapter`

这样能最快把 `My Mate` 从文档推进到骨架工程。

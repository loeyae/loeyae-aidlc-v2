---
slug: tdd
number: "3.5"
name: RED 测试门禁
phase: construction
axis: unit
execution: ALWAYS
lead_agent: aidlc-developer-agent
support_agents: []
mode: inline
scopes: [feature, enterprise, mvp, classic, express, workshop, bugfix, refactor]
consumes:
  - docs/aidlc/modules/{module-id}/inception/application-design/test-cases/
  - .aidlc/evidence/test-case-derivation/{module-id}/test-case-derivation.json
produces:
  - .aidlc/evidence/tdd/{module-id}/{unit-id}/red-test-evidence.json
  - .aidlc/evidence/tdd/{module-id}/{unit-id}/baseline-test-evidence.json
sensors: [red-test-evidence, baseline-test-evidence]
traceability: not_applicable
requires: [test-case-derivation]
---

# RED 测试门禁（原 TDD 阶段）

本阶段位于 GREEN 代码生成之前，负责把 I13 的 UC-D 转换为真实测试，并由受控命令观察测试因目标行为尚未实现而失败。生产代码不得在本阶段前置生成；GREEN 由 `code-generation` 阶段负责。

纯声明、纯样式或纯配置等无可执行业务行为的单元，必须消费 I13 的结构化 `not_applicable`/豁免证据，并执行其中声明的确定性替代验证；不得通过省略测试或文字说明静默跳过。

## 本阶段完成标准

- I13 的 `test-case-derivation.json` 已通过并明确为 `required` 或结构化 `not_applicable`
- `required` 时，真实测试已生成，至少关联一个 ready UC-D，且受控 RED 命令以 `failure_class: behavior` 失败
- RED 失败的 `compile_status` 和 `environment_status` 均为 `passed`，不能由编译、环境或命令错误充当 RED
- `not_applicable` 时，必须有非适用理由、批准依据和确定性替代验证
- 只有本阶段证据通过，GREEN 代码生成阶段才可进入

## 铁律

```
没有受控 RED 证据，就没有 GREEN 生产代码。
```

测试失败后不要在本阶段实现生产行为；实现动作统一进入 `code-generation`。

---

## 用例点溯源铁律

```
每个测试必须标注它对应哪个测试用例点。
没有 @TestCaseId 的测试 = 不知所云的测试。
```

**规则**：
- 每个新增/修改的公共方法，其测试**必须**关联到 `docs/aidlc/modules/{module-id}/inception/application-design/test-cases/` 中的某个 UC-D-xxx
- 关联方式：测试方法名或注解/标签携带用例点编号

**后端示例**（Java/Kotlin）：
```java
@Tag("UC-D-003")  // JUnit 5 原生标签，或自定义 @TestCaseId 注解
@Test
void shouldRejectRequestWhenQuotaExceeded() {
    // ...
}
```

**前端示例**（TypeScript/JavaScript）：
```typescript
describe('UC-D-003 超出配额拒绝请求', () => {
  it('超过限额时返回拒绝', () => { ... })
})
```

**为什么强制**：
- Construction 末尾对账（见 `construction-code-review.md` 全局审查）要校验"每个 UC-D 都有对应测试且通过"，没有标记就无法校验
- 没有溯源的测试回答"代码做了什么"，有溯源的测试回答"产品要的有没有被验证"——这是本质区别

**豁免**（需用户明确许可）：纯重构不新增行为、纯配置文件。豁免时必须在审计文件记录"本测试无 UC-D 关联，理由：XXX"。

**违反处理**：测试没有用例点标记 = 红旗信号，按"跳过 TDD"同等处理——补标记或删除测试重写。

---

## 适用时机

### 共享契约基线的声明型物化（条件）

`construction-shared-contract-baseline.md` 允许的纯声明型物化（接口、抽象成员、DTO、枚举、机器契约生成类型及必要元数据）不单独要求 RED 测试，但必须完成该规则要求的实际编译、结构、序列化、Schema 或兼容性验证及双轴审查。

一旦声明包含默认方法、构造器或静态方法中的业务逻辑，或涉及数据访问、网络调用、状态转换等可执行行为，即必须完成本阶段 RED 门禁并移交 `code-generation` 执行 GREEN。该条件不构成对任何业务代码的 TDD 豁免。

**始终适用：**
- 新功能
- Bug 修复
- 重构
- 行为变更

**豁免场景（需用户明确许可）：**
- 一次性原型
- 纯配置文件
- 生成的代码（如 ORM 迁移脚本）
- 纯 UI 样式调整（无逻辑）

想着"就这一次跳过 TDD"？停下来。那是合理化。除非属于上述豁免场景，否则回到铁律。

---

## RED 门禁与 GREEN 阶段移交

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│   RED ──→ 验证失败 ──→ GREEN ──→ 验证通过 ──→ REFACTOR │
│    ↑         │            ↑         │            │      │
│    │     错误失败          │     未通过           │      │
│    │         │            │         │            │      │
│    │         ↓            │         ↓            │      │
│    │      修正测试         │      修正代码         │      │
│    │                      │                      │      │
│    └──────────────────────┴──────────────────────┘      │
│                      下一个测试                          │
└─────────────────────────────────────────────────────────┘
```

### RED — 写失败测试

写一个最小的真实测试，展示期望的行为，并标注对应 UC-D。测试必须在生产代码实现前编写；随后通过受控 RED 命令运行，并输出机器可读观察对象。

**好的测试：**
```java
@Test
void shouldRejectEmptyEmail() {
    var request = new CreateUserRequest("", "password123");

    var result = userService.createUser(request);
    
    assertThat(result.getErrors()).contains("邮箱不能为空");
}
```
清晰的名称，测试真实行为，只测一件事。

**坏的测试：**
```java
@Test
void testCreate() {
    when(mockRepo.save(any())).thenReturn(new User());
    userService.createUser(request);
    verify(mockRepo).save(any());
}
```
模糊的名称，测试 mock 而非代码。

### 验证 RED — 受控失败

**强制执行。绝不跳过。**

运行 `evidence run --stage tdd --sensor red-test-evidence`。受控命令必须输出一个 JSON 对象，至少包含：

```json
{
  "phase": "RED",
  "status": "failed",
  "failure_class": "behavior",
  "failure_signature": "明确的行为断言失败摘要",
  "compile_status": "passed",
  "environment_status": "passed",
  "tests_total": 1,
  "tests_failed": 1,
  "traceability_complete": true,
  "uc_mapping": [{"use_case": "UC-D-001", "test_methods": ["ExampleTest#expectedBehavior"]}]
}
```

退出码、失败分类和测试计数均由 evidence producer 复核；编译失败、环境失败、命令找不到或缺少结构化观察对象均不构成 RED。

测试通过了？说明没有观察到目标行为缺失，RED 门禁失败。测试报错了？修正测试或环境后重跑，直到得到明确的行为断言失败。

### GREEN 与 REFACTOR

本阶段不执行 GREEN 或生产代码实现。完成 RED 门禁后，`code-generation` 必须消费本阶段证据，写最少生产代码并运行 GREEN 命令；只有 GREEN 证据通过后才可进入代码审查。重构也只能在 GREEN 之后进行，并由代码生成阶段和后续审查/构建阶段验证。

### 验证 GREEN — code-generation 负责

GREEN 命令和测试分层策略由 `construction-code-generation.md` 的 GREEN 阶段与 `common-test-execution-strategy.md` 共同定义；本阶段不再把 GREEN 通过写入 RED 证据。

### REFACTOR — 清理

仅在 GREEN 之后：
- 消除重复
- 改善命名
- 提取辅助方法

保持测试绿色。不添加行为。

### 重复

下一个失败测试，下一个功能。

---

## 与 AI-DLC Construction 阶段的集成

### 快速模式下的 RED 门禁

快速模式只能压缩计划、审计和说明文档，不能改变阶段顺序或删减证据：

```
I13（UC-D 或结构化豁免）
  → RED（真实测试 + 受控行为失败）
  → GREEN（代码生成 + 目标测试通过）
  → 代码审查
  → 构建与测试
```

禁止 Code-First、先写生产代码后补测试、跳过失败观察或以“同一交互内补测试”替代 RED。纯声明/样式/配置例外必须通过 I13 `not_applicable` 记录和确定性替代验证。

---

### 代码生成计划中的 TDD 规划

在 `construction-code-generation.md` 的规划阶段，代码生成计划必须包含：

```markdown
### 单元 X 的 TDD 执行序列

| 序号 | 测试（RED） | 实现（GREEN） | 验证命令 |
|------|------------|--------------|----------|
| 1 | 测试：创建用户时邮箱不能为空 | UserService.createUser 邮箱校验 | mvn test -Dtest=UserServiceTest#shouldRejectEmptyEmail |
| 2 | 测试：创建用户成功返回用户ID | UserService.createUser 正常流程 | mvn test -Dtest=UserServiceTest#shouldReturnUserIdOnSuccess |
| ... | ... | ... | ... |
```

### 执行顺序

> **测试执行策略**：参见 `common-test-execution-strategy.md`

```
对每个单元：
  1. I13 生成或确认 UC-D 以及结构化适用性/豁免状态
  2. 本阶段 RED：写真实测试，运行受控命令并确认行为断言失败
  3. code-generation GREEN：消费 RED 证据，写最少生产代码，运行目标测试和模块回归
  4. GREEN 通过后进入代码审查
  5. 代码审查通过后进入构建与测试
```

GREEN 测试不得回写为 RED 通过；两个阶段必须分别保留可机读证据。

---

## 前后端 TDD 差异

### 后端（Java / Spring Boot）

**测试框架**：JUnit 5 + Mockito + AssertJ

**测试层次**：
- 单元测试：Service 层业务逻辑
- 集成测试：Controller 层 + Repository 层
- 契约测试：API 接口契约

**运行命令**：
```bash
# 单个测试
mvn test -pl module-name -Dtest=ClassName#methodName

# 模块所有测试
mvn test -pl module-name

# 全量测试
mvn test
```

### 前端（Vue 3 / TypeScript）

**测试框架**：Vitest + Vue Test Utils + Testing Library

**测试层次**：
- 单元测试：Composables、Utils、Store
- 组件测试：Vue 组件渲染和交互
- E2E 测试：关键用户流程（Playwright）

**运行命令**：
```bash
# 单个测试
pnpm test -- --run path/to/test.spec.ts

# 所有测试
pnpm test -- --run

# 带覆盖率
pnpm test -- --run --coverage
```

### 不适用 TDD 的场景（需用户许可）

| 场景 | 原因 | 替代方案 |
|------|------|----------|
| 纯 CSS/样式调整 | 无逻辑可测 | 视觉回归测试（如有） |
| 配置文件 | 声明式，无行为 | 验证配置加载 |
| 数据库迁移脚本 | 生成代码 | 迁移后验证数据完整性 |
| 第三方 SDK 集成胶水代码 | 测试第三方行为无意义 | 集成测试验证连通性 |

---

## 常见合理化与反驳

| 借口 | 现实 |
|------|------|
| "太简单了不需要测试" | 简单代码也会出 bug。测试只需 30 秒。 |
| "我先写完再补测试" | 后补的测试立即通过，证明不了任何东西。 |
| "后补测试也能达到同样目的" | 后补测试回答"这段代码做了什么？"。先写测试回答"这段代码应该做什么？"。两者本质不同。 |
| "已经手动测试过了" | 手动测试是临时的。没有记录，不能重跑。 |
| "删掉 X 小时的工作太浪费了" | 沉没成本谬误。保留未经验证的代码才是技术债。 |
| "保留作为参考" | 你会"适配"它。那就是后补测试。删除意味着删除。 |
| "需要先探索" | 可以。探索完后丢弃探索代码，用 TDD 重新开始。 |
| "测试太难写 = 不需要测试" | 测试难写 = 设计有问题。听从测试的反馈，简化接口。 |
| "TDD 会拖慢我" | TDD 比调试更快。务实 = 先写测试。 |
| "现有代码没有测试" | 你在改进它。为你修改的部分添加测试。 |

---

## 红旗信号 — 停止并重新开始

- 在测试之前写了代码
- 实现之后才写测试
- 测试立即通过
- 无法解释测试为什么失败
- 测试"稍后再加"
- 合理化"就这一次"
- "我已经手动测试过了"
- "后补测试也能达到同样目的"
- "保留作为参考"或"适配现有代码"
- "已经花了 X 小时，删掉太浪费"
- "TDD 太教条了，我在务实"
- "这次不同因为..."

**所有这些都意味着：删除代码。用 TDD 重新开始。**

---

## Bug 修复的 TDD 流程

```
1. 写一个重现 bug 的失败测试
2. 验证 RED：确认测试因为 bug 而失败
3. 修复 bug（最小改动）
4. 验证 GREEN：测试通过
5. 验证无回归：所有其他测试通过
```

**绝不在没有测试的情况下修复 bug。** 测试证明修复有效，并防止回归。

---

## 验证清单

在标记工作完成之前：

- [ ] 每个新函数/方法都有测试
- [ ] 看到每个测试在实现前失败
- [ ] 每个测试因预期原因失败（功能缺失，不是拼写错误）
- [ ] 写了最少代码让每个测试通过
- [ ] 所有测试通过
- [ ] 输出干净（无错误、无警告）
- [ ] 测试使用真实代码（mock 仅在不可避免时使用）
- [ ] 边界情况和错误场景已覆盖

无法勾选所有项？你跳过了 TDD。重新开始。

---

## 卡住时怎么办

| 问题 | 解决方案 |
|------|----------|
| 不知道怎么测试 | 先写期望的 API。先写断言。问用户。 |
| 测试太复杂 | 设计太复杂。简化接口。 |
| 必须 mock 所有东西 | 代码耦合太紧。使用依赖注入。 |
| 测试 setup 太大 | 提取辅助方法。仍然复杂？简化设计。 |

---

## 最终规则

```
生产代码 → 测试存在且先失败
否则 → 不是 TDD
```

没有用户明确许可，不得有例外。

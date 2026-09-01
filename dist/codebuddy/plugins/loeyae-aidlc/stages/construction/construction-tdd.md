---
slug: tdd
number: "3.5.1"
name: TDD 测试驱动开发
phase: construction
execution: ALWAYS
lead_agent: aidlc-developer-agent
support_agents: []
mode: inline
scopes: [feature, enterprise, mvp, classic, express, workshop, bugfix, refactor]
consumes: [src/]
produces:
  - src/test/
  - .aidlc/evidence/tdd/test-quality.json
sensors: [test-quality]
requires: [code-generation]
---

# 测试驱动开发（TDD）

## 概述

先写测试。看它失败。写最少的代码让它通过。

**核心原则**：如果你没有看到测试失败，你就不知道它是否在测试正确的东西。

**违反规则的字面意思就是违反规则的精神。**

---

## 铁律

```
没有失败测试，就没有生产代码。
```

在测试之前写了代码？删除它。从头开始。

**默认行为：**
- 不要保留作为"参考"
- 不要在写测试时"适配"它
- 不要看它
- 删除意味着删除

从测试出发重新实现。句号。

---

## 用例点溯源铁律

```
每个测试必须标注它对应哪个测试用例点。
没有 @TestCaseId 的测试 = 不知所云的测试。
```

**规则**：
- 每个新增/修改的公共方法，其测试**必须**关联到 `docs/aidlc/inception/application-design/test-cases/` 中的某个 UC-D-xxx
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

一旦声明包含默认方法、构造器或静态方法中的业务逻辑，或涉及数据访问、网络调用、状态转换等可执行行为，即不再属于声明型物化，必须按本文件完整执行 RED-GREEN-REFACTOR。该条件不构成对任何业务代码的 TDD 豁免。

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

## RED-GREEN-REFACTOR 循环

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

写一个最小的测试，展示期望的行为。

**要求：**
- 一个行为
- 清晰的名称（描述行为，不是实现）
- 真实代码（除非不可避免，否则不用 mock）

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

### 验证 RED — 看它失败

**强制执行。绝不跳过。**

```bash
# Java/Maven
mvn test -pl module-name -Dtest=TestClassName#testMethodName

# Vue/前端
pnpm test -- --run path/to/test.spec.ts
```

确认：
- 测试失败（不是报错）
- 失败消息符合预期
- 因为功能缺失而失败（不是拼写错误）

**测试通过了？** 你在测试已有行为。修正测试。

**测试报错了？** 修正错误，重跑直到它正确失败。

### GREEN — 最少代码

写最简单的代码让测试通过。

**要求：**
- 刚好够通过测试
- 不添加额外功能
- 不重构其他代码
- 不"改进"超出测试范围的东西

**好的实现：**
```java
public ValidationResult createUser(CreateUserRequest request) {
    if (request.getEmail() == null || request.getEmail().isBlank()) {
        return ValidationResult.error("邮箱不能为空");
    }
    // ... 最小实现
}
```
刚好够通过。

**坏的实现：**
```java
public ValidationResult createUser(CreateUserRequest request) {
    // 验证所有字段（YAGNI - 测试只要求验证邮箱）
    var errors = new ArrayList<String>();
    if (request.getEmail() == null || request.getEmail().isBlank()) {
        errors.add("邮箱不能为空");
    }
    if (request.getPassword() == null || request.getPassword().length() < 8) {
        errors.add("密码至少8位");
    }
    // ... 过度工程
}
```
超出测试要求。

### 验证 GREEN — 看它通过

**强制执行。**

> **测试范围选择**：参见 `common-test-execution-strategy.md` 的分层模型。

```bash
# 步骤 1：运行 L1 焦点测试（当前测试方法/文件）
mvn test -pl module-name -Dtest=TestClassName#testMethodName        # Maven
pnpm test -- --run path/to/test.spec.ts                             # 前端

# 步骤 2：运行 L2 模块测试（当前模块全部测试，确认无回归）
mvn test -pl module-name                                            # Maven
pnpm --filter current-package test -- --run                         # 前端
```

确认：
- 当前测试通过（L1）
- 模块内其他测试仍然通过（L2）
- 输出干净（无错误、无警告）

**注意**：此处无需运行全量测试（L4）。模块级验证（L2）足以保证 TDD 循环的快速反馈。跨模块回归验证在单元完成时通过 L3 执行。

**测试失败？** 修正代码，不是测试。

**其他测试失败？** 立即修复。

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

### 快速模式下的 TDD 调整

当用户选择快速推进时，TDD 的**顺序**可以调整，但**铁律**不变。

**快速模式允许的调整**：
- 可以先写代码后写测试（Code-First + Immediate Test）
- 不需要严格观察 RED 阶段（因为代码已存在）
- 可以一次性为多个方法写测试（批量验证）

**快速模式不变的铁律**：
- 每个新增/修改的公共方法**必须有测试** — 无例外
- 测试**必须在同一交互中完成** — 不可说"测试下次补"
- 测试**必须使用框架工具** — BaseMockitoUnitTest、RandomUtils、AssertUtils
- 测试**必须实际运行并通过** — 不可只写不跑

**为什么不能拖延测试**：
- "下次补"在实践中意味着"永远不补"
- 没有测试的代码在重构时无法验证正确性
- 框架升级时，没有测试的模块是最大的风险点

**快速模式的 TDD 流程**：
```
1. 写实现代码（GREEN 优先）
2. 立即为该代码写测试
3. 运行 L1 测试确认通过
4. 运行 L2 模块测试确认无回归
```

> **注意**：快速模式下也遵循 `common-test-execution-strategy.md` 的分层策略。无需全量测试，L2 足以保证模块内无回归。跨模块验证在单元完成时统一执行 L3。

与完整 TDD 的区别仅在于：跳过了"先看测试失败"的 RED 阶段。代码质量和测试覆盖率的要求完全不变。

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
  1. 读取代码生成计划中的 TDD 执行序列
  2. 对序列中的每一行：
     a. RED：写测试
     b. 验证 RED：运行 L1 测试，确认失败
     c. GREEN：写最少实现代码
     d. 验证 GREEN：运行 L1 确认通过 + 运行 L2 确认模块内无回归
     e. REFACTOR：清理（可选）
     f. 验证 REFACTOR：运行 L2 确认仍然绿色
  3. 所有 TDD 循环完成后，运行 L3（影响域测试）确认跨模块无回归
  4. L3 通过后，进入代码审查
```

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

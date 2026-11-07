# 测试规范

**适用范围**：通用测试规范，适用于所有技术栈。框架专有测试工具依据项目技术事实与已启用 Provider 的锁定知识选用。

---

## 测试框架（按技术栈选择）

沿用项目已确认的测试工具及真实命令；框架专属测试建议和样例按模块依赖/版本从显式绑定的外部知识加载，见 `provider-offline-knowledge.md`。未启用包时不引入框架依赖，不回退到固定工具组合。

## 测试类命名规范

| 类型 | 命名规则 | 示例 |
|------|---------|------|
| 单元测试 | `{Class}Test` | `UserServiceTest` |
| 集成测试 | `{Class}IntegrationTest` | `UserControllerIntegrationTest` |
| Repository测试 | `{Entity}RepositoryTest` | `UserRepositoryTest` |
| 组件测试 | `{Component}.spec.ts` | `UserForm.spec.ts` |

---

## 测试原则

### 必须遵守

1. **测试不通过，任务不完成**
2. **禁止跳过失败测试** — 不使用 `@Disabled` / `.skip()` 逃避问题
3. **按权威行为诊断失败** — 先核对批准需求、测试预期和实现。真实实现缺陷修实现；测试错误或已批准行为变化可有据修测试并保留变更理由及失败/重跑证据。不得降低正确断言、跳过必需测试或伪造通过
4. **测试数据独立** — 不依赖其他测试的数据
5. **测试可重复执行** — 多次执行结果一致

### 测试结构 (AAA 模式)

```java
@Test
void testMethod() {
    // Arrange (Given) - 准备测试数据
    User user = new User();
    user.setName("张三");

    // Act (When) - 执行被测方法
    UserView result = userService.create(user);

    // Assert (Then) - 验证结果
    assertNotNull(result);
    assertEquals("张三", result.getName());
}
```

---

## Mock 规范

### 何时使用 Mock

| 场景 | 是否 Mock |
|------|----------|
| 外部服务调用 | 是 |
| 数据库操作（单元测试） | 是 |
| 时间相关 | 是 |
| 文件系统 | 是 |
| 内部业务逻辑 | 否 |

## 测试覆盖要求

沿用项目已有或用户明确批准的覆盖率政策，并记录来源、适用范围与结果。没有项目阈值时，不按层级临时引入统一百分比、覆盖率工具或无关测试。

依据当前需求、所选 UC-D、变更行为与实际影响范围选择最小充分测试；风险增加时扩大验证并说明依据。现有测试映射可复用，必需测试须真实通过且可追溯；失败保留原始证据并按权威行为诊断。详见 `common-test-execution-strategy.md`。

---

## 项目测试工具

依据项目依赖、版本、已有测试和技术上下文选择测试基类、Mock 与断言工具。已启用的知识 Provider 必须按当前 Plan/node 加载锁定章节并完成宿主确认，参见 `provider-offline-knowledge.md`。未启用 Provider 时使用项目已有工具，不添加框架专属依赖或占位内容。

知识回执仅证明知识交付，不能替代真实测试、受控 Evidence 或 validation Gate；测试充分性、边界和安全要求仍适用。

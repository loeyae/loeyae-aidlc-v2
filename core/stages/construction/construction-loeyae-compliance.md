---
slug: loeyae-compliance
number: "3.5.3"
name: Loeyae 框架合规
phase: construction
execution: CONDITIONAL
lead_agent: aidlc-developer-agent
support_agents: []
mode: inline
scopes: [feature, enterprise, mvp, classic]
consumes: []
produces: [.aidlc/evidence/loeyae-compliance/framework-compliance.json]
sensors: [framework-compliance]
traceability: not_applicable
requires: [code-generation]
condition: is_loeyae_boot
---

# Loeyae Boot 编码规范加载与合规验证

> **加载条件**：仅当 state.md 中 `后端框架 = Loeyae Boot` 时加载本文件。
> **加载时机**：Construction 代码生成步骤 2（MCP Skill 加载）时。
> **非 Loeyae Boot 项目完全不需要本文件。**

---

## 第一部分：MCP Skill 加载策略

### 强制要求（不可跳过）

无论用户选择何种执行速度，MCP Skill 加载**绝对不可跳过**。

**为什么**：Skill 定义了框架的编码规范、注解用法、模块结构和测试基类。跳过意味着代码"能编译但不符合团队规范"——问题会隐藏到代码审查甚至生产环境。

### 渐进式披露策略（v2.0）

MCP Skill 服务已升级为渐进式披露版本，遵循**三层加载**原则：

```
索引（outline）→ 章节（section）→ 全文（content）
```

| 层级 | API | 用途 | Token 消耗 |
|------|-----|------|-----------|
| 1. 大纲 | `get_skill_outline(name)` | 查看章节结构，决定加载哪些 | 极低 |
| 2. 章节 | `get_skill_section(name, section)` | 按需加载指定章节 | 低-中 |
| 3. 全文 | `get_skill_content(name)` | 获取完整规范（谨慎使用） | 高 |

**加载优先级**：
1. **优先使用 `get_skill_section`**：只加载当前单元需要的章节（如 CRUD 单元只加载 Entity/Controller/Service 章节）
2. **`get_skill_outline` 用于导航**：不确定需要哪个章节时，先查大纲再选择
3. **`get_skill_content` 仅作兜底**：当章节粒度不够或需要跨章节对照时使用
4. **`get_skill_summary` 用于快速预览**：返回大纲 + 前 3 个章节摘要，适合快速了解规范范围

**快速模式 vs 完整模式**：
- 快速模式：`get_skill_outline` → `get_skill_section`（只加载相关章节）
- 完整模式：`get_skill_outline` → `get_skill_section`（逐章节加载，需要时用 `get_skill_content` 兜底）

**搜索定位**：`search_skill(query)` 现在返回**章节级定位**（而非整个文件），可直接用返回的章节标题调用 `get_skill_section`。

**验证检查点**（加载完成后必须确认）：
- [ ] 至少加载了 1 个与当前单元业务相关的 Skill 章节
- [ ] 已确认测试基类选择（BaseMockitoUnitTest / BaseDbUnitTest）
- [ ] 已确认异常处理方式（错误码定义 + 断言工具）

### 前置条件检查

1. 从 `docs/aidlc/state.md` 读取 `后端框架` 字段
2. **仅当 `后端框架 = Loeyae Boot` 时**，才执行下方加载
3. 否则跳过本文件所有内容

### Fallback 策略

MCP 服务不可达时：
1. 使用 steering 通用规范替代（`common-tech-security.md`、`common-database-design.md`、`common-tech-testing.md`）
2. 在代码生成计划中标注"MCP 不可达，使用通用规范"
3. 建议用户在 MCP 恢复后重新验证

---

## MCP Skill 加载表

根据代码类型选择对应 Skill：

### 核心业务开发
| 代码类型 | MCP Skill | 常用章节 |
|---------|-----------|---------|
| CRUD 模块 | `get_skill_outline("loeyae-crud")` → 按需 `get_skill_section` | Entity、Controller、Service、Repository、Convert |
| 认证授权 | `get_skill_outline("loeyae-auth")` → 按需 `get_skill_section` | JWT、RBAC、会话管理 |
| 参数校验 | `get_skill_outline("loeyae-validation")` → 按需 `get_skill_section` | 自定义校验注解 |
| 异常处理 | `get_skill_outline("loeyae-error-handling")` → 按需 `get_skill_section` | 错误码、断言工具 |
| 数据访问 | `get_skill_outline("loeyae-data-access")` → 按需 `get_skill_section` | Repository、查询构建 |
| Web 基础设施 | `get_skill_outline("loeyae-web-infra")` → 按需 `get_skill_section` | 统一响应、过滤器 |
| 数据安全 | `get_skill_outline("loeyae-data-security")` → 按需 `get_skill_section` | 加密、脱敏、签名 |
| 数据字典 | `get_skill_outline("loeyae-dict")` → 按需 `get_skill_section` | 字典注解、字典工具 |

### 基础设施能力
| 代码类型 | MCP Skill | 常用章节 |
|---------|-----------|---------|
| 缓存 | `get_skill_outline("loeyae-cache")` → 按需 `get_skill_section` | BaseCache、二级缓存 |
| 消息队列 | `get_skill_outline("loeyae-message")` → 按需 `get_skill_section` | 消息抽象、发送/消费 |
| 消息审计 | `get_skill_outline("loeyae-message-audit")` → 按需 `get_skill_section` | 消息日志、状态追踪 |
| 定时任务 | `get_skill_outline("loeyae-job")` → 按需 `get_skill_section` | JobHandler、动态管理 |
| 邮件 | `get_skill_outline("loeyae-mail")` → 按需 `get_skill_section` | 邮件发送、模板 |
| 服务间调用 | `get_skill_outline("loeyae-feign")` → 按需 `get_skill_section` | Feign、认证透传 |
| 许可证 | `get_skill_outline("loeyae-license")` → 按需 `get_skill_section` | 许可证验证集成 |
| CMS | `get_skill_outline("loeyae-cms")` → 按需 `get_skill_section` | 多站点、模板引擎 |
| 数据变更审计 | `get_skill_outline("loeyae-mybatis-audit")` → 按需 `get_skill_section` | 变更快照、审计日志 |

### 工具类与模式
| 代码类型 | MCP Skill | 常用章节 |
|---------|-----------|---------|
| 通用工具类 | `get_skill_outline("loeyae-utils")` → 按需 `get_skill_section` | JsonTool、CollectionUtils |
| 条件判断 | `get_skill_outline("loeyae-decide")` → 按需 `get_skill_section` | 链式 if-else 替代 |
| 条件执行 | `get_skill_outline("loeyae-optional-util")` → 按需 `get_skill_section` | if-null 替代 |
| 测试 | `get_skill_outline("loeyae-test")` → 按需 `get_skill_section` | 测试工具、Mock 配置 |
| 框架模块选型 | `get_skill_outline("loeyae-framework-modules")` → 按需 `get_skill_section` | 模块索引、依赖组合 |
| 数据库设计 | `get_skill_outline("loeyae-database-design")` → 按需 `get_skill_section` | 表设计、DDL 模板 |
| 数据库命名 | `get_skill_outline("loeyae-database-naming")` → 按需 `get_skill_section` | 表/字段命名规范 |
| 项目结构 | `get_skill_outline("loeyae-project-structure")` → 按需 `get_skill_section` | 模块目录、包结构 |

### 低代码开发（仅 state.md 中 `低代码模式 = 是`）
| 代码类型 | MCP Skill | 常用章节 |
|---------|-----------|---------|
| 低代码入门 | `get_skill_outline("loeyae-lowcode-getting-started")` → 按需 `get_skill_section` | 快速上手 |
| CRUD 模板 | `get_skill_outline("loeyae-lowcode-crud-template")` → 按需 `get_skill_section` | 数据模型+流程+页面 |
| 流程编排 | `get_skill_outline("loeyae-lowcode-flow")` → 按需 `get_skill_section` | LiteFlow EL |
| Groovy 脚本 | `get_skill_outline("loeyae-lowcode-groovy")` → 按需 `get_skill_section` | 脚本规范 |
| AMIS 页面 | `get_skill_outline("loeyae-lowcode-amis")` → 按需 `get_skill_section` | JSON Schema |
| 组件开发 | `get_skill_outline("loeyae-lowcode-component-dev")` → 按需 `get_skill_section` | 自定义组件 |
| API 对接 | `get_skill_outline("loeyae-lowcode-api-integration")` → 按需 `get_skill_section` | 接口路径 |
| 最佳实践 | `get_skill_outline("loeyae-lowcode-best-practices")` → 按需 `get_skill_section` | 集成模式 |

### 搜索兜底
- 不确定用哪个 skill → `search_skill("关键词")`（返回章节级定位，可直接用返回的章节标题调用 `get_skill_section`）

---

## 测试代码强制规则（不可跳过，快速模式同样适用）

编写测试前必须加载 `loeyae-test` 的 summary，确认：
- Mockito 单元测试**必须继承** `BaseMockitoUnitTest` — 禁止裸写 `@ExtendWith`
- 使用 `RandomUtils.randomPojo()` 生成测试数据 — 禁止手动 new
- 使用 `AssertUtils.assertServiceException()` — 禁止 try-catch 手动断言
- **禁止** `mockStatic(SecurityUtil.class)` — 使用 `MockUtils.mockLoginUser()`

---

## 第二部分：框架规范逐项对照

### 对照时机

在两阶段代码审查的**阶段 2（代码质量审查）**中执行。

### 强制对照清单

根据当前单元涉及的代码类型选择适用项：

#### A. Entity 实体类
- [ ] 类名 = 业务名（无 Entity 后缀）
- [ ] `@TableName("{module}_{business}")`
- [ ] `@TableId(type = IdType.AUTO)`
- [ ] 审计字段使用 MyBatis Plus Ext 自动填充注解
- [ ] `@TableLogic` 逻辑删除
- [ ] 不继承基类，审计字段直接声明

#### B. Service / Repository 层
- [ ] Repository 继承 `BaseRepositoryX<Mapper, Entity>`
- [ ] Service 继承 `BaseServiceImpl<Repository, Convert, Entity, View, Detail, Create, Update, Query, PageQuery, Long>`
- [ ] 依赖注入使用 `@Resource`（不是 `@Autowired`）
- [ ] `@Transactional(rollbackFor = Exception.class)`

#### C. Controller 层
- [ ] URL 无 `/api/admin` 或 `/api/app` 前缀（框架自动注入）
- [ ] 路径变量 `{id:\\d+}`
- [ ] 写操作 `@OperateLog`
- [ ] Swagger 注解完整（`@Tag`、`@Operation`、`@Parameter`）

#### D. DTO / VO
- [ ] 按实体分子目录 `material/dto/{entity}/`、`material/vo/{entity}/`
- [ ] Create：`@NotBlank` + `requiredMode = REQUIRED`
- [ ] PageQuery 继承 `PageParam`，`@SuperBuilder`
- [ ] Primary 使用 `@Exists` 校验
- [ ] Query 模糊查询 `@QueryColumn(method = QueryMethod.LIKE)`

#### E. Convert 转换器
- [ ] 继承 `BaseConvert<Entity, View, Detail, Create, Update>`
- [ ] `nullValuePropertyMappingStrategy = IGNORE`

#### F. 异常处理
- [ ] 错误码枚举实现 `IErrorCode`
- [ ] 9 位编码：`{模块3位}{业务域3位}{序号3位}`
- [ ] msg 使用 i18n key：`{模块}.error.code.{错误码}`
- [ ] `ApiResult.failed(IErrorCode)` 抛出

#### G. 测试
- [ ] 继承 `BaseMockitoUnitTest`
- [ ] `RandomUtils.randomPojo()` 生成数据
- [ ] `AssertUtils.assertServiceException()` 断言
- [ ] `MockUtils.mockLoginUser()` 模拟登录

### 对照结果格式

```markdown
## 框架规范对照结果

**状态**：✅ 合规 | ❌ 不合规

| # | 规则 | 状态 | 证据/问题 |
|---|------|------|-----------|
| A1 | Entity 无后缀 | ✅ | `DictType.java` |
| B3 | @Resource | ❌ | `UserServiceImpl.java` L15 用了 @Autowired |

### 不合规项修复
1. [文件 + 行号 + 修改说明]
```

### 不合规处理

- 不合规项 = 代码质量审查的**重要问题**（必须修复）
- 修复后重新对照确认
- 不允许以"能编译通过"为由跳过

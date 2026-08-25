# 测试规范

**适用范围**：通用测试规范，适用于所有技术栈。框架专有测试工具（如 Loeyae Boot 的测试基类）通过 MCP Skill 按需获取。

---

## 测试框架（按技术栈选择）

### Java / Spring Boot
- **JUnit 5**: 测试框架
- **Mockito**: Mock 框架
- **Spring Boot Test**: 集成测试支持
- **AssertJ**: 流式断言

### Vue 3 / TypeScript
- **Vitest**: 测试框架
- **Vue Test Utils**: 组件测试
- **Testing Library**: DOM 测试
- **Playwright**: E2E 测试

---

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
3. **禁止改断言"通过"测试** — 断言失败说明代码有问题
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

## 单元测试规范

### Service 层测试

```java
@ExtendWith(MockitoExtension.class)
class UserServiceTest {

    @Mock
    private UserRepository userRepository;

    @InjectMocks
    private UserServiceImpl userService;

    @Test
    @DisplayName("创建用户 - 成功")
    void create_success() {
        // Given
        UserCreate create = new UserCreate();
        create.setName("张三");

        User entity = new User();
        entity.setId(1L);

        when(userRepository.save(any())).thenReturn(true);

        // When
        UserView result = userService.create(create);

        // Then
        assertNotNull(result);
        verify(userRepository).save(any());
    }

    @Test
    @DisplayName("创建用户 - 手机号已存在")
    void create_mobileExists() {
        // Given
        UserCreate create = new UserCreate();
        create.setMobile("13812345678");

        when(userRepository.existsByMobile("13812345678")).thenReturn(true);

        // When & Then
        assertThrows(RuntimeException.class, () -> userService.create(create));
    }
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

### Mock 示例

```java
// Mock 返回值
when(repository.findById(1L)).thenReturn(Optional.of(user));

// Mock 抛异常
when(repository.save(any())).thenThrow(new RuntimeException("DB Error"));

// Mock 无返回值方法
doNothing().when(service).sendEmail(any());

// 验证调用
verify(repository, times(1)).save(any());
verify(repository, never()).delete(any());
```

---

## 集成测试规范

### Controller 集成测试

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
class UserControllerIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    @DisplayName("GET /api/user/{id} - 成功")
    void getById_success() throws Exception {
        mockMvc.perform(get("/api/user/1"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.id").value(1));
    }

    @Test
    @DisplayName("POST /api/user - 创建成功")
    void create_success() throws Exception {
        UserCreate create = new UserCreate();
        create.setName("张三");

        mockMvc.perform(post("/api/user")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(create)))
            .andExpect(status().isOk());
    }
}
```

---

## 参数化测试

```java
@ParameterizedTest
@ValueSource(strings = {"13812345678", "15912345678", "18612345678"})
@DisplayName("手机号格式验证 - 有效")
void mobileValid(String mobile) {
    assertTrue(MobileValidator.isValid(mobile));
}

@ParameterizedTest
@CsvSource({
    "张三, 13812345678",
    "李四, 15912345678"
})
@DisplayName("创建用户 - 参数化")
void create_multipleUsers(String name, String mobile) {
    UserCreate create = new UserCreate();
    create.setName(name);
    create.setMobile(mobile);
    // ...
}
```

---

## 测试覆盖要求

| 层级 | 最低覆盖率 | 说明 |
|------|-----------|------|
| Service | 80% | 业务逻辑核心 |
| Controller | 70% | 接口层 |
| Repository | 60% | 数据访问层 |
| Util | 90% | 工具类 |

---

## 前端测试规范

### 组件测试

```typescript
import { mount } from '@vue/test-utils'
import UserForm from './UserForm.vue'

describe('UserForm', () => {
  it('should render form fields', () => {
    const wrapper = mount(UserForm)
    expect(wrapper.find('input[name="username"]').exists()).toBe(true)
  })

  it('should validate required fields', async () => {
    const wrapper = mount(UserForm)
    await wrapper.find('form').trigger('submit')
    expect(wrapper.find('.error-message').exists()).toBe(true)
  })
})
```

### Composable 测试

```typescript
import { useCounter } from './useCounter'

describe('useCounter', () => {
  it('should increment', () => {
    const { count, increment } = useCounter()
    increment()
    expect(count.value).toBe(1)
  })
})
```

---

## 框架专有测试工具

> **注意**：以下内容仅在 `state.md` 中 `后端框架 = Loeyae Boot` 时适用。
> 详细 API 通过 MCP Skill `loeyae-test` 获取。

如果项目使用 Loeyae Boot Framework，在代码生成阶段通过 MCP 加载以下 skill：
- `loeyae-test` — 测试基类（BaseMockitoUnitTest、BaseDbUnitTest）、RandomUtils、AssertUtils
- `loeyae-test-base` — 测试基础设施配置
- `loeyae-test-utils` — 测试工具类

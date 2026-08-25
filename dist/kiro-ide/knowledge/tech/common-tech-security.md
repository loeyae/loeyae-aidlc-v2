# 安全编码规范

---

## 认证与授权

### 获取当前用户

```java
// 方式1: @CurrentUser 注入（推荐）
@GetMapping("/me")
public UserDetail getCurrentUser(@CurrentUser AuthUser user) {
    return userService.get(user.getId());
}

// 方式2: SecurityUtil 工具类
Long userId = SecurityUtil.getUserId();
String account = SecurityUtil.getUserAccount();
AuthUser user = SecurityUtil.getAuthUser();

// 方式3: AuthUtils 工具类
AuthUser user = AuthUtils.getLoginUser();
```

### 权限控制

```java
// 方式1: @PreAuthorize 注解
@PreAuthorize("hasRole('ADMIN')")
@DeleteMapping("/{id}")
public ApiResult<Void> delete(@PathVariable Long id) { ... }

// 方式2: 代码中判断
if (!SecurityUtil.isSuper()) {
    // 非超级用户，检查数据权限
}

// 方式3: 自定义 AuthorizeRequestsCustomizer
@Component
public class CustomAuthorizeRequestsCustomizer extends AuthorizeRequestsCustomizer {
    @Override
    public void customize(ExpressionUrlAuthorizationConfigurer<HttpSecurity>.ExpressionInterceptUrlRegistry registry) {
        registry.requestMatchers("/api/public/**").permitAll();
    }
}
```

### 免认证接口

```java
@Pass  // 类或方法级别
@GetMapping("/public/info")
public ApiResult<Info> getPublicInfo() { ... }
```

---

## 数据安全

### 字段加密

Entity 字段使用 `@Crypto` 注解自动加密：

```java
@TableField(typeHandler = CryptoTypeHandler.class)
@Crypto(model = CryptoModel.AES)  // 支持: AES, RSA, SM2, SM4, BASE64
private String idCard;
```

### 数据脱敏

VO 字段使用脱敏注解：

```java
@Desensitize(type = DesensitizeType.MOBILE)
private String mobile;

@Desensitize(type = DesensitizeType.ID_CARD)
private String idCard;

@Desensitize(type = DesensitizeType.BANK_CARD)
private String bankCard;
```

### 接口签名

敏感接口使用 `@Signature` 验证请求签名：

```java
@Signature
@PostMapping("/transfer")
public ApiResult<Void> transfer(@RequestBody TransferRequest request) { ... }
```

---

## 数据权限

### 行级数据权限

使用 `@DataPermission` 注解控制数据访问范围：

```java
@DataPermission(
    table = "sys_user",           // 表名
    conditionField = "org_id",    // 条件字段
    type = DataPermissionMode.ORG // 权限模式
)
public List<User> listUsers() { ... }
```

权限模式：
- `ALL`: 全部数据
- `DEPT`: 本部门
- `DEPT_AND_SUB`: 本部门及下级
- `SELF`: 仅本人
- `CUSTOM`: 自定义

### 多租户

框架自动处理 `tenant_id` 字段，无需手动处理：

```java
// 自动注入租户条件
// Entity 需要有 tenant_id 字段
```

---

## XSS/CSRF 防护

### XSS 防护

框架默认开启 XSS 过滤，如需跳过：

```java
@XssIgnore  // 方法或参数级别
@PostMapping("/content")
public ApiResult<Void> saveContent(@RequestBody ContentRequest request) { ... }
```

### CSRF 防护

框架默认开启 CSRF 防护，如需跳过：

```java
@CsrfIgnore
@PostMapping("/api/callback")
public ApiResult<Void> callback(@RequestBody CallbackRequest request) { ... }
```

---

## 敏感操作

### 操作日志

```java
@OperateLog(module = "用户管理", operation = "删除用户")
@DeleteMapping("/{id}")
public ApiResult<Void> delete(@PathVariable Long id) { ... }
```

### 登录日志

```java
@LoginLog(userType = UserType.MANAGER, type = LoginTypeEnum.LOGIN)
@PostMapping("/login")
public ApiResult<LoginResult> login(@RequestBody LoginRequest request) { ... }
```

### 数据审计

```java
@AuditLog  // 记录数据变更前后快照
@PutMapping("/{id}")
public ApiResult<Void> update(@PathVariable Long id, @RequestBody UserUpdate update) { ... }
```

---

## 幂等与限流

### 幂等控制

```java
@Idempotent(timeout = 5000, message = "请勿重复提交")
@PostMapping("/order")
public ApiResult<Order> createOrder(@RequestBody OrderCreate create) { ... }
```

### 限流

```java
@RateLimiter(name = "sms", rate = 1, rateInterval = "60s")
@PostMapping("/sms/send")
public ApiResult<Void> sendSms(@RequestBody SmsRequest request) { ... }
```

### 分布式锁

```java
@Lock4j(keys = {"#userId"}, acquireTimeout = 1000, expire = 5000)
@PostMapping("/withdraw")
public ApiResult<Void> withdraw(@PathVariable Long userId) { ... }
```

---

## 安全编码原则

### 禁止事项

| 禁止 | 原因 | 替代方案 |
|------|------|---------|
| SQL拼接 | SQL注入风险 | 使用 MyBatis-Plus Wrapper |
| 明文存储密码 | 数据泄露风险 | BCrypt 加密 |
| 日志打印敏感信息 | 信息泄露 | 脱敏后打印 |
| 硬编码密钥 | 代码泄露风险 | 配置中心/密钥管理 |
| 返回过多数据 | 信息泄露 | 只返回必要字段 |

### 密码处理

```java
// 密码加密（注册/重置）
String encodedPassword = SecureUtil.md5(password + salt);

// 密码校验（登录）
boolean matches = SecureUtil.md5(password + user.getPassSalt()).equals(user.getPassword());
```

### 敏感数据传输

```java
// 请求体解密
@PostMapping("/secure")
public ApiResult<Void> secureApi(@SecureRequestBody SecureRequest request) { ... }

// 响应体加密
@SecureResponseBody
@GetMapping("/secure")
public SecureResponse getSecureData() { ... }
```

---

## 错误处理

### 业务异常

```java
// 使用 AssertUtil 断言
AssertUtil.notNull(user, UserErrorCode.USER_NOT_FOUND);
AssertUtil.notBlank(name, CommonErrorCode.PARAM_NOT_BLANK);

// 抛出 GlobalException
throw new GlobalException(UserErrorCode.USER_DISABLED);
```

### 错误码规范

错误码为9位数字：`{模块3位}{业务3位}{序号3位}`

| 模块 | 范围 |
|------|------|
| 通用 | 000000000 - 099999999 |
| 系统 | 100000000 - 199999999 |
| 会员 | 500000000 - 599999999 |
| 商城 | 600000000 - 699999999 |
| 支付 | 700000000 - 799999999 |

---

## 安全配置检查清单

- [ ] 敏感接口已添加 `@Signature` 或 HTTPS
- [ ] 敏感字段已使用 `@Crypto` 加密
- [ ] VO 敏感字段已使用 `@Desensitize` 脱敏
- [ ] 数据权限已配置 `@DataPermission`
- [ ] 写操作已添加 `@OperateLog`
- [ ] 关键操作已添加 `@Idempotent` 或 `@Lock4j`
- [ ] 免认证接口已添加 `@Pass`
- [ ] 错误信息不包含敏感数据

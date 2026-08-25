# 数据表设计规范

**适用范围**：通用数据库设计规范，适用于所有关系型数据库项目。框架专有的 Entity 注解和模板通过 MCP Skill 按需获取。

---

## 公用字段

所有业务表必须包含以下审计字段：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `id` | BIGINT | 是 | 主键（自增或业务ID） |
| `creator` | BIGINT 或 VARCHAR(100) | 否 | 创建人 |
| `modifier` | BIGINT 或 VARCHAR(100) | 否 | 修改人 |
| `create_time` | DATETIME | 是 | 创建时间 |
| `update_time` | DATETIME | 是 | 更新时间 |
| `deleted` | BIT(1) | 是 | 逻辑删除（0-未删除，1-已删除） |

### 可选公用字段

| 字段名 | 类型 | 场景 | 说明 |
|--------|------|------|------|
| `tenant_id` | BIGINT | 多租户 | 租户ID |
| `version` | INT | 乐观锁 | 版本号 |
| `enabled` | TINYINT(1) | 启用状态 | 是否启用（0-禁用，1-启用） |
| `status` | TINYINT | 状态 | 业务状态 |
| `remark` | VARCHAR(500) | 备注 | 备注信息 |

---

## 命名规范

### 表名

- 使用小写字母和下划线分隔
- 格式：`{模块前缀}_{业务名称}`
- 示例：`sys_user`、`bpm_user_group`、`order_item`

### 字段名

- 使用小写字母和下划线分隔
- 布尔字段使用 `is_` 前缀或直接用形容词（如 `enabled`、`deleted`）
- 示例：`create_time`、`user_name`、`order_no`

### 主键策略

| 类型 | 适用场景 | 示例 |
|------|---------|------|
| 自增 BIGINT | 通用业务表 | `id BIGINT AUTO_INCREMENT` |
| 业务 VARCHAR | 分布式、需要可读ID | `order_no VARCHAR(40)` |
| UUID | 分布式、无序 | `id VARCHAR(36)` |
| 雪花算法 | 分布式、有序 | `id BIGINT` |

---

## 索引规范

### 必须创建

```sql
PRIMARY KEY (`id`)
```

### 推荐创建

```sql
-- 唯一约束
UNIQUE KEY `uk_{字段名}` (`字段名`)

-- 普通索引
KEY `idx_{字段名}` (`字段名`)

-- 复合索引（遵循最左前缀原则）
KEY `idx_{字段1}_{字段2}` (`字段1`, `字段2`)
```

### 索引命名

| 类型 | 前缀 | 示例 |
|------|------|------|
| 主键 | `PRIMARY` | `PRIMARY KEY` |
| 唯一 | `uk_` | `uk_user_account` |
| 普通 | `idx_` | `idx_create_time` |

### 索引设计原则

- 高频查询字段建索引
- 区分度低的字段（如 status 只有 0/1）不单独建索引
- 复合索引遵循最左前缀原则
- 避免过多索引（一般不超过 5 个）
- 覆盖索引优先

---

## DDL 模板

```sql
CREATE TABLE IF NOT EXISTS `module_table_name` (
    `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
    `field_name` VARCHAR(100) NOT NULL COMMENT '字段说明',
    `status` TINYINT NOT NULL DEFAULT 1 COMMENT '状态',
    `enabled` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用',
    `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `creator` VARCHAR(100) COMMENT '创建人',
    `modifier` VARCHAR(100) COMMENT '修改人',
    `deleted` BIT(1) NOT NULL DEFAULT b'0' COMMENT '逻辑删除标记',
    `remark` VARCHAR(500) COMMENT '备注',
    PRIMARY KEY (`id`),
    KEY `idx_status` (`status`),
    KEY `idx_create_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='表说明';
```

---

## 字段类型映射

| Java 类型 | MySQL 类型 | 说明 |
|-----------|-----------|------|
| Long | BIGINT | 主键、外键 |
| String | VARCHAR(n) | 短文本（n ≤ 500） |
| String | TEXT / LONGTEXT | 长文本、JSON |
| Integer | INT / TINYINT | 整数、状态 |
| Boolean | TINYINT(1) | 布尔 |
| BigDecimal | DECIMAL(p,s) | 金额、精度数值 |
| LocalDateTime | DATETIME | 时间 |
| LocalDate | DATE | 日期 |

---

## 设计原则

- **三范式优先**：除非有明确的性能需求，否则遵循第三范式
- **适度冗余**：高频查询的关联字段可以冗余（如 `user_name`），但需要维护一致性
- **软删除优先**：业务数据使用逻辑删除，系统日志可物理删除
- **字段不可为 NULL**：除非有明确的业务含义，否则设置 `NOT NULL` + 默认值
- **避免大字段**：TEXT/BLOB 字段考虑拆分到独立表

---

## 框架专有 Entity 模板

> **注意**：以下内容仅在 `state.md` 中 `后端框架 = Loeyae Boot` 时适用。
> 详细 Entity 注解和模板通过 MCP Skill `loeyae-database-design` 获取。

如果项目使用 Loeyae Boot Framework，Entity 类需要使用框架提供的自动填充注解（`@InsertFillTime`、`@InsertFillData` 等）。具体用法在代码生成阶段通过 MCP 加载。

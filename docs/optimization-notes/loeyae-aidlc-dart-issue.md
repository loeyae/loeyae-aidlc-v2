# aidlc-scan-root.ts 的 SOURCE_EXTENSIONS 缺少 dart，Flutter 单元的 test-quality / traceability-matrix 认不出 .dart 源码和测试

**版本**：loeyae-aidlc v4.8.1（4.5.2 同样存在）

## 问题描述

`core/tools/aidlc-scan-root.ts` 第 13 行：

```ts
export const SOURCE_EXTENSIONS: readonly string[] = ["java", "kt", "ts", "tsx", "js", "jsx", "vue", "py", "go", "rs", "cs"];
```

`SOURCE_FILE_PATTERN` 和 `TEST_FILE_PATTERN` 都由这张表生成，表里没有 `dart`，所以 Flutter 项目的业务代码（`lib/**/*.dart`）和测试（`test/**/*_test.dart`）都不会被扫描到。

## 影响的检查器（core/tools/aidlc-semantic-checks.ts）

| 位置 | 检查器 | 现象 |
|---|---|---|
| L938 | `testQuality()` | `projectFiles(TEST_FILE_PATTERN)` 为空，报 `test source files are missing`；UC-D 报 `has no test source mapping` |
| L3278–3279 | `traceabilityMatrix()` | code 层和 test 层源码文本为空，Flutter 单元的 REQ → code/test 追溯一律判为未覆盖 |

同文件 L3150 的 code-plan 目标匹配已经支持 `dart|kt|swift`，两处扩展名规则不一致。

## 复现步骤

1. 准备一个 Flutter 项目：`lib/` + `test/xxx_test.dart`，测试里用注释标出 UC-D（如 `/// UC-D-701`）。
2. 在该单元的 tdd 或 build-and-test 阶段执行 `loeyae-aidlc evidence run --sensor test-quality`。
3. 预期：识别 `test/*.dart` 并完成 UC-D 映射。实际：报 `test source files are missing`。

同样流程下 Java / TS 单元正常。

## 建议修复

在扩展名表加上 `dart`。`TEST_FILE_PATTERN` 的规则是 `(?:test|spec)[^/\\]*\.<ext>$`，Flutter 惯用的 `*_test.dart` 可以直接命中，正则不用改：

```diff
--- a/core/tools/aidlc-scan-root.ts
+++ b/core/tools/aidlc-scan-root.ts
@@ -13 +13 @@
-export const SOURCE_EXTENSIONS: readonly string[] = ["java", "kt", "ts", "tsx", "js", "jsx", "vue", "py", "go", "rs", "cs"];
+export const SOURCE_EXTENSIONS: readonly string[] = ["java", "kt", "ts", "tsx", "js", "jsx", "vue", "py", "go", "rs", "cs", "dart", "swift"];
```

`swift` 是为了和 L3150 保持一致，可按需取舍。如果 `dist/` 里有打包副本，也需要同步修改。

## 补充

- 另一个相关问题（test-quality 按整个模块收集 UC-D，导致单元被要求覆盖其他单元的用例）已在 4.8.0 修复（I13 声明 `ucd_units` 后通过 `unitUcdIds` 收窄），不在本 issue 范围内。
- 目前本地靠手工补丁绕过，但每次升级都会被覆盖，希望上游修复。

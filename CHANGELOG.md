# Changelog

## Unreleased

### Fixed

- 修复 I13 `test-case-derivation` 检查器因路径重复拼接而读不到测试用例的问题：`testCaseDerivation` 向 `allFiles` 传入了已拼接 ROOT 的绝对路径，导致目录被拼成 `/r/r/x`（Windows 为 `E:\r\E:\r\x`），用例目录明明存在 `UC-D-xxx` 却报 "I13 test case directory contains no UC-D identifiers"。现改为传相对路径。
- `allFiles` 对绝对路径幂等：扫描根解析抽到 `core/tools/aidlc-scan-root.ts`（`resolveScanRoot` / `scanFiles`），base 已是绝对路径时不再拼接 ROOT，防止同类问题复发。
- 新增回归测试 `tests/test_i13_case_root.ts`（模块化布局的 ready / blocked 用例，以及相对/绝对路径与 POSIX/Windows 路径语义的单元测试），并加入 `npm test`。

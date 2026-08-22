---
slug: ui-mock-styles
number: "2.5.6"
name: Mock 样式
phase: inception
execution: CONDITIONAL
lead_agent: aidlc-design-agent
support_agents: []
mode: inline
scopes: [feature, enterprise, mvp, classic]
consumes: []
produces: []
sensors: []
requires: [ui-mock]
---
# UI Mock 样式模板

> **加载时机**：仅在 `inception-ui-mock-generation.md` 生成或修改 HTML Mock 时加载。

---

## 通用样式（PC + APP 都引入）

```css
body { font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif; background: #f0f2f5; margin: 0; }
.mock-header { background: #fff; border-bottom: 1px solid #e4e7ed; padding: 16px 24px; position: sticky; top: 0; z-index: 100; }
.mock-header h1 { font-size: 18px; font-weight: 600; margin: 0; color: #303133; }
.mock-header p { font-size: 13px; color: #909399; margin: 4px 0 0; }
.mock-container { max-width: 1600px; margin: 0 auto; padding: 20px; display: flex; flex-wrap: wrap; gap: 20px; align-items: flex-start; }
.mock-box { background: #fff; border-radius: 4px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); overflow: hidden; }
.mock-box-title { background: #304156; color: #fff; font-weight: 500; display: flex; align-items: center; }
.mock-box-title .tag { background: rgba(255,255,255,0.15); padding: 2px 6px; border-radius: 3px; }
.mock-box-desc { color: #606266; border-top: 1px solid #ebeef5; background: #fafafa; }
.mock-box-desc h4 { margin: 0 0 8px; color: #303133; }
.mock-box-desc ul { margin: 0; }
.mock-box-desc .hl { color: #e6a23c; font-weight: 500; }
.mock-box-desc .dg { color: #f56c6c; font-weight: 500; }
.mock-full { width: 100%; background: #f8f9fa; border: 1px solid #ebeef5; border-radius: 4px; padding: 14px 18px; font-size: 12px; color: #606266; }
.mock-full h4 { font-size: 13px; margin: 0 0 8px; color: #303133; }
```

---

## PC 专用样式（在通用样式之后引入）

```css
.mock-box { min-width: 700px; flex: 1; }
.mock-box-title { padding: 8px 16px; font-size: 13px; gap: 8px; }
.mock-box-title .tag { font-size: 11px; }
.mock-box-body { padding: 20px; }
.mock-box-desc { padding: 14px 18px; font-size: 12px; }
.mock-box-desc h4 { font-size: 13px; }
.mock-box-desc ul { padding-left: 16px; }
.mock-box-desc li { margin-bottom: 4px; }
```

---

## APP 专用样式（在通用样式之后引入）

```css
.mock-box { width: 280px; }
.mock-box-title { padding: 8px 12px; font-size: 12px; gap: 6px; }
.mock-box-title .tag { font-size: 10px; }
.mock-box-body { background: #f5f5f5; }
.mock-box-desc { padding: 10px 12px; font-size: 11px; }
.mock-box-desc h4 { font-size: 12px; margin: 0 0 6px; }
.mock-box-desc ul { padding-left: 14px; }
.mock-box-desc li { margin-bottom: 3px; }
.phone-bar { height: 24px; background: #1a1a1a; display: flex; align-items: center; justify-content: center; }
.phone-bar span { color: #fff; font-size: 10px; }
.phone-nav { height: 40px; background: #fff; display: flex; align-items: center; justify-content: center; border-bottom: 1px solid #f0f0f0; font-size: 15px; font-weight: 600; color: #333; position: relative; }
.phone-nav .back { position: absolute; left: 10px; font-size: 18px; color: #333; }
.phone-body { height: 480px; overflow-y: auto; background: #f5f5f5; }
```

---

## 使用说明

- PC 端 HTML：引入**通用** + **PC 专用**
- APP 端 HTML：引入**通用** + **APP 专用**
- 所有 Mock 专用 class 加 `mock-`、`phone-` 前缀避免与 UI 框架冲突
- PC 端额外引入 Element UI CDN CSS 使用真实 class name

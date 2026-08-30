# Structural Region Occlusion Contract

## 目的与适用范围

当 SVG 流程图包含 `structural` / swimlane / phase region 框体时，框体与业务前景对象之间的遮挡关系是独立的视觉契约。它不改变业务语义、节点/边稳定 ID、端口、路径、标签或 expected route contract；它只证明结构背景不会穿透业务前景。

本契约适用于新建、调整和迁移图。没有 structural 分组时，遮挡检查为 `not_applicable`；存在 structural 分组时，必须执行源级检查，并在目标操作包含 `preview` 或浏览器 `render` 时执行真实 Provider 检查。

## 绘制层级

固定绘制顺序为：

1. 不透明白色画布；
2. structural 区域框体及其标题；
3. 业务连线主体；
4. 业务节点及节点文字；
5. 边标签；
6. 独立箭头 overlay。

不能因为 DOM 顺序看似正确就假定完成了覆盖，必须检查实际 computed style、几何交点和最新截图。structural 框体不能透过业务节点、业务连线、边标签或箭头可见。

## 节点覆盖

当 structural 框边与节点形状相交、共线或穿越时，节点形状必须使用 `fill="#ffffff"`，节点边框和节点文字仍使用 `#000000`。节点的 ID、位置、尺寸、形状、端口和业务语义不得改变；为保持一致性可以对全部业务节点使用不透明白底。

白色只表示节点遮挡背景，不表达业务状态、角色、权限或确认语义。节点白底不能扩展到 structural 框体、连线、标签、箭头或其他装饰层。

## 连线、标签和箭头覆盖

业务连线继续使用 `fill="none" stroke="#000000" stroke-width="2"`；标签继续是直接 `<text data-edge-label>`，使用黑色 `14` 号文字、无背景框、无描边、无滤镜、无标签级 mask；箭头 overlay 继续使用既有 `data-edge-arrow` / `data-arrow-target` 契约。

当 structural 框边与连线、标签或箭头的实际几何相交时，框边必须在交点处让位。优先使用只附着于 structural 框体的 alpha mask；也可以将框体拆为在实际交点处有间隙的路径。不得改变业务连线的 `from`/`to`、端口、points、方向、标签或箭头。

推荐的 mask 约束如下：

```xml
<mask id="<mask-id>"
      mask-type="alpha"
      maskUnits="userSpaceOnUse"
      maskContentUnits="userSpaceOnUse">
  <path data-structural-mask-base="true" fill="#ffffff" d="..." />
  <path data-structural-cutout="true"
        fill="#ffffff"
        fill-opacity="0"
        d="..." />
</mask>
```

`mask` 只能附着于 structural 框体，不能附着于业务连线、节点、标签或箭头。透明断口必须按实际业务对象 stroke bbox、标签 `getBBox()` 或箭头 bbox 与 structural 框的交点计算，不能使用与图形无关的固定大遮挡范围。mask 使用 `maskUnits="userSpaceOnUse"` 和 `maskContentUnits="userSpaceOnUse"`，并声明 `mask-type="alpha"`。

## 修改边界

默认只修改视觉层，不修改：

- 节点集合、稳定 ID、位置、尺寸、形状和语义；
- 边集合、边 ID、`from`/`to` 关系、端口和 points；
- 业务标签文本和标签坐标；
- expected route contract、Provider Request、AI-DLC state/audit。

只有业务路径或结构语义确实改变时，才同步修改 sidecar、expected contract 和 generation provenance。

## 执行顺序

1. 冻结当前 SVG、sidecar、expected、Provider Request 和 generation provenance；
2. 枚举每个 structural 框体与节点、连线、标签、箭头的实际交点；
3. 将交点分类为节点覆盖、连线覆盖、标签覆盖和箭头覆盖；
4. 一次性生成节点不透明背景和 structural 框体断口；
5. 不改变业务路由、端口、标签坐标和稳定映射；
6. 重新加载 SVG；
7. 对最新 DOM、computed style、实际几何和包含交点的截图执行定向验证。

禁止采用“改一点、看一眼、再改一点”的试错方式；必须先形成完整交点清单，再批量修改。

## 源级门禁

源级检查必须验证：

- XML/JSON 合法；节点、边、分组数量和稳定 ID 不变；
- structural 框体仍具有 `data-group`、`data-group-role`、`data-group-style-role="structural"`，框体和标题为 `#666666`；
- 相交业务节点形状为 `fill="#ffffff"`，节点边框和文字为黑色；白色不扩散到其他业务对象；
- 业务连线仍为黑色、无填充、线宽 `2`；边标签仍为直接 text；箭头映射不变；
- 使用 mask 时，mask 仅附着 structural 框体，使用 alpha 类型和两个 `userSpaceOnUse` 单位，并含透明 cutout；
- SVG 与 sidecar 的标签坐标同步，expected-vs-actual 通过；
- Provider Request 的 SHA-256 不变；
- 源级结果只能说明结构和声明有效，不能替代真实 DOM 或像素视觉证据。

## Provider 门禁

Chrome Provider 必须在 `normal`、`fit`、`zoom` 三个最新视图中检查：

- 相交节点的 computed `fill` 为 `rgb(255,255,255)`；
- structural 框体的 computed `stroke` 为 `rgb(102,102,102)`，且框体不透明填充仍为 `none`；
- structural 框体在节点、连线、标签和箭头交点处不可见；
- 标签 `overlap=false`，所属连线法向 `minClearance >= 6`；
- 标签、节点、连线和箭头没有被 structural 框体遮挡；
- mask 实际附着于 structural 框体，断口 bbox 覆盖实际交点，且 mask 不附着业务连线或标签；
- 至少保存一张包含实际交点的浏览器截图和对应 snapshot。

不能只使用 `elementFromPoint` 判断 SVG mask 是否生效；必须结合最新截图或实际像素视觉证据。Provider 应同时保留交点清单、遮挡错误清单和截图路径，便于复核。

## 状态规则

- XML/JSON、源级结构、DOM 和局部截图通过：可记录 `STATIC_PASS` 或局部视觉通过；
- 未执行真实 Provider 的 `normal`、`fit`、`zoom`：视觉状态保持 `UNVERIFIED`；
- 只有三个视图都有本次运行的真实证据，才能声明完整视觉 `PASS`；
- mask 或局部 DOM 通过不能跳过全图目标视觉验证；
- 发现节点白底缺失、框体断口缺失、绘制层级错误、computed style 错误或截图/像素证据缺失时，记录 `FAIL` 或 `UNVERIFIED`，不得降级为通过。

export const DIAGRAM_VISUAL_STYLE = Object.freeze({
  canvasFill: "#ffffff",
  ink: "#000000",
  structuralGroupInk: "#666666",
  fontFamily: "Microsoft YaHei, 微软雅黑, sans-serif",
  frameFontSize: 16,
  edgeLabelFontSize: 14,
  strokeWidth: 2,
  arrowWidth: 10,
  arrowHeight: 10,
  labelClearance: 6,
});

export type DiagramShape = "round" | "rect" | "diamond" | "ellipse" | "database" | "actor" | "note";
export type DiagramBoundaryModel = "rectangle" | "diamond" | "ellipse" | "database" | "actor" | "note";

export interface DiagramShapeProfile {
  minWidth: number;
  minHeight: number;
  boundaryModel: DiagramBoundaryModel;
  textRegion: "centered";
  portModel: "cardinal";
}

export interface DiagramAxisSpacing {
  referenceShape: "rect";
  referenceWidth: number;
  referenceHeight: number;
  referenceLongSide: number;
  referenceShortSide: number;
  lrMinimumGap: number;
  tbMinimumGap: number;
}

/** Direction-aware main-axis spacing factors: LR uses half the long side, TB uses the rectangle height. */
export const DIAGRAM_AXIS_SPACING_PROFILE = Object.freeze({
  referenceShape: "rect" as const,
  lrReference: "long-side" as const,
  lrFactor: 0.5,
  tbReference: "height" as const,
  tbFactor: 1,
});

/** One shared geometry profile consumed by layout analysis, generators and gates. */
export const DIAGRAM_GEOMETRY_PROFILE = Object.freeze({
  version: "1",
  nodeHorizontalPadding: 16,
  nodeVerticalPadding: 12,
  frameLineHeight: 24,
  entityGap: 24,
  portGap: 36,
  obstacleGap: 12,
  laneGap: 48,
  canvasMargin: 24,
  axisSpacing: DIAGRAM_AXIS_SPACING_PROFILE,
});

export const DIAGRAM_SHAPE_PROFILES: Readonly<Record<DiagramShape, DiagramShapeProfile>> = Object.freeze({
  round: { minWidth: 160, minHeight: 72, boundaryModel: "rectangle", textRegion: "centered", portModel: "cardinal" },
  rect: { minWidth: 160, minHeight: 72, boundaryModel: "rectangle", textRegion: "centered", portModel: "cardinal" },
  diamond: { minWidth: 180, minHeight: 120, boundaryModel: "diamond", textRegion: "centered", portModel: "cardinal" },
  ellipse: { minWidth: 160, minHeight: 96, boundaryModel: "ellipse", textRegion: "centered", portModel: "cardinal" },
  database: { minWidth: 180, minHeight: 96, boundaryModel: "database", textRegion: "centered", portModel: "cardinal" },
  actor: { minWidth: 160, minHeight: 120, boundaryModel: "actor", textRegion: "centered", portModel: "cardinal" },
  note: { minWidth: 180, minHeight: 96, boundaryModel: "note", textRegion: "centered", portModel: "cardinal" },
});

/** Shared source-coordinate thresholds for text fit and structural group capacity. */
export const DIAGRAM_LAYOUT_METRICS = Object.freeze({
  ...DIAGRAM_GEOMETRY_PROFILE,
  groupTitleHorizontalPadding: 24,
  groupHeaderHeight: 48,
  groupHorizontalPadding: 40,
  groupBottomPadding: 32,
});

type SvgTag = { name: string; source: string; ancestors: SvgTag[] };
type Label = { text: string | string[]; x: number; y: number; fontSize?: number };
type Point = [number, number];

const SVG_TAG = /<!--[\s\S]*?-->|<\/?([A-Za-z][\w:-]*)\b[^>]*>/g;
const SVG_VOID_ELEMENTS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const FRAME_ELEMENTS = new Set(["rect", "polygon", "ellipse", "circle", "line", "polyline"]);
const NODE_SHAPE_ELEMENTS = new Set(["rect", "polygon", "ellipse", "circle", "path"]);

function tags(svg: string): SvgTag[] {
  const result: SvgTag[] = [];
  const stack: SvgTag[] = [];
  for (const match of svg.matchAll(SVG_TAG)) {
    const source = match[0];
    if (source.startsWith("<!--")) continue;
    const name = match[1]?.toLowerCase();
    if (!name) continue;
    if (source.startsWith("</")) {
      const index = [...stack].map((entry) => entry.name).lastIndexOf(name);
      if (index >= 0) stack.splice(index, stack.length - index);
      continue;
    }
    const tag: SvgTag = { name, source, ancestors: [...stack] };
    result.push(tag);
    if (!source.trimEnd().endsWith("/>") && !SVG_VOID_ELEMENTS.has(name)) stack.push(tag);
  }
  return result;
}

function attribute(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1];
}

function normalizedColor(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const color = value.trim().toLowerCase();
  if (color === "#000" || color === "black" || color === "rgb(0,0,0)" || color === "rgb(0, 0, 0)") return DIAGRAM_VISUAL_STYLE.ink;
  if (color === "#fff" || color === "white" || color === "rgb(255,255,255)" || color === "rgb(255, 255, 255)") return DIAGRAM_VISUAL_STYLE.canvasFill;
  if (color === "#666" || color === "rgb(102,102,102)" || color === "rgb(102, 102, 102)") return DIAGRAM_VISUAL_STYLE.structuralGroupInk;
  return color;
}

function isStructuralGroupFrame(tag: SvgTag): boolean {
  return attribute(tag.source, "data-group") !== undefined && attribute(tag.source, "data-group-style-role") === "structural";
}

function isStructuralGroupTitle(tag: SvgTag): boolean {
  return tag.name === "text" && attribute(tag.source, "data-group-title") !== undefined && attribute(tag.source, "data-group-style-role") === "structural";
}

function isStructuralGroupElement(tag: SvgTag): boolean {
  return isStructuralGroupFrame(tag) || isStructuralGroupTitle(tag);
}

function isInsideMask(tag: SvgTag): boolean {
  return tag.ancestors.some((ancestor) => ancestor.name === "mask");
}

function isNodeShape(tag: SvgTag): boolean {
  return NODE_SHAPE_ELEMENTS.has(tag.name) && (attribute(tag.source, "data-node") !== undefined || tag.ancestors.some((ancestor) => attribute(ancestor.source, "data-node") !== undefined));
}

function expectedInk(tag: SvgTag): string {
  return isStructuralGroupElement(tag) ? DIAGRAM_VISUAL_STYLE.structuralGroupInk : DIAGRAM_VISUAL_STYLE.ink;
}

function isNone(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "none";
}

function hasPrimaryFont(value: string | undefined): boolean {
  if (!value) return false;
  const first = value.split(",")[0].replace(/["']/g, "").trim().toLowerCase();
  return first === "microsoft yahei" || first === "微软雅黑";
}

function numericAttribute(tag: string, name: string): number {
  return Number(attribute(tag, name));
}

function requireFrameStyle(tag: SvgTag, identity: string, errors: string[], ink = expectedInk(tag)): void {
  const fill = normalizedColor(attribute(tag.source, "fill"));
  const validNodeFill = isNodeShape(tag) && (fill === DIAGRAM_VISUAL_STYLE.canvasFill || isNone(attribute(tag.source, "fill")));
  if (!validNodeFill && !isNone(attribute(tag.source, "fill"))) errors.push(`VISUAL_STYLE: ${identity} must use fill=none`);
  if (normalizedColor(attribute(tag.source, "stroke")) !== ink) errors.push(`VISUAL_STYLE: ${identity} stroke must be ${ink}`);
  if (numericAttribute(tag.source, "stroke-width") !== DIAGRAM_VISUAL_STYLE.strokeWidth) errors.push(`VISUAL_STYLE: ${identity} stroke-width must be ${DIAGRAM_VISUAL_STYLE.strokeWidth}`);
}

function structuralMaskErrors(elements: SvgTag[]): string[] {
  const errors: string[] = [];
  const masks = new Map(elements.filter((tag) => tag.name === "mask").map((tag) => [attribute(tag.source, "id") || "", tag]));
  for (const tag of elements) {
    const maskReference = attribute(tag.source, "mask");
    if (maskReference === undefined) continue;
    const structuralFrame = isStructuralGroupFrame(tag);
    if (!structuralFrame) {
      errors.push(`STRUCTURAL_OCCLUSION: mask may only attach to structural group frames (${tag.name})`);
      continue;
    }
    const maskId = maskReference.match(/url\(#([^)]*)\)/i)?.[1];
    const mask = maskId ? masks.get(maskId) : undefined;
    if (!mask) {
      errors.push(`STRUCTURAL_OCCLUSION: structural group ${attribute(tag.source, "data-group") || "unknown"} references a missing mask`);
      continue;
    }
    if (attribute(mask.source, "mask-type") !== "alpha") errors.push(`STRUCTURAL_OCCLUSION: mask ${maskId} must declare mask-type=alpha`);
    if (attribute(mask.source, "maskUnits") !== "userSpaceOnUse" || attribute(mask.source, "maskContentUnits") !== "userSpaceOnUse") errors.push(`STRUCTURAL_OCCLUSION: mask ${maskId} must use userSpaceOnUse units`);
    const cutouts = elements.filter((candidate) => candidate.ancestors.includes(mask) && (attribute(candidate.source, "fill-opacity") === "0" || attribute(candidate.source, "opacity") === "0"));
    if (cutouts.length === 0) errors.push(`STRUCTURAL_OCCLUSION: mask ${maskId} must contain a transparent cutout`);
  }
  for (const mask of masks.values()) {
    if (attribute(mask.source, "mask-type") !== undefined && attribute(mask.source, "mask-type") !== "alpha") errors.push(`STRUCTURAL_OCCLUSION: mask ${attribute(mask.source, "id") || "unknown"} has an unsupported mask-type`);
  }
  return errors;
}

function pathBounds(path: string): { width: number; height: number } | null {
  const values = (path.match(/[-+]?(?:\d*\.?\d+)(?:[eE][-+]?\d+)?/g) || []).map(Number);
  if (values.length < 4 || values.length % 2 !== 0 || values.some((value) => !Number.isFinite(value))) return null;
  const xs = values.filter((_, index) => index % 2 === 0);
  const ys = values.filter((_, index) => index % 2 === 1);
  return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

export function diagramVisualStyleErrors(svg: string): string[] {
  const errors: string[] = [];
  const elements = tags(svg);
  errors.push(...structuralMaskErrors(elements));
  const backgrounds = elements.filter((tag) => attribute(tag.source, "data-canvas-background") !== undefined);
  if (backgrounds.length !== 1 || backgrounds[0]?.name !== "rect") {
    errors.push("VISUAL_STYLE: SVG must contain exactly one rect[data-canvas-background]");
  } else {
    const background = backgrounds[0];
    if (attribute(background.source, "x") !== "0" || attribute(background.source, "y") !== "0" || attribute(background.source, "width") !== "100%" || attribute(background.source, "height") !== "100%") errors.push("VISUAL_STYLE: canvas background must cover the complete SVG viewport");
    if (normalizedColor(attribute(background.source, "fill")) !== DIAGRAM_VISUAL_STYLE.canvasFill) errors.push(`VISUAL_STYLE: canvas background must be ${DIAGRAM_VISUAL_STYLE.canvasFill}`);
    if (!isNone(attribute(background.source, "stroke"))) errors.push("VISUAL_STYLE: canvas background must use stroke=none");
  }

  if (/\bdata-legend-item=["']|\bdata-note=["']/i.test(svg)) errors.push("VISUAL_STYLE: global legends and note layers are not allowed");

  const groupFrames = elements.filter((tag) => attribute(tag.source, "data-group") !== undefined);
  const groupTitles = elements.filter((tag) => tag.name === "text" && attribute(tag.source, "data-group-title") !== undefined);
  const structuralGroupIds = new Set<string>();
  for (const frame of groupFrames) {
    const groupId = attribute(frame.source, "data-group") || "unknown";
    const styleRole = attribute(frame.source, "data-group-style-role");
    if (styleRole !== undefined && !["structural", "business-boundary"].includes(styleRole)) errors.push(`GROUP_STYLE: group ${groupId} has invalid data-group-style-role ${styleRole}`);
    if (styleRole === "structural") {
      if (!attribute(frame.source, "data-group-role")) errors.push(`GROUP_STYLE: structural group ${groupId} must declare data-group-role`);
      structuralGroupIds.add(groupId);
    }
  }
  for (const groupId of structuralGroupIds) {
    const titles = groupTitles.filter((tag) => attribute(tag.source, "data-group-title") === groupId);
    if (titles.length !== 1 || attribute(titles[0]?.source || "", "data-group-style-role") !== "structural") errors.push(`GROUP_STYLE: structural group ${groupId} must have one matching structural title`);
  }
  for (const title of groupTitles) {
    const groupId = attribute(title.source, "data-group-title") || "unknown";
    const styleRole = attribute(title.source, "data-group-style-role");
    if (styleRole !== undefined && !["structural", "business-boundary"].includes(styleRole)) errors.push(`GROUP_STYLE: group title ${groupId} has invalid data-group-style-role ${styleRole}`);
    if (styleRole === "structural" && !structuralGroupIds.has(groupId)) errors.push(`GROUP_STYLE: structural group title ${groupId} has no matching structural group frame`);
  }

  for (const tag of elements) {
    for (const property of ["fill", "stroke", "color"]) {
      const raw = attribute(tag.source, property);
      if (raw === undefined || isNone(raw)) continue;
      const color = normalizedColor(raw);
      const permitsStructuralInk = color === DIAGRAM_VISUAL_STYLE.structuralGroupInk && isStructuralGroupElement(tag);
      const permitsWhite = color === DIAGRAM_VISUAL_STYLE.canvasFill && (attribute(tag.source, "data-canvas-background") !== undefined || isNodeShape(tag) || isInsideMask(tag));
      if (color !== DIAGRAM_VISUAL_STYLE.ink && !permitsWhite && !permitsStructuralInk) errors.push(`VISUAL_STYLE: ${tag.name} ${property} uses non-standard color ${raw}`);
      if (color === DIAGRAM_VISUAL_STYLE.canvasFill && !permitsWhite) errors.push(`VISUAL_STYLE: only the canvas background, business node shapes, or mask content may use ${DIAGRAM_VISUAL_STYLE.canvasFill}`);
    }
    for (const property of ["opacity", "fill-opacity", "stroke-opacity"]) {
      const raw = attribute(tag.source, property);
      const transparentMaskCutout = isInsideMask(tag) && property === "fill-opacity" && Number(raw) === 0;
      if (raw !== undefined && Number(raw) !== 1 && !transparentMaskCutout) errors.push(`VISUAL_STYLE: ${tag.name} ${property} must be 1 when declared`);
    }
  }

  for (const tag of elements.filter((entry) => entry.name === "text")) {
    const edgeLabel = attribute(tag.source, "data-edge-label") !== undefined;
    const expectedSize = edgeLabel ? DIAGRAM_VISUAL_STYLE.edgeLabelFontSize : DIAGRAM_VISUAL_STYLE.frameFontSize;
    if (edgeLabel && (attribute(tag.source, "text-anchor") !== "middle" || attribute(tag.source, "dominant-baseline") !== "middle")) errors.push("LABEL_STYLE: edge labels must use centered text-anchor and dominant-baseline");
    if (!hasPrimaryFont(attribute(tag.source, "font-family"))) errors.push(`FONT_STYLE: text must declare ${DIAGRAM_VISUAL_STYLE.fontFamily} with Microsoft YaHei first`);
    if (numericAttribute(tag.source, "font-size") !== expectedSize) errors.push(`FONT_STYLE: ${edgeLabel ? "edge label" : "frame text"} font-size must be ${expectedSize}`);
    if (normalizedColor(attribute(tag.source, "fill")) !== expectedInk(tag)) errors.push(`FONT_STYLE: text fill must be ${expectedInk(tag)}`);
  }

  const labelContainers = elements.filter((tag) => attribute(tag.source, "data-edge-label") !== undefined && !(tag.name === "path" && attribute(tag.source, "data-edge") !== undefined));
  if (labelContainers.some((tag) => tag.name !== "text")) errors.push("LABEL_STYLE: edge labels must be direct text elements without a frame or background container");

  for (const tag of elements.filter((entry) => FRAME_ELEMENTS.has(entry.name) && attribute(entry.source, "data-canvas-background") === undefined && !isInsideMask(entry))) {
    requireFrameStyle(tag, `${tag.name} frame`, errors);
  }
  for (const tag of elements.filter((entry) => ["line", "polyline"].includes(entry.name) && !isInsideMask(entry))) requireFrameStyle(tag, tag.name, errors);

  const edgePaths = elements.filter((tag) => tag.name === "path" && attribute(tag.source, "data-edge") !== undefined && attribute(tag.source, "data-edge-arrow") === undefined);
  for (const tag of edgePaths) requireFrameStyle(tag, `edge ${attribute(tag.source, "data-edge") || "unknown"}`, errors);

  const directPathFrames = elements.filter((tag) => tag.name === "path" && attribute(tag.source, "data-node") !== undefined && !isInsideMask(tag));
  for (const tag of directPathFrames) requireFrameStyle(tag, `node ${attribute(tag.source, "data-node") || "unknown"}`, errors);

  const arrowPaths = elements.filter((tag) => tag.name === "path" && attribute(tag.source, "data-edge-arrow") !== undefined);
  for (const tag of arrowPaths) {
    const edgeId = attribute(tag.source, "data-edge-arrow") || "unknown";
    if (normalizedColor(attribute(tag.source, "fill")) !== DIAGRAM_VISUAL_STYLE.ink) errors.push(`ARROW_SIZE: arrow ${edgeId} fill must be ${DIAGRAM_VISUAL_STYLE.ink}`);
    const bounds = pathBounds(attribute(tag.source, "d") || "");
    if (!bounds || Math.abs(bounds.width - DIAGRAM_VISUAL_STYLE.arrowWidth) > 0.01 || Math.abs(bounds.height - DIAGRAM_VISUAL_STYLE.arrowHeight) > 0.01) errors.push(`ARROW_SIZE: arrow ${edgeId} must be ${DIAGRAM_VISUAL_STYLE.arrowWidth}x${DIAGRAM_VISUAL_STYLE.arrowHeight}`);
  }

  const markerBlocks = [...svg.matchAll(/<marker\b([^>]*)>([\s\S]*?)<\/marker>/gi)];
  if (markerBlocks.length === 0) errors.push("ARROW_SIZE: SVG must define an arrow marker");
  for (const marker of markerBlocks) {
    const markerTag = `<marker${marker[1]}>`;
    if (numericAttribute(markerTag, "markerWidth") !== DIAGRAM_VISUAL_STYLE.arrowWidth || numericAttribute(markerTag, "markerHeight") !== DIAGRAM_VISUAL_STYLE.arrowHeight || attribute(markerTag, "markerUnits") !== "userSpaceOnUse") errors.push(`ARROW_SIZE: marker must use ${DIAGRAM_VISUAL_STYLE.arrowWidth}x${DIAGRAM_VISUAL_STYLE.arrowHeight} userSpaceOnUse dimensions`);
    const markerShapes = tags(marker[2]).filter((tag) => ["path", "polygon"].includes(tag.name));
    if (markerShapes.length === 0 || markerShapes.some((tag) => normalizedColor(attribute(tag.source, "fill")) !== DIAGRAM_VISUAL_STYLE.ink)) errors.push(`ARROW_SIZE: marker shape fill must be ${DIAGRAM_VISUAL_STYLE.ink}`);
  }

  return [...new Set(errors)];
}

export function diagramTextLines(value: string | string[]): string[] {
  const lines = (Array.isArray(value) ? value : [value]).flatMap((line) => String(line).split(/\r?\n/));
  return lines.length > 0 ? lines : [""];
}

export function measureDiagramText(text: string, fontSize: number): number {
  return [...text].reduce((width, character) => {
    if (/\s/.test(character)) return width + fontSize * 0.35;
    return width + (character.codePointAt(0)! >= 0x2e80 ? fontSize : fontSize * 0.56);
  }, 0);
}

export function diagramShapeProfile(shape: string | undefined): DiagramShapeProfile {
  const profile = DIAGRAM_SHAPE_PROFILES[shape as DiagramShape];
  if (!profile) throw new Error(`unsupported diagram shape: ${shape}`);
  return profile;
}

export function calculateDiagramAxisSpacing(referenceRectWidth: number, referenceRectHeight: number = DIAGRAM_SHAPE_PROFILES.rect.minHeight): DiagramAxisSpacing {
  const width = Math.ceil(Math.max(DIAGRAM_SHAPE_PROFILES.rect.minWidth, Number.isFinite(referenceRectWidth) ? referenceRectWidth : DIAGRAM_SHAPE_PROFILES.rect.minWidth));
  const height = Math.ceil(Math.max(DIAGRAM_SHAPE_PROFILES.rect.minHeight, Number.isFinite(referenceRectHeight) ? referenceRectHeight : DIAGRAM_SHAPE_PROFILES.rect.minHeight));
  const longSide = Math.max(width, height);
  const shortSide = Math.min(width, height);
  return {
    referenceShape: DIAGRAM_AXIS_SPACING_PROFILE.referenceShape,
    referenceWidth: width,
    referenceHeight: height,
    referenceLongSide: longSide,
    referenceShortSide: shortSide,
    lrMinimumGap: Math.ceil(longSide * DIAGRAM_AXIS_SPACING_PROFILE.lrFactor),
    tbMinimumGap: Math.ceil(height * DIAGRAM_AXIS_SPACING_PROFILE.tbFactor),
  };
}

export function calculateDiagramNodeSize(
  shape: string | undefined,
  label: string | string[],
  fontSize: number = DIAGRAM_VISUAL_STYLE.frameFontSize,
  overrides: { horizontalPadding?: number; verticalPadding?: number; lineHeight?: number; minWidth?: number; minHeight?: number } = {},
): { width: number; height: number } {
  const profile = diagramShapeProfile(shape ?? "rect");
  const lines = diagramTextLines(label);
  const horizontalPadding = overrides.horizontalPadding ?? DIAGRAM_GEOMETRY_PROFILE.nodeHorizontalPadding;
  const verticalPadding = overrides.verticalPadding ?? DIAGRAM_GEOMETRY_PROFILE.nodeVerticalPadding;
  const lineHeight = overrides.lineHeight ?? DIAGRAM_GEOMETRY_PROFILE.frameLineHeight;
  const textWidth = Math.max(...lines.map((line) => measureDiagramText(line, fontSize)));
  const textHeight = lines.length * lineHeight;
  const width = Math.ceil(Math.max(profile.minWidth, overrides.minWidth ?? 0, textWidth + horizontalPadding * 2));
  const height = Math.ceil(Math.max(profile.minHeight, overrides.minHeight ?? 0, textHeight + verticalPadding * 2));
  return profile.boundaryModel === "ellipse" && shape === "ellipse"
    ? { width, height: Math.max(height, Math.ceil(width * 0.6)) }
    : { width, height };
}

type DiagramNodeBox = { shape?: string; x: number; y: number; width: number; height: number };

export function diagramShapeContainsPoint(node: DiagramNodeBox, point: [number, number]): boolean {
  const profile = diagramShapeProfile(node.shape);
  const centerX = node.x + node.width / 2;
  const centerY = node.y + node.height / 2;
  if (profile.boundaryModel === "diamond") {
    return Math.abs(point[0] - centerX) / (node.width / 2) + Math.abs(point[1] - centerY) / (node.height / 2) < 1 - 1e-6;
  }
  if (profile.boundaryModel === "ellipse") {
    return ((point[0] - centerX) / (node.width / 2)) ** 2 + ((point[1] - centerY) / (node.height / 2)) ** 2 < 1 - 1e-6;
  }
  return point[0] > node.x + 1e-6 && point[0] < node.x + node.width - 1e-6 && point[1] > node.y + 1e-6 && point[1] < node.y + node.height - 1e-6;
}

/** Conservative boundary distance: the AABB distance never grants less clearance than the visible bounds require. */
export function diagramEntityGap(first: DiagramNodeBox, second: DiagramNodeBox): number {
  const horizontal = Math.max(0, first.x - (second.x + second.width), second.x - (first.x + first.width));
  const vertical = Math.max(0, first.y - (second.y + second.height), second.y - (first.y + first.height));
  return Math.hypot(horizontal, vertical);
}

export function diagramShapeBaseSizes(): Record<DiagramShape, { minWidth: number; minHeight: number; boundaryModel: DiagramBoundaryModel }> {
  return Object.fromEntries(Object.entries(DIAGRAM_SHAPE_PROFILES).map(([shape, profile]) => [shape, {
    minWidth: profile.minWidth,
    minHeight: profile.minHeight,
    boundaryModel: profile.boundaryModel,
  }])) as Record<DiagramShape, { minWidth: number; minHeight: number; boundaryModel: DiagramBoundaryModel }>;
}

export function diagramTextBounds(text: string | string[], fontSize: number): { width: number; height: number } {
  const lines = diagramTextLines(text);
  return {
    width: Math.max(...lines.map((line) => measureDiagramText(line, fontSize))),
    height: lines.length * DIAGRAM_LAYOUT_METRICS.frameLineHeight,
  };
}

function labelBounds(label: Label): { width: number; height: number } {
  return diagramTextBounds(label.text, label.fontSize ?? DIAGRAM_VISUAL_STYLE.edgeLabelFontSize);
}

export function edgeLabelPlacementError(edgeId: string, points: Point[], label: Label): string | null {
  const size = label.fontSize ?? DIAGRAM_VISUAL_STYLE.edgeLabelFontSize;
  if (size !== DIAGRAM_VISUAL_STYLE.edgeLabelFontSize) return `FONT_STYLE: edge ${edgeId} label font-size must be ${DIAGRAM_VISUAL_STYLE.edgeLabelFontSize}`;
  const box = labelBounds(label);
  for (let index = 1; index < points.length; index++) {
    const first = points[index - 1];
    const second = points[index];
    const dx = second[0] - first[0];
    const dy = second[1] - first[1];
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    const tangentX = dx / length;
    const tangentY = dy / length;
    const normalX = -tangentY;
    const normalY = tangentX;
    const midpointX = (first[0] + second[0]) / 2;
    const midpointY = (first[1] + second[1]) / 2;
    const offsetX = label.x - midpointX;
    const offsetY = label.y - midpointY;
    const parallelDistance = Math.abs(offsetX * tangentX + offsetY * tangentY);
    const perpendicularDistance = Math.abs(offsetX * normalX + offsetY * normalY);
    const perpendicularRadius = Math.abs(normalX) * box.width / 2 + Math.abs(normalY) * box.height / 2;
    if (parallelDistance <= 1 && perpendicularDistance >= perpendicularRadius + DIAGRAM_VISUAL_STYLE.labelClearance) return null;
  }
  return `LABEL_PLACEMENT: edge ${edgeId} label must be centered on one route segment and offset normally by at least ${DIAGRAM_VISUAL_STYLE.labelClearance}`;
}

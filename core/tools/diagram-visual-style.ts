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

/** Shared source-coordinate thresholds for text fit and structural group capacity. */
export const DIAGRAM_LAYOUT_METRICS = Object.freeze({
  nodeHorizontalPadding: 16,
  nodeVerticalPadding: 12,
  frameLineHeight: 24,
  groupTitleHorizontalPadding: 24,
  groupHeaderHeight: 48,
  groupHorizontalPadding: 40,
  groupBottomPadding: 32,
});

type SvgTag = { name: string; source: string };
type Label = { text: string | string[]; x: number; y: number; fontSize?: number };
type Point = [number, number];

const SVG_TAG = /<([A-Za-z][\w:-]*)\b[^>]*>/g;

function tags(svg: string): SvgTag[] {
  return [...svg.matchAll(SVG_TAG)].map((match) => ({ name: match[1].toLowerCase(), source: match[0] }));
}

function attribute(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i"))?.[1];
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
  if (!isNone(attribute(tag.source, "fill"))) errors.push(`VISUAL_STYLE: ${identity} must use fill=none`);
  if (normalizedColor(attribute(tag.source, "stroke")) !== ink) errors.push(`VISUAL_STYLE: ${identity} stroke must be ${ink}`);
  if (numericAttribute(tag.source, "stroke-width") !== DIAGRAM_VISUAL_STYLE.strokeWidth) errors.push(`VISUAL_STYLE: ${identity} stroke-width must be ${DIAGRAM_VISUAL_STYLE.strokeWidth}`);
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
      if (color !== DIAGRAM_VISUAL_STYLE.ink && color !== DIAGRAM_VISUAL_STYLE.canvasFill && !permitsStructuralInk) errors.push(`VISUAL_STYLE: ${tag.name} ${property} uses non-standard color ${raw}`);
      if (color === DIAGRAM_VISUAL_STYLE.canvasFill && attribute(tag.source, "data-canvas-background") === undefined) errors.push(`VISUAL_STYLE: only the canvas background may use ${DIAGRAM_VISUAL_STYLE.canvasFill}`);
    }
    for (const property of ["opacity", "fill-opacity", "stroke-opacity"]) {
      const raw = attribute(tag.source, property);
      if (raw !== undefined && Number(raw) !== 1) errors.push(`VISUAL_STYLE: ${tag.name} ${property} must be 1 when declared`);
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

  for (const tag of elements.filter((entry) => ["rect", "polygon", "ellipse", "circle"].includes(entry.name) && attribute(entry.source, "data-canvas-background") === undefined)) {
    requireFrameStyle(tag, `${tag.name} frame`, errors);
  }
  for (const tag of elements.filter((entry) => ["line", "polyline"].includes(entry.name))) requireFrameStyle(tag, tag.name, errors);

  const edgePaths = elements.filter((tag) => tag.name === "path" && attribute(tag.source, "data-edge") !== undefined && attribute(tag.source, "data-edge-arrow") === undefined);
  for (const tag of edgePaths) requireFrameStyle(tag, `edge ${attribute(tag.source, "data-edge") || "unknown"}`, errors);

  const directPathFrames = elements.filter((tag) => tag.name === "path" && attribute(tag.source, "data-node") !== undefined);
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

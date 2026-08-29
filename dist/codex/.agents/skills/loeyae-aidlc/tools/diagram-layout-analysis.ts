export type LayoutDirection = "TB" | "LR";

export type LayoutStrategy =
  | "LR_SINGLE_ROW"
  | "LR_COMPACT_BRANCH"
  | "TB_MAIN_AXIS"
  | "TB_MULTI_REGION"
  | "NEEDS_CONTEXT";

export interface FlowNodeInput {
  id: string;
  shape?: string;
  label?: string | string[];
}

export interface FlowEdgeInput {
  id: string;
  from: string;
  to: string;
  kind?: string;
  label?: string;
}

export interface PrimaryFlowInput {
  nodeIds: string[];
  edgeIds: string[];
  reason?: string;
}

export interface LayoutAnalysisOptions {
  feedbackEdgeIds?: string[];
  primaryFlow?: PrimaryFlowInput;
  availableWidth?: number;
  nodeGap?: number;
  fontSize?: number;
  nodeHorizontalPadding?: number;
  nodeVerticalPadding?: number;
  lineHeight?: number;
  minNodeWidth?: number;
  minNodeHeight?: number;
}

export interface BranchPathSummary {
  edgeId: string;
  targetNodeId: string;
  nodeIds: string[];
  decisionDepth: number;
  mergeNodeId?: string;
  terminalNodeIds: string[];
  cycleDetected: boolean;
}

export interface BranchGroupSummary {
  decisionNodeId: string;
  edgeIds: string[];
  paths: BranchPathSummary[];
  branchDepth: number;
  mergeNodeId?: string;
}

export interface LayoutAnalysis {
  nodeCount: number;
  edgeCount: number;
  connectedComponentCount: number;
  entryNodeIds: string[];
  exitNodeIds: string[];
  decisionNodeIds: string[];
  mergeNodeIds: string[];
  feedbackEdgeIds: string[];
  branchGroups: BranchGroupSummary[];
  branchGroupCount: number;
  branchPathCount: number;
  maxBranchDepth: number;
  maxParallelBranchCount: number;
  hasCycle: boolean;
  primaryFlow?: PrimaryFlowInput;
  primaryFlowStatus: "provided" | "missing";
  estimatedWidth: number;
  estimatedHeight: number;
  estimatedLinearWidth: number;
  estimatedLinearHeight: number;
  availableWidth: number;
}

export interface LayoutDecision {
  strategy: LayoutStrategy;
  direction: LayoutDirection | null;
  reasons: string[];
}

interface NormalizedGraph {
  nodes: FlowNodeInput[];
  edges: FlowEdgeInput[];
  nodeIds: Set<string>;
  edgeIds: Set<string>;
  outgoing: Map<string, FlowEdgeInput[]>;
  incoming: Map<string, FlowEdgeInput[]>;
  activeOutgoing: Map<string, FlowEdgeInput[]>;
  activeIncoming: Map<string, FlowEdgeInput[]>;
  feedbackEdgeIds: Set<string>;
}

interface NodeMetric {
  width: number;
  height: number;
}

interface PathState {
  rootEdgeId: string;
  targetNodeId: string;
  nodeId: string;
  nodeIds: string[];
  decisionDepth: number;
  visited: Set<string>;
}

const DEFAULT_AVAILABLE_WIDTH = 1600;
const DEFAULT_NODE_GAP = 48;
const DEFAULT_FONT_SIZE = 16;
const DEFAULT_NODE_HORIZONTAL_PADDING = 32;
const DEFAULT_NODE_VERTICAL_PADDING = 24;
const DEFAULT_LINE_HEIGHT = 24;
const DEFAULT_MIN_NODE_WIDTH = 160;
const DEFAULT_MIN_NODE_HEIGHT = 72;

function compareIds(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareIds);
}

function labelLines(label: string | string[] | undefined, fallback: string): string[] {
  const values = label === undefined ? [fallback] : Array.isArray(label) ? label : [label];
  const lines = values.flatMap((value) => String(value).split(/\r?\n/)).map((value) => value.trim()).filter(Boolean);
  return lines.length > 0 ? lines : [fallback];
}

function characterWidth(character: string, fontSize: number): number {
  if (/\s/.test(character)) return fontSize * 0.35;
  if (character.codePointAt(0)! >= 0x2e80) return fontSize;
  return fontSize * 0.56;
}

function measureText(text: string, fontSize: number): number {
  return [...text].reduce((width, character) => width + characterWidth(character, fontSize), 0);
}

function measureNode(node: FlowNodeInput, options: Required<Pick<LayoutAnalysisOptions, "fontSize" | "nodeHorizontalPadding" | "nodeVerticalPadding" | "lineHeight" | "minNodeWidth" | "minNodeHeight">>): NodeMetric {
  const lines = labelLines(node.label, node.id);
  const textWidth = Math.max(...lines.map((line) => measureText(line, options.fontSize)));
  const width = Math.ceil(Math.max(options.minNodeWidth, textWidth + options.nodeHorizontalPadding * 2));
  const height = Math.ceil(Math.max(options.minNodeHeight, lines.length * options.lineHeight + options.nodeVerticalPadding * 2));
  if (node.shape === "diamond") return { width: Math.max(width, 180), height: Math.max(height, 120) };
  return { width, height };
}

function normalizeGraph(nodes: FlowNodeInput[], edges: FlowEdgeInput[], feedbackEdgeIds: string[]): NormalizedGraph {
  if (nodes.length === 0) throw new Error("flow graph must contain at least one node");
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (!node.id.trim()) throw new Error("flow graph node id must not be empty");
    if (nodeIds.has(node.id)) throw new Error(`flow graph contains duplicate node ${node.id}`);
    nodeIds.add(node.id);
  }
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (!edge.id.trim()) throw new Error("flow graph edge id must not be empty");
    if (edgeIds.has(edge.id)) throw new Error(`flow graph contains duplicate edge ${edge.id}`);
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) throw new Error(`flow graph edge ${edge.id} references a missing node`);
    edgeIds.add(edge.id);
  }
  const feedback = new Set(feedbackEdgeIds);
  for (const edgeId of feedback) if (!edgeIds.has(edgeId)) throw new Error(`feedback edge ${edgeId} does not exist`);
  const outgoing = new Map<string, FlowEdgeInput[]>();
  const incoming = new Map<string, FlowEdgeInput[]>();
  for (const node of nodes) {
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  }
  for (const edge of edges) {
    outgoing.get(edge.from)!.push(edge);
    incoming.get(edge.to)!.push(edge);
  }
  const activeOutgoing = new Map<string, FlowEdgeInput[]>();
  const activeIncoming = new Map<string, FlowEdgeInput[]>();
  for (const node of nodes) {
    activeOutgoing.set(node.id, outgoing.get(node.id)!.filter((edge) => !feedback.has(edge.id)));
    activeIncoming.set(node.id, incoming.get(node.id)!.filter((edge) => !feedback.has(edge.id)));
  }
  return { nodes, edges, nodeIds, edgeIds, outgoing, incoming, activeOutgoing, activeIncoming, feedbackEdgeIds: feedback };
}

function connectedComponentCount(graph: NormalizedGraph): number {
  const neighbors = new Map<string, Set<string>>([...graph.nodeIds].map((id) => [id, new Set<string>()]));
  for (const edge of graph.edges) {
    neighbors.get(edge.from)!.add(edge.to);
    neighbors.get(edge.to)!.add(edge.from);
  }
  const visited = new Set<string>();
  let count = 0;
  for (const nodeId of [...graph.nodeIds].sort(compareIds)) {
    if (visited.has(nodeId)) continue;
    count += 1;
    const queue = [nodeId];
    visited.add(nodeId);
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const neighbor of neighbors.get(current)!) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return count;
}

function topologicalOrder(graph: NormalizedGraph): { order: string[]; hasCycle: boolean } {
  const indegree = new Map<string, number>([...graph.nodeIds].map((id) => [id, graph.activeIncoming.get(id)!.length]));
  const queue = [...graph.nodeIds].filter((id) => indegree.get(id) === 0).sort(compareIds);
  const order: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);
    for (const edge of graph.activeOutgoing.get(current)!) {
      const next = indegree.get(edge.to)! - 1;
      indegree.set(edge.to, next);
      if (next === 0) {
        queue.push(edge.to);
        queue.sort(compareIds);
      }
    }
  }
  return { order, hasCycle: order.length !== graph.nodes.length };
}

function validatePrimaryFlow(primaryFlow: PrimaryFlowInput | undefined, graph: NormalizedGraph): PrimaryFlowInput | undefined {
  if (!primaryFlow) return undefined;
  if (primaryFlow.nodeIds.length === 0 || primaryFlow.edgeIds.length === 0) throw new Error("primary flow must contain node and edge ids");
  for (const nodeId of primaryFlow.nodeIds) if (!graph.nodeIds.has(nodeId)) throw new Error(`primary flow references missing node ${nodeId}`);
  for (const edgeId of primaryFlow.edgeIds) if (!graph.edgeIds.has(edgeId)) throw new Error(`primary flow references missing edge ${edgeId}`);
  return {
    nodeIds: [...primaryFlow.nodeIds],
    edgeIds: [...primaryFlow.edgeIds],
    ...(primaryFlow.reason ? { reason: primaryFlow.reason } : {}),
  };
}

function branchPathSummaries(
  graph: NormalizedGraph,
  decisionNodeId: string,
  decisionNodeIds: Set<string>,
  mergeNodeIds: Set<string>,
): BranchPathSummary[] {
  const paths: BranchPathSummary[] = [];
  const firstEdges = [...graph.activeOutgoing.get(decisionNodeId)!].sort((left, right) => compareIds(left.id, right.id));
  const queue: PathState[] = firstEdges.map((edge) => ({
    rootEdgeId: edge.id,
    targetNodeId: edge.to,
    nodeId: edge.to,
    nodeIds: [edge.to],
    decisionDepth: decisionNodeIds.has(edge.to) ? 1 : 0,
    visited: new Set([decisionNodeId, edge.to]),
  }));
  while (queue.length > 0) {
    const state = queue.shift()!;
    const outgoing = graph.activeOutgoing.get(state.nodeId)!;
    if (mergeNodeIds.has(state.nodeId)) {
      paths.push({ edgeId: state.rootEdgeId, targetNodeId: state.targetNodeId, nodeIds: state.nodeIds, decisionDepth: state.decisionDepth, mergeNodeId: state.nodeId, terminalNodeIds: [], cycleDetected: false });
      continue;
    }
    if (outgoing.length === 0) {
      paths.push({ edgeId: state.rootEdgeId, targetNodeId: state.targetNodeId, nodeIds: state.nodeIds, decisionDepth: state.decisionDepth, terminalNodeIds: [state.nodeId], cycleDetected: false });
      continue;
    }
    const nextEdges = [...outgoing].sort((left, right) => compareIds(left.id, right.id));
    for (const edge of nextEdges) {
      if (state.visited.has(edge.to)) {
        paths.push({ edgeId: state.rootEdgeId, targetNodeId: state.targetNodeId, nodeIds: state.nodeIds, decisionDepth: state.decisionDepth, terminalNodeIds: [state.nodeId], cycleDetected: true });
        continue;
      }
      const visited = new Set(state.visited);
      visited.add(edge.to);
      queue.push({
        rootEdgeId: state.rootEdgeId,
        targetNodeId: state.targetNodeId,
        nodeId: edge.to,
        nodeIds: [...state.nodeIds, edge.to],
        decisionDepth: state.decisionDepth + (decisionNodeIds.has(edge.to) ? 1 : 0),
        visited,
      });
    }
  }
  return paths;
}

function longestPathMetrics(graph: NormalizedGraph, metrics: Map<string, NodeMetric>, nodeGap: number): { width: number; height: number } {
  const { order, hasCycle } = topologicalOrder(graph);
  if (hasCycle) {
    const maxNodeWidth = Math.max(...[...metrics.values()].map((metric) => metric.width));
    const maxNodeHeight = Math.max(...[...metrics.values()].map((metric) => metric.height));
    return { width: maxNodeWidth * graph.nodes.length + nodeGap * Math.max(0, graph.nodes.length - 1), height: maxNodeHeight * graph.nodes.length + nodeGap * Math.max(0, graph.nodes.length - 1) };
  }
  const distance = new Map<string, { width: number; height: number }>();
  for (const nodeId of graph.nodeIds) {
    const metric = metrics.get(nodeId)!;
    distance.set(nodeId, { width: metric.width, height: metric.height });
  }
  for (const nodeId of order) {
    const current = distance.get(nodeId)!;
    for (const edge of graph.activeOutgoing.get(nodeId)!) {
      const target = distance.get(edge.to)!;
      const targetMetric = metrics.get(edge.to)!;
      const candidate = { width: current.width + nodeGap + targetMetric.width, height: current.height + nodeGap + targetMetric.height };
      if (candidate.width > target.width) target.width = candidate.width;
      if (candidate.height > target.height) target.height = candidate.height;
    }
  }
  return {
    width: Math.max(...[...distance.values()].map((value) => value.width)),
    height: Math.max(...[...distance.values()].map((value) => value.height)),
  };
}

export function analyzeFlowGraph(nodes: FlowNodeInput[], edges: FlowEdgeInput[], options: LayoutAnalysisOptions = {}): LayoutAnalysis {
  const feedbackEdgeIds = uniqueSorted(options.feedbackEdgeIds ?? []);
  const graph = normalizeGraph(nodes, edges, feedbackEdgeIds);
  const primaryFlow = validatePrimaryFlow(options.primaryFlow, graph);
  const activeOutgoing = graph.activeOutgoing;
  const activeIncoming = graph.activeIncoming;
  const entryNodeIds = uniqueSorted(graph.nodes.filter((node) => activeIncoming.get(node.id)!.length === 0).map((node) => node.id));
  const exitNodeIds = uniqueSorted(graph.nodes.filter((node) => activeOutgoing.get(node.id)!.length === 0).map((node) => node.id));
  const decisionNodeIds = uniqueSorted(graph.nodes.filter((node) => activeOutgoing.get(node.id)!.length >= 2).map((node) => node.id));
  const mergeNodeIds = uniqueSorted(graph.nodes.filter((node) => activeIncoming.get(node.id)!.length >= 2).map((node) => node.id));
  const decisionSet = new Set(decisionNodeIds);
  const mergeSet = new Set(mergeNodeIds);
  const branchGroups = decisionNodeIds.map((decisionNodeId) => {
    const paths = branchPathSummaries(graph, decisionNodeId, decisionSet, mergeSet);
    const mergeCandidates = uniqueSorted(paths.map((path) => path.mergeNodeId).filter((id): id is string => id !== undefined));
    return {
      decisionNodeId,
      edgeIds: [...graph.activeOutgoing.get(decisionNodeId)!].map((edge) => edge.id).sort(compareIds),
      paths,
      branchDepth: Math.max(0, ...paths.map((path) => path.decisionDepth)),
      ...(mergeCandidates.length === 1 ? { mergeNodeId: mergeCandidates[0] } : {}),
    };
  });
  const metricOptions = {
    fontSize: options.fontSize ?? DEFAULT_FONT_SIZE,
    nodeHorizontalPadding: options.nodeHorizontalPadding ?? DEFAULT_NODE_HORIZONTAL_PADDING,
    nodeVerticalPadding: options.nodeVerticalPadding ?? DEFAULT_NODE_VERTICAL_PADDING,
    lineHeight: options.lineHeight ?? DEFAULT_LINE_HEIGHT,
    minNodeWidth: options.minNodeWidth ?? DEFAULT_MIN_NODE_WIDTH,
    minNodeHeight: options.minNodeHeight ?? DEFAULT_MIN_NODE_HEIGHT,
  };
  const metrics = new Map(graph.nodes.map((node) => [node.id, measureNode(node, metricOptions)]));
  const nodeGap = options.nodeGap ?? DEFAULT_NODE_GAP;
  const linear = longestPathMetrics(graph, metrics, nodeGap);
  const maxNodeWidth = Math.max(...[...metrics.values()].map((metric) => metric.width));
  const maxBranchWidth = Math.max(0, ...branchGroups.map((group) => group.paths.reduce((width, path) => width + (metrics.get(path.targetNodeId)?.width ?? maxNodeWidth), 0) + Math.max(0, group.paths.length - 1) * nodeGap));
  const maxBranchHeight = Math.max(0, ...branchGroups.flatMap((group) => group.paths.map((path) => path.nodeIds.reduce((height, nodeId) => height + (metrics.get(nodeId)?.height ?? 0), 0) + Math.max(0, path.nodeIds.length - 1) * nodeGap)));
  const estimatedWidth = Math.ceil(Math.max(linear.width, maxNodeWidth + maxBranchWidth + nodeGap * 2));
  const estimatedHeight = Math.ceil(Math.max(linear.height, maxBranchHeight));
  const { hasCycle } = topologicalOrder(graph);
  const branchPathCount = branchGroups.reduce((count, group) => count + group.paths.length, 0);
  return {
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    connectedComponentCount: connectedComponentCount(graph),
    entryNodeIds,
    exitNodeIds,
    decisionNodeIds,
    mergeNodeIds,
    feedbackEdgeIds,
    branchGroups,
    branchGroupCount: branchGroups.length,
    branchPathCount,
    maxBranchDepth: Math.max(0, ...branchGroups.map((group) => group.branchDepth)),
    maxParallelBranchCount: Math.max(0, ...branchGroups.map((group) => group.edgeIds.length)),
    hasCycle,
    ...(primaryFlow ? { primaryFlow } : {}),
    primaryFlowStatus: primaryFlow ? "provided" : "missing",
    estimatedWidth,
    estimatedHeight,
    estimatedLinearWidth: Math.ceil(linear.width),
    estimatedLinearHeight: Math.ceil(linear.height),
    availableWidth: options.availableWidth ?? DEFAULT_AVAILABLE_WIDTH,
  };
}

export function chooseLayoutDirection(analysis: LayoutAnalysis): LayoutDecision {
  const reasons: string[] = [];
  if (analysis.connectedComponentCount > 1) {
    return { strategy: "TB_MULTI_REGION", direction: "TB", reasons: ["multiple-connected-components"] };
  }
  if (analysis.entryNodeIds.length !== 1) {
    return { strategy: "NEEDS_CONTEXT", direction: null, reasons: ["multiple-or-missing-entry-nodes"] };
  }
  if (analysis.hasCycle && analysis.feedbackEdgeIds.length === 0) reasons.push("unclassified-cycle-requires-tb");
  if (analysis.feedbackEdgeIds.length > 0) reasons.push("feedback-requires-tb");
  if (analysis.maxBranchDepth > 0) reasons.push("nested-branch-requires-tb");
  if (analysis.branchGroupCount > 1) reasons.push("multiple-decisions-require-tb");
  if (analysis.maxParallelBranchCount > 2) reasons.push("wide-branch-requires-tb");
  if (analysis.estimatedWidth > analysis.availableWidth) reasons.push("estimated-width-exceeds-available");
  if (reasons.length === 0 && analysis.decisionNodeIds.length === 0) {
    return { strategy: "LR_SINGLE_ROW", direction: "LR", reasons: ["single-linear-flow-fits-available-width"] };
  }
  if (reasons.length === 0 && analysis.decisionNodeIds.length === 1 && analysis.maxBranchDepth === 0 && analysis.maxParallelBranchCount <= 2) {
    return { strategy: "LR_COMPACT_BRANCH", direction: "LR", reasons: ["single-shallow-branch-fits-available-width"] };
  }
  return { strategy: "TB_MAIN_AXIS", direction: "TB", reasons: reasons.length > 0 ? reasons : ["complex-flow-defaults-to-tb"] };
}

export function analyzeAndChooseLayout(nodes: FlowNodeInput[], edges: FlowEdgeInput[], options: LayoutAnalysisOptions = {}): { analysis: LayoutAnalysis; decision: LayoutDecision } {
  const analysis = analyzeFlowGraph(nodes, edges, options);
  return { analysis, decision: chooseLayoutDirection(analysis) };
}

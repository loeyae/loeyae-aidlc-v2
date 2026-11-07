export type FinalStatus = "PASS" | "STATIC_PASS" | "UNVERIFIED" | "NEEDS_CAPABILITY" | "FAIL";

export const FINAL_STATUSES = new Set<FinalStatus>([
  "PASS",
  "STATIC_PASS",
  "UNVERIFIED",
  "NEEDS_CAPABILITY",
  "FAIL",
]);

export interface ExpectedSource {
  kind: string;
  ref: string;
  revision: string;
  digest: string;
}

export interface ExpectedGenerator {
  name: string;
  version: string;
  configSummary: string;
  configDigest: string;
  sourceRefs: string[];
}

export type RouteDirection = "left" | "right" | "up" | "down";

export interface ExpectedRouteTopology {
  orthogonal: boolean;
  segmentCount?: number;
  directions?: RouteDirection[];
}

export interface ExpectedRouteIntent {
  edgeId: string;
  kind: "direct" | "manhattan" | "branch" | "loop" | "feedback" | "relation" | "custom";
  bendCount?: number;
  minBendCount?: number;
  maxBendCount?: number;
  labelRequired: boolean;
  laneId?: string;
  arrowTarget?: string;
  labelText?: string;
  topology?: ExpectedRouteTopology;
}

export interface ExpectedMainFlow {
  entryNodeIds: string[];
  exitNodeIds: string[];
  nodeIds: string[];
  edgeIds: string[];
}

export interface ExpectedLoopLane {
  id: string;
  side: "left" | "right";
  laneOffset: number;
  edgeIds: string[];
  reason: string;
}

export interface ExpectedShapeBaseSize {
  minWidth: number;
  minHeight: number;
  boundaryModel: string;
}

export interface ExpectedAxisSpacing {
  referenceShape: "rect";
  referenceWidth: number;
  referenceHeight: number;
  referenceLongSide: number;
  referenceShortSide: number;
  lrMinimumGap: number;
  tbMinimumGap: number;
}

export interface ExpectedGeometryProfile {
  version: string;
  entityGap: number;
  portGap: number;
  obstacleGap: number;
  laneGap: number;
  shapeBaseSizes: Record<string, ExpectedShapeBaseSize>;
  axisSpacing?: ExpectedAxisSpacing;
}

export interface ExpectedBranchLayoutGroup {
  id: string;
  decisionNodeId: string;
  edgeIds: string[];
  targetIds: string[];
  branchOrder: string[];
  layoutCandidateEdgeId: string;
  primaryEdgeId?: string;
  mergeNodeId?: string;
  depth: number;
  mode: "inline" | "local-lane";
  branchGap: number;
}

export interface ExpectedBranchLayoutPlan {
  strategy: string;
  frozenOrder: string[];
  baselineGap: number;
  groups: ExpectedBranchLayoutGroup[];
}

export interface ExpectedMergeNode {
  nodeId: string;
  edgeIds: string[];
  ports: Record<string, string>;
}

export type ExpectedExceptionType = "crossing" | "side-switch" | "branch-port" | "branch-layer";

export interface ExpectedException {
  type: ExpectedExceptionType;
  object: { kind: "edge" | "edge-pair"; ids: string[] };
  edgeIds: string[];
  businessReason: string;
  geometricReason: string;
  scope: { diagramId: string; appliesTo: string[]; condition: string };
  visualEvidence: { required: true; refs: string[] };
}

export interface ExpectedPrimaryFlow {
  nodeIds: string[];
  edgeIds: string[];
  reason: string;
}

export interface ExpectedBranchGroup {
  targetIds: string[];
  direction: "TB" | "LR";
  tolerance: number;
  id?: string;
  decisionNodeId?: string;
  edgeIds?: string[];
  mergeNodeId?: string;
  depth?: number;
  mode?: "inline" | "local-lane";
  reason?: string;
}

export interface ExpectedSourceNode {
  sourceId: string;
  displayId: string;
  label: string;
  shape: string;
}

export interface ExpectedSourceRelation {
  sourceOrdinal: number;
  fromSourceId: string;
  toSourceId: string;
  displayEdgeId: string;
  kind: string;
  label?: string;
  displayLabel?: string;
}

export interface ExpectedReadingPath {
  id: string;
  nodeIds: string[];
  edgeIds: string[];
  requiredLabels: string[];
}

export interface ExpectedSourceGraph {
  nodes: ExpectedSourceNode[];
  relations: ExpectedSourceRelation[];
  readingPaths: ExpectedReadingPath[];
}

export interface ExpectedRouteContract {
  direction?: "TB" | "LR";
  affectedEdgeIds: string[];
  edgeIntents: ExpectedRouteIntent[];
  mainFlow?: ExpectedMainFlow;
  primaryFlow?: ExpectedPrimaryFlow;
  loopLanes: ExpectedLoopLane[];
  mergeNodes: ExpectedMergeNode[];
  branchGroups: ExpectedBranchGroup[];
  geometryProfile?: ExpectedGeometryProfile;
  branchLayoutPlan?: ExpectedBranchLayoutPlan;
  exceptions: ExpectedException[];
}

export interface ExpectedContract {
  diagramId: string;
  diagramType?: string;
  intent: string;
  source: ExpectedSource;
  generator: ExpectedGenerator;
  nodeIds: string[];
  nodeShapes: Record<string, string | undefined>;
  edgeIds: string[];
  edgeEndpoints: Record<string, { from: string; to: string }>;
  edgePorts: Record<string, { fromPort?: string; toPort?: string }>;
  edgeArrowTargets: Record<string, string | undefined>;
  edgeKinds: Record<string, string | undefined>;
  groupIds: string[];
  groupTypes: Record<string, { semanticType: string; parent?: string }>;
  legendIds: string[];
  annotationIds: string[];
  decisionNodeIds: string[];
  lifelineIds: string[];
  directedEdgeCount: number;
  routeContract: ExpectedRouteContract;
  sourceGraph?: ExpectedSourceGraph;
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`);
  return value as Record<string, unknown>;
}

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

function stringArray(value: unknown, field: string, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || !value.every((item) => typeof item === "string" && item.trim().length > 0)) {
    throw new Error(`${field} must be ${allowEmpty ? "an" : "a non-empty"} string array`);
  }
  const result = (value as string[]).map((item) => item.trim());
  if (new Set(result).size !== result.length) throw new Error(`${field} must not contain duplicate IDs`);
  return result;
}

function finiteNumber(value: unknown, field: string, minimum?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || (minimum !== undefined && value < minimum)) throw new Error(`${field} must be a finite number${minimum === undefined ? "" : ` >= ${minimum}`}`);
  return value;
}

function sha256Digest(value: unknown, field: string): string {
  const digest = nonEmpty(value, field);
  if (!/^sha256:[0-9a-f]{64}$/i.test(digest)) throw new Error(`${field} must be sha256:<64 hex characters>`);
  return digest;
}

function assertNoActualGeometry(value: Record<string, unknown>, field: string): void {
  for (const key of ["x", "y", "width", "height", "points", "bbox", "edgeBBoxes", "nodeCenters", "coordinates"]) {
    if (key in value) throw new Error(`${field}.${key} is actual geometry and is not allowed in expected contract`);
  }
}

function parseSource(value: unknown): ExpectedSource {
  const source = asRecord(value, "expected contract source");
  const ref = nonEmpty(source.ref, "expected contract source.ref");
  if (/\.svg(?:$|[?#])|\.diagram\.json(?:$|[?#])|sidecar/i.test(ref)) throw new Error("expected contract source.ref must identify business/design source, not SVG or sidecar actual");
  return {
    kind: nonEmpty(source.kind, "expected contract source.kind"),
    ref,
    revision: nonEmpty(source.revision, "expected contract source.revision"),
    digest: sha256Digest(source.digest, "expected contract source.digest"),
  };
}

function parseGenerator(value: unknown, field: string): ExpectedGenerator {
  const generator = asRecord(value, field);
  const sourceRefs = stringArray(generator.source_refs, `${field}.source_refs`);
  if (sourceRefs.some((ref) => /\.svg(?:$|[?#])|\.diagram\.json(?:$|[?#])|sidecar/i.test(ref))) throw new Error(`${field}.source_refs must not use SVG or sidecar actual as source`);
  return {
    name: nonEmpty(generator.name, `${field}.name`),
    version: nonEmpty(generator.version, `${field}.version`),
    configSummary: nonEmpty(generator.config_summary, `${field}.config_summary`),
    configDigest: sha256Digest(generator.config_digest, `${field}.config_digest`),
    sourceRefs,
  };
}

function parseRouteTopology(value: unknown, field: string): ExpectedRouteTopology {
  const topology = asRecord(value, field);
  if (typeof topology.orthogonal !== "boolean") throw new Error(`${field}.orthogonal must be boolean`);
  const segmentCount = topology.segment_count === undefined ? undefined : finiteNumber(topology.segment_count, `${field}.segment_count`, 1);
  if (segmentCount !== undefined && !Number.isInteger(segmentCount)) throw new Error(`${field}.segment_count must be an integer`);
  const rawDirections = topology.directions === undefined ? undefined : stringArray(topology.directions, `${field}.directions`);
  const directions = rawDirections?.map((direction) => {
    if (!["left", "right", "up", "down"].includes(direction)) throw new Error(`${field}.directions contains invalid direction ${direction}`);
    return direction as RouteDirection;
  });
  if (segmentCount !== undefined && directions !== undefined && segmentCount !== directions.length) throw new Error(`${field}.segment_count must equal directions.length`);
  return {
    orthogonal: topology.orthogonal,
    ...(segmentCount === undefined ? {} : { segmentCount }),
    ...(directions === undefined ? {} : { directions }),
  };
}

function parseExpectedException(value: unknown, index: number, diagramId: string, edgeIds: Set<string>): ExpectedException {
  const field = `route_contract.exceptions[${index}]`;
  const exception = asRecord(value, field);
  const type = nonEmpty(exception.type, `${field}.type`) as ExpectedExceptionType;
  if (!["crossing", "side-switch", "branch-port", "branch-layer"].includes(type)) throw new Error(`${field}.type is invalid`);
  const object = asRecord(exception.object, `${field}.object`);
  const kind = nonEmpty(object.kind, `${field}.object.kind`) as "edge" | "edge-pair";
  if (!["edge", "edge-pair"].includes(kind)) throw new Error(`${field}.object.kind is invalid`);
  const ids = stringArray(object.ids, `${field}.object.ids`);
  if ((type === "crossing" && (kind !== "edge-pair" || ids.length !== 2)) || (type !== "crossing" && ids.length < 1)) throw new Error(`${field}.object does not match exception type ${type}`);
  for (const id of ids) if (!edgeIds.has(id)) throw new Error(`${field}.object references missing edge ${id}`);
  const scope = asRecord(exception.scope, `${field}.scope`);
  const scopeDiagramId = nonEmpty(scope.diagram_id, `${field}.scope.diagram_id`);
  if (scopeDiagramId !== diagramId) throw new Error(`${field}.scope.diagram_id must match ${diagramId}`);
  const appliesTo = stringArray(scope.applies_to, `${field}.scope.applies_to`);
  const visualEvidence = asRecord(exception.visual_evidence, `${field}.visual_evidence`);
  if (visualEvidence.required !== true) throw new Error(`${field}.visual_evidence.required must be true`);
  const refs = stringArray(visualEvidence.refs, `${field}.visual_evidence.refs`);
  return {
    type,
    object: { kind, ids },
    edgeIds: ids,
    businessReason: nonEmpty(exception.business_reason, `${field}.business_reason`),
    geometricReason: nonEmpty(exception.geometric_reason, `${field}.geometric_reason`),
    scope: { diagramId: scopeDiagramId, appliesTo, condition: nonEmpty(scope.condition, `${field}.scope.condition`) },
    visualEvidence: { required: true, refs },
  };
}

function parseSourceGraph(value: unknown, diagramId: string, nodeIds: string[], nodeShapes: Record<string, string | undefined>, edgeIds: string[], edgeEndpoints: Record<string, { from: string; to: string }>, edgeKinds: Record<string, string | undefined>): ExpectedSourceGraph {
  const graph = asRecord(value, `expected diagram ${diagramId}.source_graph`);
  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) throw new Error(`expected diagram ${diagramId}.source_graph.nodes must be non-empty`);
  const sourceNodes = new Map<string, ExpectedSourceNode>();
  const displayNodes = new Set<string>();
  for (let index = 0; index < graph.nodes.length; index++) {
    const field = `expected diagram ${diagramId}.source_graph.nodes[${index}]`;
    const raw = asRecord(graph.nodes[index], field);
    const sourceId = nonEmpty(raw.source_id, `${field}.source_id`);
    const displayId = nonEmpty(raw.display_id, `${field}.display_id`);
    const label = nonEmpty(raw.label, `${field}.label`);
    const shape = nonEmpty(raw.shape, `${field}.shape`);
    if (sourceNodes.has(sourceId) || displayNodes.has(displayId)) throw new Error(`${field} duplicates a source_id or display_id`);
    if (!nodeIds.includes(displayId)) throw new Error(`${field}.display_id references missing expected node ${displayId}`);
    if (nodeShapes[displayId] !== undefined && nodeShapes[displayId] !== shape) throw new Error(`${field}.shape must match expected node ${displayId}`);
    sourceNodes.set(sourceId, { sourceId, displayId, label, shape });
    displayNodes.add(displayId);
  }
  if (displayNodes.size !== nodeIds.length || nodeIds.some((id) => !displayNodes.has(id))) throw new Error(`expected diagram ${diagramId}.source_graph must map every expected node exactly once`);
  if (!Array.isArray(graph.relations) || graph.relations.length === 0) throw new Error(`expected diagram ${diagramId}.source_graph.relations must be non-empty`);
  const sourceOrdinals = new Set<number>();
  const relations: ExpectedSourceRelation[] = [];
  const byDisplay = new Map<string, ExpectedSourceRelation[]>();
  for (let index = 0; index < graph.relations.length; index++) {
    const field = `expected diagram ${diagramId}.source_graph.relations[${index}]`;
    const raw = asRecord(graph.relations[index], field);
    const sourceOrdinal = finiteNumber(raw.source_ordinal, `${field}.source_ordinal`, 1);
    if (!Number.isInteger(sourceOrdinal) || sourceOrdinals.has(sourceOrdinal)) throw new Error(`${field}.source_ordinal must be a unique positive integer`);
    sourceOrdinals.add(sourceOrdinal);
    const fromSourceId = nonEmpty(raw.from_source_id, `${field}.from_source_id`);
    const toSourceId = nonEmpty(raw.to_source_id, `${field}.to_source_id`);
    const displayEdgeId = nonEmpty(raw.display_edge_id, `${field}.display_edge_id`);
    const kind = nonEmpty(raw.kind, `${field}.kind`);
    const label = raw.label === undefined || raw.label === null ? undefined : nonEmpty(raw.label, `${field}.label`);
    const displayLabel = raw.display_label === undefined ? undefined : nonEmpty(raw.display_label, `${field}.display_label`);
    if (!sourceNodes.has(fromSourceId) || !sourceNodes.has(toSourceId)) throw new Error(`${field} references a missing source node`);
    if (!edgeIds.includes(displayEdgeId)) throw new Error(`${field}.display_edge_id references missing expected edge ${displayEdgeId}`);
    const endpoints = edgeEndpoints[displayEdgeId];
    if (endpoints.from !== sourceNodes.get(fromSourceId)!.displayId || endpoints.to !== sourceNodes.get(toSourceId)!.displayId) throw new Error(`SOURCE_RELATION_FIDELITY: ${field} endpoints do not match display edge ${displayEdgeId}`);
    if (edgeKinds[displayEdgeId] !== undefined && edgeKinds[displayEdgeId] !== kind) throw new Error(`${field}.kind does not match expected edge ${displayEdgeId}`);
    const relation = { sourceOrdinal, fromSourceId, toSourceId, displayEdgeId, kind, ...(label ? { label } : {}), ...(displayLabel ? { displayLabel } : {}) };
    relations.push(relation);
    byDisplay.set(displayEdgeId, [...(byDisplay.get(displayEdgeId) || []), relation]);
  }
  if (byDisplay.size !== edgeIds.length || edgeIds.some((id) => !byDisplay.has(id))) throw new Error(`expected diagram ${diagramId}.source_graph must cover every expected edge`);
  for (const [displayEdgeId, mapped] of byDisplay) {
    if (mapped.length === 1) {
      if (mapped[0].displayLabel !== undefined) throw new Error(`expected diagram ${diagramId}.source_graph relation ${mapped[0].sourceOrdinal} must not define display_label without a merge`);
      continue;
    }
    const first = mapped[0];
    if (!first.displayLabel || mapped.some((relation) => relation.fromSourceId !== first.fromSourceId || relation.toSourceId !== first.toSourceId || relation.kind !== first.kind || relation.displayLabel !== first.displayLabel)) throw new Error(`DISPLAY_MERGE_VALIDITY: expected diagram ${diagramId}.source_graph merge for ${displayEdgeId} must preserve one source/target/kind and one display_label`);
  }
  const readingPaths: ExpectedReadingPath[] = [];
  if (graph.reading_paths !== undefined) {
    if (!Array.isArray(graph.reading_paths)) throw new Error(`expected diagram ${diagramId}.source_graph.reading_paths must be an array`);
    const pathIds = new Set<string>();
    for (let index = 0; index < graph.reading_paths.length; index++) {
      const field = `expected diagram ${diagramId}.source_graph.reading_paths[${index}]`;
      const raw = asRecord(graph.reading_paths[index], field);
      const id = nonEmpty(raw.id, `${field}.id`);
      if (pathIds.has(id)) throw new Error(`${field}.id is duplicated`);
      pathIds.add(id);
      const nodePath = stringArray(raw.node_ids, `${field}.node_ids`);
      const edgePath = stringArray(raw.edge_ids, `${field}.edge_ids`);
      if (edgePath.length !== nodePath.length - 1) throw new Error(`${field}.edge_ids must connect each adjacent node pair`);
      for (let edgeIndex = 0; edgeIndex < edgePath.length; edgeIndex++) {
        const endpoints = edgeEndpoints[edgePath[edgeIndex]];
        if (!endpoints || endpoints.from !== nodePath[edgeIndex] || endpoints.to !== nodePath[edgeIndex + 1]) throw new Error(`${field} edge ${edgePath[edgeIndex]} does not connect the declared reading path`);
      }
      const requiredLabels = raw.required_labels === undefined ? [] : stringArray(raw.required_labels, `${field}.required_labels`, true);
      readingPaths.push({ id, nodeIds: nodePath, edgeIds: edgePath, requiredLabels });
    }
  }
  return { nodes: [...sourceNodes.values()], relations, readingPaths };
}

function parseGeometryProfile(value: unknown, field: string): ExpectedGeometryProfile {
  const profile = asRecord(value, field);
  const shapeBaseSizesValue = asRecord(profile.shape_base_sizes, `${field}.shape_base_sizes`);
  const shapeBaseSizes: Record<string, ExpectedShapeBaseSize> = {};
  for (const [shape, raw] of Object.entries(shapeBaseSizesValue)) {
    const item = asRecord(raw, `${field}.shape_base_sizes.${shape}`);
    shapeBaseSizes[shape] = {
      minWidth: finiteNumber(item.min_width, `${field}.shape_base_sizes.${shape}.min_width`, 1),
      minHeight: finiteNumber(item.min_height, `${field}.shape_base_sizes.${shape}.min_height`, 1),
      boundaryModel: nonEmpty(item.boundary_model, `${field}.shape_base_sizes.${shape}.boundary_model`),
    };
  }
  if (Object.keys(shapeBaseSizes).length === 0) throw new Error(`${field}.shape_base_sizes must not be empty`);
  const axisSpacingValue = profile.axis_spacing;
  let axisSpacing: ExpectedAxisSpacing | undefined;
  if (axisSpacingValue !== undefined) {
    const axis = asRecord(axisSpacingValue, `${field}.axis_spacing`);
    const referenceShape = nonEmpty(axis.reference_shape, `${field}.axis_spacing.reference_shape`);
    if (referenceShape !== "rect") throw new Error(`${field}.axis_spacing.reference_shape must be rect`);
    axisSpacing = {
      referenceShape: "rect",
      referenceWidth: finiteNumber(axis.reference_width, `${field}.axis_spacing.reference_width`, 1),
      referenceHeight: finiteNumber(axis.reference_height, `${field}.axis_spacing.reference_height`, 1),
      referenceLongSide: finiteNumber(axis.reference_long_side, `${field}.axis_spacing.reference_long_side`, 1),
      referenceShortSide: finiteNumber(axis.reference_short_side, `${field}.axis_spacing.reference_short_side`, 1),
      lrMinimumGap: finiteNumber(axis.lr_minimum_gap, `${field}.axis_spacing.lr_minimum_gap`, 1),
      tbMinimumGap: finiteNumber(axis.tb_minimum_gap, `${field}.axis_spacing.tb_minimum_gap`, 1),
    };
  }
  return {
    version: nonEmpty(profile.version, `${field}.version`),
    entityGap: finiteNumber(profile.entity_gap, `${field}.entity_gap`, 0),
    portGap: finiteNumber(profile.port_gap, `${field}.port_gap`, 0),
    obstacleGap: finiteNumber(profile.obstacle_gap, `${field}.obstacle_gap`, 0),
    laneGap: finiteNumber(profile.lane_gap, `${field}.lane_gap`, 0),
    shapeBaseSizes,
    ...(axisSpacing ? { axisSpacing } : {}),
  };
}

function parseBranchLayoutPlan(value: unknown, field: string, edgeIds: Set<string>, edgeEndpoints: Record<string, { from: string; to: string }>): ExpectedBranchLayoutPlan {
  const plan = asRecord(value, field);
  const rawGroups = plan.groups;
  if (!Array.isArray(rawGroups)) throw new Error(`${field}.groups must be an array`);
  const groupIds = new Set<string>();
  const groups: ExpectedBranchLayoutGroup[] = rawGroups.map((raw, index) => {
    const groupField = `${field}.groups[${index}]`;
    const group = asRecord(raw, groupField);
    const id = nonEmpty(group.id, `${groupField}.id`);
    if (groupIds.has(id)) throw new Error(`${groupField}.id is duplicated`);
    groupIds.add(id);
    const decisionNodeId = nonEmpty(group.decision_node_id, `${groupField}.decision_node_id`);
    const branchEdgeIds = stringArray(group.edge_ids, `${groupField}.edge_ids`);
    for (const edgeId of branchEdgeIds) {
      if (!edgeIds.has(edgeId)) throw new Error(`${groupField}.edge_ids references missing edge ${edgeId}`);
      if (edgeEndpoints[edgeId].from !== decisionNodeId) throw new Error(`${groupField}.edge_ids edge ${edgeId} does not leave ${decisionNodeId}`);
    }
    const targetIds = stringArray(group.target_ids, `${groupField}.target_ids`);
    const branchOrder = stringArray(group.branch_order, `${groupField}.branch_order`);
    if (branchOrder.length !== branchEdgeIds.length || branchOrder.some((edgeId) => !branchEdgeIds.includes(edgeId))) throw new Error(`${groupField}.branch_order must be a permutation of edge_ids`);
    const layoutCandidateEdgeId = nonEmpty(group.layout_candidate_edge_id, `${groupField}.layout_candidate_edge_id`);
    if (!branchEdgeIds.includes(layoutCandidateEdgeId)) throw new Error(`${groupField}.layout_candidate_edge_id must be listed in edge_ids`);
    const primaryEdgeId = group.primary_edge_id === undefined ? undefined : nonEmpty(group.primary_edge_id, `${groupField}.primary_edge_id`);
    if (primaryEdgeId !== undefined && !branchEdgeIds.includes(primaryEdgeId)) throw new Error(`${groupField}.primary_edge_id must be listed in edge_ids`);
    const mergeNodeId = group.merge_node_id === undefined ? undefined : nonEmpty(group.merge_node_id, `${groupField}.merge_node_id`);
    const depth = finiteNumber(group.depth, `${groupField}.depth`, 0);
    if (!Number.isInteger(depth)) throw new Error(`${groupField}.depth must be an integer`);
    const mode = nonEmpty(group.mode, `${groupField}.mode`) as "inline" | "local-lane";
    if (mode !== "inline" && mode !== "local-lane") throw new Error(`${groupField}.mode is invalid`);
    return {
      id,
      decisionNodeId,
      edgeIds: branchEdgeIds,
      targetIds,
      branchOrder,
      layoutCandidateEdgeId,
      ...(primaryEdgeId ? { primaryEdgeId } : {}),
      ...(mergeNodeId ? { mergeNodeId } : {}),
      depth,
      mode,
      branchGap: finiteNumber(group.branch_gap, `${groupField}.branch_gap`, 0),
    };
  });
  return {
    strategy: nonEmpty(plan.strategy, `${field}.strategy`),
    frozenOrder: stringArray(plan.frozen_order, `${field}.frozen_order`),
    baselineGap: finiteNumber(plan.baseline_gap, `${field}.baseline_gap`, 0),
    groups,
  };
}

function parseRouteContract(value: unknown, diagramId: string, edgeIds: string[], edgeEndpoints: Record<string, { from: string; to: string }>): ExpectedRouteContract {
  const route = asRecord(value, "route_contract");
  const edgeIdSet = new Set(edgeIds);
  const rawIntents = route.edge_intents;
  if (!Array.isArray(rawIntents) || rawIntents.length !== edgeIds.length) throw new Error("route_contract.edge_intents must cover every expected edge exactly once");
  const intentIds = new Set<string>();
  const edgeIntents: ExpectedRouteIntent[] = rawIntents.map((raw, index) => {
    const field = `route_contract.edge_intents[${index}]`;
    const intent = asRecord(raw, field);
    const edgeId = nonEmpty(intent.edge_id, `${field}.edge_id`);
    if (!edgeIdSet.has(edgeId) || intentIds.has(edgeId)) throw new Error(`${field}.edge_id must reference each expected edge exactly once`);
    intentIds.add(edgeId);
    const kind = nonEmpty(intent.kind, `${field}.kind`) as ExpectedRouteIntent["kind"];
    if (!["direct", "manhattan", "branch", "loop", "feedback", "relation", "custom"].includes(kind)) throw new Error(`${field}.kind is invalid`);
    const hasBendCount = intent.bend_count !== undefined;
    const hasMin = intent.min_bend_count !== undefined;
    const hasMax = intent.max_bend_count !== undefined;
    if (kind !== "custom" && !hasBendCount && !hasMin && !hasMax) throw new Error(`${field} must declare bend_count or a bend-count range`);
    const bendCount = hasBendCount ? finiteNumber(intent.bend_count, `${field}.bend_count`, 0) : undefined;
    const minBendCount = hasMin ? finiteNumber(intent.min_bend_count, `${field}.min_bend_count`, 0) : undefined;
    const maxBendCount = hasMax ? finiteNumber(intent.max_bend_count, `${field}.max_bend_count`, 0) : undefined;
    if (bendCount !== undefined && !Number.isInteger(bendCount)) throw new Error(`${field}.bend_count must be an integer`);
    if (minBendCount !== undefined && !Number.isInteger(minBendCount)) throw new Error(`${field}.min_bend_count must be an integer`);
    if (maxBendCount !== undefined && !Number.isInteger(maxBendCount)) throw new Error(`${field}.max_bend_count must be an integer`);
    if (minBendCount !== undefined && maxBendCount !== undefined && minBendCount > maxBendCount) throw new Error(`${field} bend-count range is inverted`);
    if (bendCount !== undefined && ((minBendCount !== undefined && bendCount < minBendCount) || (maxBendCount !== undefined && bendCount > maxBendCount))) throw new Error(`${field}.bend_count is outside its declared range`);
    const laneId = intent.lane_id === undefined ? undefined : nonEmpty(intent.lane_id, `${field}.lane_id`);
    if (kind === "loop" && !laneId) throw new Error(`${field}.lane_id is required for loop routes`);
    const arrowTarget = intent.arrow_target === undefined ? undefined : nonEmpty(intent.arrow_target, `${field}.arrow_target`);
    if (arrowTarget !== undefined && !/^[^:]+:(?:top|right|bottom|left)$/.test(arrowTarget)) throw new Error(`${field}.arrow_target must use <node>:<port>`);
    const labelText = intent.label_text === undefined ? undefined : nonEmpty(intent.label_text, `${field}.label_text`);
    const topology = intent.topology === undefined ? undefined : parseRouteTopology(intent.topology, `${field}.topology`);
    return {
      edgeId,
      kind,
      bendCount,
      minBendCount,
      maxBendCount,
      labelRequired: intent.label_required === true,
      ...(laneId ? { laneId } : {}),
      ...(arrowTarget ? { arrowTarget } : {}),
      ...(labelText ? { labelText } : {}),
      ...(topology ? { topology } : {}),
    };
  });
  const mainFlowValue = route.main_flow;
  let mainFlow: ExpectedMainFlow | undefined;
  if (mainFlowValue !== undefined) {
    const main = asRecord(mainFlowValue, "route_contract.main_flow");
    mainFlow = {
      entryNodeIds: stringArray(main.entry_node_ids, "route_contract.main_flow.entry_node_ids"),
      exitNodeIds: stringArray(main.exit_node_ids, "route_contract.main_flow.exit_node_ids"),
      nodeIds: stringArray(main.node_ids, "route_contract.main_flow.node_ids"),
      edgeIds: stringArray(main.edge_ids, "route_contract.main_flow.edge_ids"),
    };
    for (const edgeId of mainFlow.edgeIds) if (!edgeIdSet.has(edgeId)) throw new Error(`route_contract.main_flow references missing edge ${edgeId}`);
  }
  const primaryFlowValue = route.primary_flow;
  let primaryFlow: ExpectedPrimaryFlow | undefined;
  if (primaryFlowValue !== undefined) {
    const field = "route_contract.primary_flow";
    const primary = asRecord(primaryFlowValue, field);
    const nodeIds = stringArray(primary.node_ids, `${field}.node_ids`);
    const primaryEdgeIds = stringArray(primary.edge_ids, `${field}.edge_ids`);
    if (primaryEdgeIds.length !== nodeIds.length - 1) throw new Error(`${field}.edge_ids must contain exactly one edge between each adjacent primary node`);
    for (let index = 0; index < primaryEdgeIds.length; index++) {
      const edgeId = primaryEdgeIds[index];
      if (!edgeIdSet.has(edgeId)) throw new Error(`${field}.edge_ids references missing edge ${edgeId}`);
      const endpoints = edgeEndpoints[edgeId];
      if (endpoints.from !== nodeIds[index] || endpoints.to !== nodeIds[index + 1]) throw new Error(`${field} edge ${edgeId} does not connect adjacent primary nodes`);
    }
    primaryFlow = { nodeIds, edgeIds: primaryEdgeIds, reason: nonEmpty(primary.reason, `${field}.reason`) };
  }
  const rawLanes = route.loop_lanes === undefined ? [] : route.loop_lanes;
  if (!Array.isArray(rawLanes)) throw new Error("route_contract.loop_lanes must be an array");
  const laneIds = new Set<string>();
  const loopLanes: ExpectedLoopLane[] = rawLanes.map((raw, index) => {
    const field = `route_contract.loop_lanes[${index}]`;
    const lane = asRecord(raw, field);
    const id = nonEmpty(lane.id, `${field}.id`);
    if (laneIds.has(id)) throw new Error(`${field}.id is duplicated`);
    laneIds.add(id);
    const side = nonEmpty(lane.side, `${field}.side`) as "left" | "right";
    if (side !== "left" && side !== "right") throw new Error(`${field}.side must be left or right`);
    const laneOffset = finiteNumber(lane.lane_offset, `${field}.lane_offset`, 24);
    const laneEdgeIds = stringArray(lane.edge_ids, `${field}.edge_ids`);
    for (const edgeId of laneEdgeIds) if (!edgeIdSet.has(edgeId)) throw new Error(`${field}.edge_ids references missing edge ${edgeId}`);
    return { id, side, laneOffset, edgeIds: laneEdgeIds, reason: nonEmpty(lane.reason, `${field}.reason`) };
  });
  const rawMerges = route.merge_nodes === undefined ? [] : route.merge_nodes;
  if (!Array.isArray(rawMerges)) throw new Error("route_contract.merge_nodes must be an array");
  const mergeNodeIds = new Set<string>();
  const mergeNodes: ExpectedMergeNode[] = rawMerges.map((raw, index) => {
    const field = `route_contract.merge_nodes[${index}]`;
    const merge = asRecord(raw, field);
    const nodeId = nonEmpty(merge.node_id, `${field}.node_id`);
    if (mergeNodeIds.has(nodeId)) throw new Error(`${field}.node_id is duplicated`);
    mergeNodeIds.add(nodeId);
    const edgeIdsForMerge = stringArray(merge.edge_ids, `${field}.edge_ids`);
    for (const edgeId of edgeIdsForMerge) if (!edgeIdSet.has(edgeId)) throw new Error(`${field}.edge_ids references missing edge ${edgeId}`);
    const portsValue = asRecord(merge.ports, `${field}.ports`);
    const ports: Record<string, string> = {};
    for (const [edgeId, port] of Object.entries(portsValue)) {
      if (!edgeIdsForMerge.includes(edgeId)) throw new Error(`${field}.ports references an edge not listed in edge_ids: ${edgeId}`);
      ports[edgeId] = nonEmpty(port, `${field}.ports.${edgeId}`);
    }
    if (Object.keys(ports).length !== edgeIdsForMerge.length) throw new Error(`${field}.ports must declare every incoming edge port`);
    return { nodeId, edgeIds: edgeIdsForMerge, ports };
  });
  const affectedEdgeIds = route.affected_edge_ids === undefined ? edgeIds.slice() : stringArray(route.affected_edge_ids, "route_contract.affected_edge_ids");
  for (const edgeId of affectedEdgeIds) if (!edgeIdSet.has(edgeId)) throw new Error(`route_contract.affected_edge_ids references missing edge ${edgeId}`);
  const rawBranches = route.branch_groups === undefined ? [] : route.branch_groups;
  if (!Array.isArray(rawBranches)) throw new Error("route_contract.branch_groups must be an array");
  const branchGroupIds = new Set<string>();
  const branchGroups = rawBranches.map((raw, index) => {
    const field = `route_contract.branch_groups[${index}]`;
    const branch = asRecord(raw, field);
    const targetIds = stringArray(branch.target_ids, `${field}.target_ids`);
    const direction = nonEmpty(branch.direction, `${field}.direction`) as "TB" | "LR";
    if (direction !== "TB" && direction !== "LR") throw new Error(`${field}.direction must be TB or LR`);
    const tolerance = finiteNumber(branch.tolerance === undefined ? 1 : branch.tolerance, `${field}.tolerance`, 0);
    const id = branch.id === undefined ? undefined : nonEmpty(branch.id, `${field}.id`);
    if (id && branchGroupIds.has(id)) throw new Error(`${field}.id is duplicated`);
    if (id) branchGroupIds.add(id);
    const structured = ["decision_node_id", "edge_ids", "merge_node_id", "depth", "mode", "reason"].some((key) => branch[key] !== undefined);
    if (!structured) return { targetIds, direction, tolerance, ...(id ? { id } : {}) };
    const decisionNodeId = nonEmpty(branch.decision_node_id, `${field}.decision_node_id`);
    const branchEdgeIds = stringArray(branch.edge_ids, `${field}.edge_ids`);
    for (const edgeId of branchEdgeIds) {
      if (!edgeIdSet.has(edgeId)) throw new Error(`${field}.edge_ids references missing edge ${edgeId}`);
      if (edgeEndpoints[edgeId].from !== decisionNodeId) throw new Error(`${field}.edge ${edgeId} does not leave decision node ${decisionNodeId}`);
    }
    const mergeNodeId = branch.merge_node_id === undefined ? undefined : nonEmpty(branch.merge_node_id, `${field}.merge_node_id`);
    if (mergeNodeId && !branchEdgeIds.some((edgeId) => edgeEndpoints[edgeId].to === mergeNodeId)) throw new Error(`${field}.merge_node_id is not reached by a declared branch edge`);
    const depth = branch.depth === undefined ? undefined : finiteNumber(branch.depth, `${field}.depth`, 0);
    if (depth !== undefined && !Number.isInteger(depth)) throw new Error(`${field}.depth must be an integer`);
    const mode = branch.mode === undefined ? undefined : nonEmpty(branch.mode, `${field}.mode`) as "inline" | "local-lane";
    if (mode !== undefined && mode !== "inline" && mode !== "local-lane") throw new Error(`${field}.mode is invalid`);
    return {
      targetIds,
      direction,
      tolerance,
      ...(id ? { id } : {}),
      decisionNodeId,
      edgeIds: branchEdgeIds,
      ...(mergeNodeId ? { mergeNodeId } : {}),
      ...(depth === undefined ? {} : { depth }),
      ...(mode ? { mode } : {}),
      reason: nonEmpty(branch.reason, `${field}.reason`),
    };
  });
  const geometryProfile = route.geometry_profile === undefined ? undefined : parseGeometryProfile(route.geometry_profile, "route_contract.geometry_profile");
  const branchLayoutPlan = route.branch_layout_plan === undefined ? undefined : parseBranchLayoutPlan(route.branch_layout_plan, "route_contract.branch_layout_plan", edgeIdSet, edgeEndpoints);
  const rawExceptions = route.exceptions === undefined ? [] : route.exceptions;
  if (!Array.isArray(rawExceptions)) throw new Error("route_contract.exceptions must be an array");
  const exceptions = rawExceptions.map((raw, index) => parseExpectedException(raw, index, diagramId, edgeIdSet));
  const exceptionKeys = new Set(exceptions.map((exception) => `${exception.type}:${exception.edgeIds.slice().sort().join("\u0000")}`));
  if (exceptionKeys.size !== exceptions.length) throw new Error("route_contract.exceptions contains duplicate objects");
  const direction = route.direction === undefined ? undefined : nonEmpty(route.direction, "route_contract.direction") as "TB" | "LR";
  if (direction !== undefined && direction !== "TB" && direction !== "LR") throw new Error("route_contract.direction must be TB or LR");
  return {
    direction,
    affectedEdgeIds,
    edgeIntents,
    ...(mainFlow ? { mainFlow } : {}),
    ...(primaryFlow ? { primaryFlow } : {}),
    loopLanes,
    mergeNodes,
    branchGroups,
    ...(geometryProfile ? { geometryProfile } : {}),
    ...(branchLayoutPlan ? { branchLayoutPlan } : {}),
    exceptions,
  };
}

export function parseExpectedContract(raw: unknown, diagramId: string): ExpectedContract {
  const root = asRecord(raw, "expected contract");
  if (root.version !== "1" || root.type !== "diagram-expected-contract") throw new Error('expected contract version/type must be "1"/"diagram-expected-contract"');
  const source = parseSource(root.source);
  const generator = parseGenerator(root.generator, "expected contract generator");
  if (!Array.isArray(root.diagrams)) throw new Error("expected contract diagrams must be an array");
  const matches = root.diagrams.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry) && (entry as Record<string, unknown>).id === diagramId);
  if (matches.length !== 1) throw new Error(`expected contract must contain exactly one diagram with id ${diagramId}`);
  const diagram = asRecord(matches[0], `expected diagram ${diagramId}`);
  const intent = nonEmpty(diagram.intent, `expected diagram ${diagramId}.intent`);
  const nodeValues = diagram.nodes;
  if (!Array.isArray(nodeValues) || nodeValues.length === 0) throw new Error(`expected diagram ${diagramId}.nodes must be non-empty`);
  const nodeIds: string[] = [];
  const nodeShapes: Record<string, string | undefined> = {};
  for (let index = 0; index < nodeValues.length; index++) {
    const node = asRecord(nodeValues[index], `expected diagram ${diagramId}.nodes[${index}]`);
    assertNoActualGeometry(node, `expected diagram ${diagramId}.nodes[${index}]`);
    const id = nonEmpty(node.id, `expected diagram ${diagramId}.nodes[${index}].id`);
    if (nodeIds.includes(id)) throw new Error(`expected diagram ${diagramId}.nodes contains duplicate ${id}`);
    nodeIds.push(id);
    if (node.shape !== undefined) nodeShapes[id] = nonEmpty(node.shape, `expected diagram ${diagramId}.nodes[${index}].shape`);
  }
  if (!Array.isArray(diagram.edges)) throw new Error(`expected diagram ${diagramId}.edges must be an array`);
  const edgeIds: string[] = [];
  const edgeEndpoints: Record<string, { from: string; to: string }> = {};
  const edgePorts: Record<string, { fromPort?: string; toPort?: string }> = {};
  const edgeArrowTargets: Record<string, string | undefined> = {};
  const edgeKinds: Record<string, string | undefined> = {};
  for (let index = 0; index < diagram.edges.length; index++) {
    const edge = asRecord(diagram.edges[index], `expected diagram ${diagramId}.edges[${index}]`);
    assertNoActualGeometry(edge, `expected diagram ${diagramId}.edges[${index}]`);
    const id = nonEmpty(edge.id, `expected diagram ${diagramId}.edges[${index}].id`);
    if (edgeIds.includes(id)) throw new Error(`expected diagram ${diagramId}.edges contains duplicate ${id}`);
    const from = nonEmpty(edge.from, `expected diagram ${diagramId}.edges[${index}].from`);
    const to = nonEmpty(edge.to, `expected diagram ${diagramId}.edges[${index}].to`);
    if (!nodeIds.includes(from) || !nodeIds.includes(to)) throw new Error(`expected diagram ${diagramId}.edges[${index}] references missing node`);
    edgeIds.push(id);
    edgeEndpoints[id] = { from, to };
    edgePorts[id] = {
      ...(edge.from_port === undefined ? {} : { fromPort: nonEmpty(edge.from_port, `expected diagram ${diagramId}.edges[${index}].from_port`) }),
      ...(edge.to_port === undefined ? {} : { toPort: nonEmpty(edge.to_port, `expected diagram ${diagramId}.edges[${index}].to_port`) }),
    };
    const edgeArrowTarget = edge.arrow_target === undefined ? undefined : nonEmpty(edge.arrow_target, `expected diagram ${diagramId}.edges[${index}].arrow_target`);
    if (edgeArrowTarget !== undefined && !/^[^:]+:(?:top|right|bottom|left)$/.test(edgeArrowTarget)) throw new Error(`expected diagram ${diagramId}.edges[${index}].arrow_target must use <node>:<port>`);
    edgeArrowTargets[id] = edgeArrowTarget;
    edgeKinds[id] = edge.kind === undefined ? undefined : nonEmpty(edge.kind, `expected diagram ${diagramId}.edges[${index}].kind`);
  }
  const groupValues = diagram.groups;
  if (!Array.isArray(groupValues)) throw new Error(`expected diagram ${diagramId}.groups must be an array`);
  const groupIds: string[] = [];
  const groupTypes: Record<string, { semanticType: string; parent?: string }> = {};
  for (let index = 0; index < groupValues.length; index++) {
    const group = asRecord(groupValues[index], `expected diagram ${diagramId}.groups[${index}]`);
    assertNoActualGeometry(group, `expected diagram ${diagramId}.groups[${index}]`);
    const id = nonEmpty(group.id, `expected diagram ${diagramId}.groups[${index}].id`);
    if (groupIds.includes(id)) throw new Error(`expected diagram ${diagramId}.groups contains duplicate ${id}`);
    groupIds.push(id);
    groupTypes[id] = { semanticType: nonEmpty(group.semantic_type, `expected diagram ${diagramId}.groups[${index}].semantic_type`), ...(group.parent === undefined ? {} : { parent: nonEmpty(group.parent, `expected diagram ${diagramId}.groups[${index}].parent`) }) };
  }
  const legendIds = stringArray(diagram.legend_ids, `expected diagram ${diagramId}.legend_ids`, true);
  const annotationIds = stringArray(diagram.annotation_ids, `expected diagram ${diagramId}.annotation_ids`, true);
  if (legendIds.length > 0) throw new Error(`expected diagram ${diagramId}.legend_ids must be empty because global legends are not allowed`);
  if (annotationIds.length > 0) throw new Error(`expected diagram ${diagramId}.annotation_ids must be empty because global annotations are not allowed`);
  const routeContract = parseRouteContract(diagram.route_contract, diagramId, edgeIds, edgeEndpoints);
  const sourceGraph = diagram.source_graph === undefined ? undefined : parseSourceGraph(diagram.source_graph, diagramId, nodeIds, nodeShapes, edgeIds, edgeEndpoints, edgeKinds);
  for (const intent of routeContract.edgeIntents) {
    const endpoints = edgeEndpoints[intent.edgeId];
    const ports = edgePorts[intent.edgeId];
    const derivedArrowTarget = ports?.toPort ? `${endpoints.to}:${ports.toPort}` : undefined;
    const declaredArrowTarget = edgeArrowTargets[intent.edgeId] || intent.arrowTarget;
    if (declaredArrowTarget !== undefined && derivedArrowTarget !== undefined && declaredArrowTarget !== derivedArrowTarget) throw new Error(`expected diagram ${diagramId} route ${intent.edgeId}.arrow_target must equal ${derivedArrowTarget}`);
    if (intent.arrowTarget !== undefined && edgeArrowTargets[intent.edgeId] !== undefined && intent.arrowTarget !== edgeArrowTargets[intent.edgeId]) throw new Error(`expected diagram ${diagramId} route ${intent.edgeId} has conflicting arrow_target declarations`);
  }
  for (const merge of routeContract.mergeNodes) {
    if (!nodeIds.includes(merge.nodeId)) throw new Error(`expected diagram ${diagramId} merge node references missing node ${merge.nodeId}`);
    for (const edgeId of merge.edgeIds) if (edgeEndpoints[edgeId].to !== merge.nodeId) throw new Error(`expected diagram ${diagramId} merge node ${merge.nodeId} references non-incoming edge ${edgeId}`);
    for (const edgeId of merge.edgeIds) if (!edgePorts[edgeId].toPort || merge.ports[edgeId] !== edgePorts[edgeId].toPort) throw new Error(`expected diagram ${diagramId} merge node ${merge.nodeId} port for ${edgeId} does not match its expected edge port`);
  }
  const decisionNodeIds = nodeIds.filter((id) => nodeShapes[id] === "diamond");
  const directedEdgeCount = edgeIds.filter((id) => edgeKinds[id] !== "undirected").length;
  const lifelineIds = diagram.lifeline_ids === undefined ? [] : stringArray(diagram.lifeline_ids, `expected diagram ${diagramId}.lifeline_ids`, true);
  for (const id of lifelineIds) if (!nodeIds.includes(id)) throw new Error(`expected diagram ${diagramId}.lifeline_ids references missing node ${id}`);
  return {
    diagramId,
    diagramType: diagram.diagram_type === undefined ? undefined : nonEmpty(diagram.diagram_type, `expected diagram ${diagramId}.diagram_type`),
    intent,
    source,
    generator,
    nodeIds,
    nodeShapes,
    edgeIds,
    edgeEndpoints,
    edgePorts,
    edgeArrowTargets,
    edgeKinds,
    groupIds,
    groupTypes,
    legendIds,
    annotationIds,
    decisionNodeIds,
    lifelineIds,
    directedEdgeCount,
    routeContract,
    ...(sourceGraph ? { sourceGraph } : {}),
  };
}

export function expectedContractPath(value: Record<string, unknown>, diagram: Record<string, unknown>): string | undefined {
  const rootValue = value.expected_contract_path ?? value.expectedContractPath;
  const diagramValue = diagram.expected_contract_path ?? diagram.expectedContractPath;
  const selected = diagramValue ?? rootValue;
  return selected === undefined ? undefined : nonEmpty(selected, "expected_contract_path");
}

function directionToken(first: [number, number], second: [number, number]): string | null {
  const dx = second[0] - first[0];
  const dy = second[1] - first[1];
  if (Math.abs(dx) <= 1e-9 && Math.abs(dy) <= 1e-9) return null;
  return `${Math.sign(dx)},${Math.sign(dy)}`;
}

export function routeDirectionTokens(points: unknown): RouteDirection[] {
  if (!Array.isArray(points) || points.length < 2) return [];
  const directions: RouteDirection[] = [];
  for (let index = 1; index < points.length; index++) {
    const first = points[index - 1];
    const second = points[index];
    if (!Array.isArray(first) || !Array.isArray(second) || first.length !== 2 || second.length !== 2 || !first.every((value) => typeof value === "number" && Number.isFinite(value)) || !second.every((value) => typeof value === "number" && Number.isFinite(value))) return [];
    const token = directionToken(first as [number, number], second as [number, number]);
    if (!token) continue;
    const direction = ({ "-1,0": "left", "1,0": "right", "0,-1": "up", "0,1": "down" } as Record<string, RouteDirection | undefined>)[token];
    if (!direction) return [];
    if (directions[directions.length - 1] !== direction) directions.push(direction);
  }
  return directions;
}

export function routeBendCount(points: unknown): number {
  if (!Array.isArray(points) || points.length < 2) return -1;
  const directions: string[] = [];
  for (let index = 1; index < points.length; index++) {
    const first = points[index - 1];
    const second = points[index];
    if (!Array.isArray(first) || !Array.isArray(second) || first.length !== 2 || second.length !== 2 || !first.every((value) => typeof value === "number" && Number.isFinite(value)) || !second.every((value) => typeof value === "number" && Number.isFinite(value))) return -1;
    const direction = directionToken(first as [number, number], second as [number, number]);
    if (direction && directions[directions.length - 1] !== direction) directions.push(direction);
  }
  return directions.length === 0 ? 0 : directions.length - 1;
}

export function isOrthogonalRoute(points: unknown): boolean {
  if (!Array.isArray(points) || points.length < 2) return false;
  for (let index = 1; index < points.length; index++) {
    const first = points[index - 1];
    const second = points[index];
    if (!Array.isArray(first) || !Array.isArray(second) || first.length !== 2 || second.length !== 2) return false;
    if (first[0] !== second[0] && first[1] !== second[1]) return false;
  }
  return true;
}

export function routeGeometryKind(points: unknown): "direct" | "manhattan" | "custom" {
  const bends = routeBendCount(points);
  if (bends === 0) return "direct";
  if (isOrthogonalRoute(points)) return "manhattan";
  return "custom";
}

export function routeIntentErrors(intent: ExpectedRouteIntent, points: unknown, hasLabel: boolean, actualArrowTarget?: string, actualLabelText?: string): string[] {
  const errors: string[] = [];
  const bends = routeBendCount(points);
  const directions = routeDirectionTokens(points);
  if (bends < 0) return [`ROUTE_TOPOLOGY: route ${intent.edgeId} has no measurable path`];
  const orthogonal = isOrthogonalRoute(points);
  if (directions.length === 0 && !orthogonal) return [`NON_MANHATTAN: route ${intent.edgeId} must be orthogonal Manhattan geometry`];
  if (intent.bendCount !== undefined && bends !== intent.bendCount) errors.push(`ROUTE_BEND_DIFF: route ${intent.edgeId} bend count is ${bends}, expected ${intent.bendCount}`);
  if (intent.minBendCount !== undefined && bends < intent.minBendCount) errors.push(`ROUTE_BEND_DIFF: route ${intent.edgeId} bend count ${bends} is below ${intent.minBendCount}`);
  if (intent.maxBendCount !== undefined && bends > intent.maxBendCount) errors.push(`ROUTE_BEND_DIFF: route ${intent.edgeId} bend count ${bends} exceeds ${intent.maxBendCount}`);
  if (intent.kind === "direct" && bends !== 0) errors.push(`ROUTE_TOPOLOGY: route ${intent.edgeId} must be direct with zero direction changes`);
  if (intent.kind === "manhattan" && !isOrthogonalRoute(points)) errors.push(`NON_MANHATTAN: route ${intent.edgeId} must be orthogonal Manhattan geometry`);
  if (intent.labelRequired && !hasLabel) errors.push(`LABEL_COLLISION: route ${intent.edgeId} requires a visible label`);
  if (intent.arrowTarget !== undefined && actualArrowTarget !== undefined && actualArrowTarget !== intent.arrowTarget) errors.push(`ROUTE_ARROW_TARGET_DIFF: route ${intent.edgeId} arrowTarget is ${actualArrowTarget}, expected ${intent.arrowTarget}`);
  if (intent.labelText !== undefined && actualLabelText !== undefined && actualLabelText !== intent.labelText) errors.push(`ROUTE_LABEL_DIFF: route ${intent.edgeId} label is ${JSON.stringify(actualLabelText)}, expected ${JSON.stringify(intent.labelText)}`);
  if (intent.labelText !== undefined && actualLabelText === undefined) errors.push(`ROUTE_LABEL_DIFF: route ${intent.edgeId} expected label ${JSON.stringify(intent.labelText)} but actual label is missing`);
  if (intent.topology) {
    if (intent.topology.orthogonal && !isOrthogonalRoute(points)) errors.push(`ROUTE_TOPOLOGY: route ${intent.edgeId} points are not Manhattan orthogonal`);
    if (intent.topology.segmentCount !== undefined && directions.length !== intent.topology.segmentCount) errors.push(`ROUTE_TOPOLOGY: route ${intent.edgeId} has ${directions.length} effective segments, expected ${intent.topology.segmentCount}`);
    if (intent.topology.directions && (directions.length !== intent.topology.directions.length || directions.some((direction, index) => direction !== intent.topology!.directions![index]))) errors.push(`ROUTE_TOPOLOGY: route ${intent.edgeId} direction sequence is ${directions.join(",")}, expected ${intent.topology.directions.join(",")}`);
  }
  return errors;
}

export function exceptionKey(exception: ExpectedException): string {
  return `${exception.type}:${exception.edgeIds.slice().sort().join("\u0000")}`;
}

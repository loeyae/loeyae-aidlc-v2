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

export interface ExpectedRouteIntent {
  edgeId: string;
  kind: "direct" | "manhattan" | "branch" | "loop" | "feedback" | "relation" | "custom";
  bendCount?: number;
  minBendCount?: number;
  maxBendCount?: number;
  labelRequired: boolean;
  laneId?: string;
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
  edgeIds: string[];
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

export interface ExpectedBranchGroup {
  targetIds: string[];
  direction: "TB" | "LR";
  tolerance: number;
}

export interface ExpectedRouteContract {
  direction?: "TB" | "LR";
  edgeIntents: ExpectedRouteIntent[];
  mainFlow?: ExpectedMainFlow;
  loopLanes: ExpectedLoopLane[];
  branchGroups: ExpectedBranchGroup[];
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
  edgeKinds: Record<string, string | undefined>;
  groupIds: string[];
  groupTypes: Record<string, { semanticType: string; parent?: string }>;
  legendIds: string[];
  annotationIds: string[];
  decisionNodeIds: string[];
  lifelineIds: string[];
  directedEdgeCount: number;
  routeContract: ExpectedRouteContract;
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
  const refs = visualEvidence.refs === undefined ? [] : stringArray(visualEvidence.refs, `${field}.visual_evidence.refs`, true);
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

function parseRouteContract(value: unknown, diagramId: string, edgeIds: string[]): ExpectedRouteContract {
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
    return {
      edgeId,
      kind,
      bendCount,
      minBendCount,
      maxBendCount,
      labelRequired: intent.label_required === true,
      ...(laneId ? { laneId } : {}),
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
    const laneEdgeIds = stringArray(lane.edge_ids, `${field}.edge_ids`);
    for (const edgeId of laneEdgeIds) if (!edgeIdSet.has(edgeId)) throw new Error(`${field}.edge_ids references missing edge ${edgeId}`);
    return { id, side, edgeIds: laneEdgeIds };
  });
  const rawBranches = route.branch_groups === undefined ? [] : route.branch_groups;
  if (!Array.isArray(rawBranches)) throw new Error("route_contract.branch_groups must be an array");
  const branchGroups = rawBranches.map((raw, index) => {
    const field = `route_contract.branch_groups[${index}]`;
    const branch = asRecord(raw, field);
    const direction = nonEmpty(branch.direction, `${field}.direction`) as "TB" | "LR";
    if (direction !== "TB" && direction !== "LR") throw new Error(`${field}.direction must be TB or LR`);
    return { targetIds: stringArray(branch.target_ids, `${field}.target_ids`), direction, tolerance: finiteNumber(branch.tolerance === undefined ? 1 : branch.tolerance, `${field}.tolerance`, 0) };
  });
  const rawExceptions = route.exceptions === undefined ? [] : route.exceptions;
  if (!Array.isArray(rawExceptions)) throw new Error("route_contract.exceptions must be an array");
  const exceptions = rawExceptions.map((raw, index) => parseExpectedException(raw, index, diagramId, edgeIdSet));
  const exceptionKeys = new Set(exceptions.map((exception) => `${exception.type}:${exception.edgeIds.slice().sort().join("\u0000")}`));
  if (exceptionKeys.size !== exceptions.length) throw new Error("route_contract.exceptions contains duplicate objects");
  const direction = route.direction === undefined ? undefined : nonEmpty(route.direction, "route_contract.direction") as "TB" | "LR";
  if (direction !== undefined && direction !== "TB" && direction !== "LR") throw new Error("route_contract.direction must be TB or LR");
  return { direction, edgeIntents, ...(mainFlow ? { mainFlow } : {}), loopLanes, branchGroups, exceptions };
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
  const routeContract = parseRouteContract(diagram.route_contract, diagramId, edgeIds);
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
    edgeKinds,
    groupIds,
    groupTypes,
    legendIds,
    annotationIds,
    decisionNodeIds,
    lifelineIds,
    directedEdgeCount,
    routeContract,
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

export function routeIntentErrors(intent: ExpectedRouteIntent, points: unknown, hasLabel: boolean): string[] {
  const errors: string[] = [];
  const bends = routeBendCount(points);
  if (bends < 0) return [`route ${intent.edgeId} has no measurable path`];
  if (intent.bendCount !== undefined && bends !== intent.bendCount) errors.push(`route ${intent.edgeId} bend count is ${bends}, expected ${intent.bendCount}`);
  if (intent.minBendCount !== undefined && bends < intent.minBendCount) errors.push(`route ${intent.edgeId} bend count ${bends} is below ${intent.minBendCount}`);
  if (intent.maxBendCount !== undefined && bends > intent.maxBendCount) errors.push(`route ${intent.edgeId} bend count ${bends} exceeds ${intent.maxBendCount}`);
  if (intent.kind === "direct" && bends !== 0) errors.push(`route ${intent.edgeId} must be direct with zero direction changes`);
  if (intent.kind === "manhattan" && !isOrthogonalRoute(points)) errors.push(`route ${intent.edgeId} must be orthogonal Manhattan geometry`);
  if (intent.labelRequired && !hasLabel) errors.push(`route ${intent.edgeId} requires a visible label`);
  return errors;
}

export function exceptionKey(exception: ExpectedException): string {
  return `${exception.type}:${exception.edgeIds.slice().sort().join("\u0000")}`;
}

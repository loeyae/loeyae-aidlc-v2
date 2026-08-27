export type Point = [number, number];

export type SegmentRelation = "none" | "touch" | "cross" | "overlap";

const EPSILON = 1e-9;

export function pointEqual(first: Point, second: Point, tolerance = 1): boolean {
  return Math.abs(first[0] - second[0]) <= tolerance && Math.abs(first[1] - second[1]) <= tolerance;
}

export function orientation(first: Point, second: Point, third: Point): number {
  return (second[0] - first[0]) * (third[1] - first[1]) - (second[1] - first[1]) * (third[0] - first[0]);
}

export function onSegment(first: Point, second: Point, point: Point): boolean {
  return Math.abs(orientation(first, second, point)) <= EPSILON
    && point[0] >= Math.min(first[0], second[0]) - EPSILON
    && point[0] <= Math.max(first[0], second[0]) + EPSILON
    && point[1] >= Math.min(first[1], second[1]) - EPSILON
    && point[1] <= Math.max(first[1], second[1]) + EPSILON;
}

function projectionOverlap(first: Point, second: Point, third: Point, fourth: Point): number {
  const useX = Math.abs(first[0] - second[0]) >= Math.abs(first[1] - second[1]);
  const firstLow = useX ? Math.min(first[0], second[0]) : Math.min(first[1], second[1]);
  const firstHigh = useX ? Math.max(first[0], second[0]) : Math.max(first[1], second[1]);
  const secondLow = useX ? Math.min(third[0], fourth[0]) : Math.min(third[1], fourth[1]);
  const secondHigh = useX ? Math.max(third[0], fourth[0]) : Math.max(third[1], fourth[1]);
  return Math.min(firstHigh, secondHigh) - Math.max(firstLow, secondLow);
}

export function segmentRelation(first: Point, second: Point, third: Point, fourth: Point): SegmentRelation {
  const firstOrientation = orientation(first, second, third);
  const secondOrientation = orientation(first, second, fourth);
  const thirdOrientation = orientation(third, fourth, first);
  const fourthOrientation = orientation(third, fourth, second);
  const collinear = Math.abs(firstOrientation) <= EPSILON
    && Math.abs(secondOrientation) <= EPSILON
    && Math.abs(thirdOrientation) <= EPSILON
    && Math.abs(fourthOrientation) <= EPSILON;
  if (collinear) {
    const overlap = projectionOverlap(first, second, third, fourth);
    if (overlap > EPSILON) return "overlap";
    if (overlap >= -EPSILON && (onSegment(first, second, third) || onSegment(first, second, fourth) || onSegment(third, fourth, first) || onSegment(third, fourth, second))) return "touch";
    return "none";
  }
  const properCross = ((firstOrientation > EPSILON && secondOrientation < -EPSILON) || (firstOrientation < -EPSILON && secondOrientation > EPSILON))
    && ((thirdOrientation > EPSILON && fourthOrientation < -EPSILON) || (thirdOrientation < -EPSILON && fourthOrientation > EPSILON));
  if (properCross) return "cross";
  if (onSegment(first, second, third) || onSegment(first, second, fourth) || onSegment(third, fourth, first) || onSegment(third, fourth, second)) return "touch";
  return "none";
}

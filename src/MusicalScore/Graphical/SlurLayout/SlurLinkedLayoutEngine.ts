import { PointF2D } from "../../../Common/DataObjects/PointF2D";
import { PlacementEnum } from "../../VoiceData/Expressions/AbstractExpression";
import {
  calculateCandidateSlurLayout,
  SlurCandidateLayoutOptions,
} from "./SlurCandidateLayoutEngine";
import {
  SlurCurveGeometry,
  SlurCurveCandidate,
  SlurContinuationBoundaryTarget,
  SlurLayoutContext,
  SlurLayoutFault,
  SlurLayoutResult,
  SlurLinkedLayoutDiagnostics,
  preferredSlurEndpointSurface,
} from "./SlurLayoutTypes";

export interface SlurLinkedLayoutInput {
  context: SlurLayoutContext;
  seed: SlurCurveGeometry;
  /** Staff-line y offset inside its music system, used to compare cross-staff endpoints. */
  staffOffsetY?: number;
  /** Semantic endpoints of the complete linked phrase, including on boundary-only fragments. */
  sourcePitchHalfTone?: number;
  destinationPitchHalfTone?: number;
}

export interface SlurLinkedLayoutOutput {
  results: readonly SlurLayoutResult[];
  diagnostics: SlurLinkedLayoutDiagnostics;
}

const rejectedCandidateScore: number = 1_000_000;

const clonePoint: (point: PointF2D) => PointF2D = (point: PointF2D): PointF2D =>
  new PointF2D(point.x, point.y);

const cloneGeometry: (geometry: SlurCurveGeometry) => SlurCurveGeometry = (
  geometry: SlurCurveGeometry,
): SlurCurveGeometry => ({
  p0: clonePoint(geometry.p0),
  p1: clonePoint(geometry.p1),
  p2: clonePoint(geometry.p2),
  p3: clonePoint(geometry.p3),
});

function boundaryClearance(context: SlurLayoutContext, side: "start" | "end"): number {
  const values: readonly number[] = context.direction === PlacementEnum.Above
    ? context.envelope.skyline
    : context.envelope.bottomline;
  if (values.length === 0) {
    return 1.2;
  }
  const windowLength: number = Math.max(1, Math.ceil(values.length * 0.22));
  const window: readonly number[] = side === "start"
    ? values.slice(0, windowLength)
    : values.slice(values.length - windowLength);
  const finite: number[] = window.filter(Number.isFinite);
  if (finite.length === 0) {
    return 1.2;
  }
  const envelopeEdge: number = context.direction === PlacementEnum.Above
    ? Math.min(...finite)
    : Math.max(...finite);
  const staffEdge: number = context.direction === PlacementEnum.Above
    ? context.envelope.topLineOffset
    : context.envelope.bottomLineOffset;
  const distance: number = context.direction === PlacementEnum.Above
    ? staffEdge - envelopeEdge
    : envelopeEdge - staffEdge;
  return Math.max(1.2, Math.min(6, distance + 0.45));
}

function unboundedContinuationTarget(context: SlurLayoutContext, clearance: number): number {
  return context.direction === PlacementEnum.Above
    ? context.envelope.topLineOffset - clearance
    : context.envelope.bottomLineOffset + clearance;
}

interface SlurLinkedTrajectory {
  sourceSemanticHeight: number;
  destinationSemanticHeight: number;
  continuationSlope: number;
  cumulativeRuns: readonly number[];
  totalRun: number;
}

interface NormalizedLinkedInput {
  context: SlurLayoutContext;
  seed: SlurCurveGeometry;
  targets: readonly SlurContinuationBoundaryTarget[];
}

function semanticEndpointLocalY(
  input: SlurLinkedLayoutInput,
  side: "start" | "end",
): number {
  const endpoint: SlurLayoutContext["start"] = side === "start"
    ? input.context.start
    : input.context.end;
  if (endpoint.systemBoundary) {
    return endpoint.seedAnchor.y;
  }
  const direction: number = input.context.direction === PlacementEnum.Above ? -1 : 1;
  const endpointGap: number = 0.35;
  const preferredSurface: ReturnType<typeof preferredSlurEndpointSurface> =
    preferredSlurEndpointSurface(endpoint);
  if (preferredSurface === "beam" && (endpoint.beamSideAnchor || endpoint.beams.length > 0)) {
    const beamEdge: number = endpoint.beamSideAnchor?.y ?? (direction < 0
      ? Math.min(...endpoint.beams.map((beam): number => beam.top))
      : Math.max(...endpoint.beams.map((beam): number => beam.bottom)));
    return beamEdge + direction * endpointGap;
  }
  if (preferredSurface === "stem" && endpoint.stem) {
    return (direction < 0 ? endpoint.stem.top : endpoint.stem.bottom) + direction * endpointGap;
  }
  if (endpoint.notehead) {
    return (direction < 0 ? endpoint.notehead.top : endpoint.notehead.bottom) + direction * endpointGap;
  }
  return endpoint.seedAnchor.y;
}

function linkedTrajectory(inputs: readonly SlurLinkedLayoutInput[]): SlurLinkedTrajectory {
  const first: SlurLinkedLayoutInput = inputs[0];
  const last: SlurLinkedLayoutInput = inputs[inputs.length - 1];
  const sourceSemanticHeight: number = first
    ? semanticEndpointLocalY(first, "start") + (first.staffOffsetY ?? 0)
    : 0;
  let destinationSemanticHeight: number = last
    ? semanticEndpointLocalY(last, "end") + (last.staffOffsetY ?? 0)
    : sourceSemanticHeight;
  const sourcePitch: number | undefined = first?.sourcePitchHalfTone
    ?? first?.context.start.pitchHalfTone;
  const destinationPitch: number | undefined = last?.destinationPitchHalfTone
    ?? last?.context.end.pitchHalfTone;
  if (
    Number.isFinite(sourcePitch) &&
    Number.isFinite(destinationPitch) &&
    Math.abs(destinationPitch - sourcePitch) > 0.001
  ) {
    const pitchDirection: number = -Math.sign(destinationPitch - sourcePitch);
    const renderedDirection: number = Math.sign(destinationSemanticHeight - sourceSemanticHeight);
    if (renderedDirection !== pitchDirection) {
      // Cross-system endpoint boxes can be expressed in different local staff
      // frames. Pitch supplies the stable musical direction when those frames
      // disagree, irrespective of how the caller classified the staff change.
      const minimumPitchTravel: number = Math.min(
        5,
        Math.max(1.2, Math.abs(destinationPitch - sourcePitch) * 0.25),
      );
      destinationSemanticHeight = sourceSemanticHeight + pitchDirection * Math.max(
        minimumPitchTravel,
        Math.abs(destinationSemanticHeight - sourceSemanticHeight),
      );
    }
  }
  const cumulativeRuns: number[] = [0];
  for (const input of inputs) {
    const run: number = Math.max(0.001, Math.abs(input.seed.p3.x - input.seed.p0.x));
    cumulativeRuns.push(cumulativeRuns[cumulativeRuns.length - 1] + run);
  }
  const totalRun: number = Math.max(0.001, cumulativeRuns[cumulativeRuns.length - 1]);
  const continuationSlope: number = Math.max(
    -0.55,
    Math.min(0.55, (destinationSemanticHeight - sourceSemanticHeight) / totalRun),
  );
  return {
    sourceSemanticHeight,
    destinationSemanticHeight,
    continuationSlope,
    cumulativeRuns,
    totalRun,
  };
}

function continuationBoundaryTarget(
  input: SlurLinkedLayoutInput,
  trajectory: SlurLinkedTrajectory,
  side: "start" | "end",
  clearance: number,
): SlurContinuationBoundaryTarget {
  const context: SlurLayoutContext = input.context;
  const progressRun: number = side === "start"
    ? trajectory.cumulativeRuns[context.segmentIndex] ?? 0
    : trajectory.cumulativeRuns[context.segmentIndex + 1] ?? trajectory.totalRun;
  const projectedGlobal: number = trajectory.sourceSemanticHeight +
    (trajectory.destinationSemanticHeight - trajectory.sourceSemanticHeight) *
      (progressRun / trajectory.totalRun);
  let projectedTarget: number = projectedGlobal - (input.staffOffsetY ?? 0);
  let tangent: number = trajectory.continuationSlope;
  const direction: number = context.direction === PlacementEnum.Above ? -1 : 1;
  const outwardClearance: number = context.isCrossStaff
    ? 0
    : Math.max(0.45, Math.min(1.15, clearance * 0.55));
  let target: number = projectedTarget + direction * outwardClearance;
  const safeTarget: number = unboundedContinuationTarget(context, clearance);
  const opposite: SlurLayoutContext["start"] = side === "start" ? context.end : context.start;
  if (!opposite.systemBoundary) {
    const boundary: SlurLayoutContext["start"] = side === "start" ? context.start : context.end;
    const run: number = Math.abs(opposite.seedAnchor.x - boundary.seedAnchor.x);
    const oppositeAnchorY: number = side === "start"
      ? semanticEndpointLocalY(input, "end")
      : opposite.seedAnchor.y;
    projectedTarget = side === "start"
      ? oppositeAnchorY - trajectory.continuationSlope * run
      : oppositeAnchorY + trajectory.continuationSlope * run;
    target = projectedTarget + direction * outwardClearance;
    const skylineWeight: number = context.isCrossStaff
      ? 0.08
      : Math.min(0.28, 0.08 + (run / Math.max(1, context.envelope.width)) * 0.2);
    target = target * (1 - skylineWeight) + safeTarget * skylineWeight;
    // Keep short returns close to their destination while allowing a genuine
    // cross-staff phrase to retain enough vertical direction at both breaks.
    const travelFactor: number = context.isCrossStaff ? 0.3 : 0.24;
    const maximumTravel: number = Math.max(
      0.35,
      Math.min(context.isCrossStaff ? 2.6 : 2.2, run * travelFactor + 0.15),
    );
    target = Math.max(
      oppositeAnchorY - maximumTravel,
      Math.min(oppositeAnchorY + maximumTravel, target),
    );
    // Blending towards the local skyline must not reverse this fragment of a
    // directed cross-system phrase. Retain a short part of the projected
    // travel so the continuation still approaches its real endpoint from the
    // same direction as the complete source-to-destination trajectory.
    const directionalTravel: number = trajectory.continuationSlope * Math.min(run, 2);
    const directionalTarget: number = side === "start"
      ? oppositeAnchorY - directionalTravel
      : oppositeAnchorY + directionalTravel;
    if (trajectory.continuationSlope < 0) {
      target = side === "start"
        ? Math.max(target, directionalTarget)
        : Math.min(target, directionalTarget);
    } else if (trajectory.continuationSlope > 0) {
      target = side === "start"
        ? Math.min(target, directionalTarget)
        : Math.max(target, directionalTarget);
    }
    const chordSlope: number = side === "start"
      ? (oppositeAnchorY - target) / Math.max(0.001, run)
      : (target - oppositeAnchorY) / Math.max(0.001, run);
    // A continuation tangent must still be geometrically possible for a
    // single-sided arch. For example, an above-slur whose boundary target is
    // level with its real endpoint cannot leave that boundary heading upward
    // without first turning back through an inflection. Preserve the complete
    // phrase direction where the projected target supports it, and otherwise
    // relax only to the local endpoint chord.
    if (context.direction === PlacementEnum.Above) {
      tangent = side === "start"
        ? Math.min(tangent, chordSlope)
        : Math.max(tangent, chordSlope);
    } else {
      tangent = side === "start"
        ? Math.max(tangent, chordSlope)
        : Math.min(tangent, chordSlope);
    }
  }
  const effectiveClearance: number = context.direction === PlacementEnum.Above
    ? context.envelope.topLineOffset - target
    : target - context.envelope.bottomLineOffset;
  return {
    segmentIndex: context.segmentIndex,
    side,
    requestedClearance: clearance,
    effectiveClearance,
    projectedTarget,
    tangent,
    target,
  };
}

/**
 * Project system-break endpoints and tangents from the complete phrase while
 * retaining the local seed away from the break. Candidate rejection remains
 * responsible for excluding inflected or colliding alternatives.
 */
function normalizeContinuationInput(
  input: SlurLinkedLayoutInput,
  trajectory: SlurLinkedTrajectory,
  clearance: number,
): NormalizedLinkedInput {
  const geometry: SlurCurveGeometry = cloneGeometry(input.seed);
  const targets: SlurContinuationBoundaryTarget[] = [];
  const context: SlurLayoutContext = input.context;
  const startBoundary: boolean = context.start.systemBoundary;
  const endBoundary: boolean = context.end.systemBoundary;
  if (!startBoundary && !endBoundary) {
    return {context, seed: geometry, targets};
  }
  const startBoundaryTarget: SlurContinuationBoundaryTarget | undefined = startBoundary
    ? continuationBoundaryTarget(input, trajectory, "start", clearance)
    : undefined;
  const endBoundaryTarget: SlurContinuationBoundaryTarget | undefined = endBoundary
    ? continuationBoundaryTarget(input, trajectory, "end", clearance)
    : undefined;
  if (startBoundaryTarget) {
    targets.push(startBoundaryTarget);
  }
  if (endBoundaryTarget) {
    targets.push(endBoundaryTarget);
  }
  const startTarget: number = startBoundaryTarget?.target ?? context.start.seedAnchor.y;
  const endTarget: number = endBoundaryTarget?.target ?? context.end.seedAnchor.y;
  if (startBoundary) {
    geometry.p0.y = startTarget;
  }
  if (endBoundary) {
    geometry.p3.y = endTarget;
  }
  const width: number = geometry.p3.x - geometry.p0.x;
  if (startBoundary) {
    const run: number = Math.max(0.001, Math.abs(width) / 3);
    geometry.p1 = new PointF2D(
      geometry.p0.x + Math.sign(width) * run,
      geometry.p0.y + (startBoundaryTarget?.tangent ?? trajectory.continuationSlope) *
        Math.sign(width) * run,
    );
  }
  if (endBoundary) {
    const run: number = Math.max(0.001, Math.abs(width) / 3);
    geometry.p2 = new PointF2D(
      geometry.p3.x - Math.sign(width) * run,
      geometry.p3.y - (endBoundaryTarget?.tangent ?? trajectory.continuationSlope) *
        Math.sign(width) * run,
    );
  }
  return {
    context: {
      ...context,
      start: startBoundaryTarget ? {
        ...context.start,
        seedAnchor: new PointF2D(context.start.seedAnchor.x, startBoundaryTarget.target),
        preferredTangent: startBoundaryTarget.tangent,
      } : context.start,
      end: endBoundaryTarget ? {
        ...context.end,
        seedAnchor: new PointF2D(context.end.seedAnchor.x, endBoundaryTarget.target),
        preferredTangent: endBoundaryTarget.tangent,
      } : context.end,
    },
    seed: geometry,
    targets,
  };
}

function applySynchronizedBoundaryClearance(
  input: NormalizedLinkedInput,
  target: SlurContinuationBoundaryTarget,
  side: "start" | "end",
  clearance: number,
): void {
  const context: SlurLayoutContext = input.context;
  const adjustedTarget: number = context.direction === PlacementEnum.Above
    ? context.envelope.topLineOffset - clearance
    : context.envelope.bottomLineOffset + clearance;
  target.effectiveClearance = clearance;
  target.target = adjustedTarget;
  const width: number = input.seed.p3.x - input.seed.p0.x;
  const run: number = Math.max(0.001, Math.abs(width) / 3);
  if (side === "start") {
    input.seed.p0.y = adjustedTarget;
    input.seed.p1 = new PointF2D(
      input.seed.p0.x + Math.sign(width) * run,
      adjustedTarget + target.tangent * Math.sign(width) * run,
    );
    input.context = {
      ...context,
      start: {
        ...context.start,
        seedAnchor: new PointF2D(context.start.seedAnchor.x, adjustedTarget),
        preferredTangent: target.tangent,
      },
    };
  } else {
    input.seed.p3.y = adjustedTarget;
    input.seed.p2 = new PointF2D(
      input.seed.p3.x - Math.sign(width) * run,
      adjustedTarget - target.tangent * Math.sign(width) * run,
    );
    input.context = {
      ...context,
      end: {
        ...context.end,
        seedAnchor: new PointF2D(context.end.seedAnchor.x, adjustedTarget),
        preferredTangent: target.tangent,
      },
    };
  }
}

function synchronizeSameStaffBoundaryClearances(inputs: NormalizedLinkedInput[]): void {
  for (let index: number = 0; index < inputs.length - 1; index++) {
    const outgoing: NormalizedLinkedInput = inputs[index];
    const returning: NormalizedLinkedInput = inputs[index + 1];
    if (outgoing.context.isCrossStaff || returning.context.isCrossStaff) {
      // Cross-staff continuations intentionally retain a directed difference
      // between the two break heights.
      continue;
    }
    const expectedArticulationPosition: number = returning.context.direction === PlacementEnum.Above ? 3 : 4;
    const returnsToDurationArticulation: boolean = returning.context.end.articulations.some(
      (articulation): boolean =>
        articulation.classification === "duration" &&
        articulation.position === expectedArticulationPosition,
    );
    if (!returnsToDurationArticulation) {
      // Ordinary short returns retain their destination-aware travel cap. A
      // duration mark outside the endpoint is the case where the two visible
      // fragments must instead read as one continuous outer arch.
      continue;
    }
    const outgoingTarget: SlurContinuationBoundaryTarget = outgoing.targets.find(
      (target): boolean => target.side === "end",
    );
    const returningTarget: SlurContinuationBoundaryTarget = returning.targets.find(
      (target): boolean => target.side === "start",
    );
    if (!outgoingTarget || !returningTarget) {
      continue;
    }
    // A system break is one visual cut through the phrase. Preserve the more
    // outward of the two independently safe clearances on both sides, so the
    // return starts at the same relative height as the exit.
    const sharedClearance: number = Math.max(
      outgoingTarget.effectiveClearance,
      returningTarget.effectiveClearance,
    );
    applySynchronizedBoundaryClearance(outgoing, outgoingTarget, "end", sharedClearance);
    applySynchronizedBoundaryClearance(returning, returningTarget, "start", sharedClearance);
  }
}

function continuationTangentMismatch(
  context: SlurLayoutContext,
  geometry: SlurCurveGeometry,
): number {
  let mismatch: number = 0;
  if (context.start.systemBoundary) {
    const slope: number = (geometry.p1.y - geometry.p0.y) /
      Math.max(0.001, geometry.p1.x - geometry.p0.x);
    mismatch += Math.abs(slope - (context.start.preferredTangent ?? 0));
  }
  if (context.end.systemBoundary) {
    const slope: number = (geometry.p3.y - geometry.p2.y) /
      Math.max(0.001, geometry.p3.x - geometry.p2.x);
    mismatch += Math.abs(slope - (context.end.preferredTangent ?? 0));
  }
  return mismatch;
}

/** Score every system fragment against one normalized source-to-destination trajectory. */
export function calculateLinkedSlurLayouts(
  inputs: readonly SlurLinkedLayoutInput[],
  options: SlurCandidateLayoutOptions,
): SlurLinkedLayoutOutput {
  const ordered: SlurLinkedLayoutInput[] = [...inputs].sort(
    (left, right): number => left.context.segmentIndex - right.context.segmentIndex,
  );
  const groupId: string = ordered[0]?.context.linkedGroupId ?? ordered[0]?.context.id ?? "slur";
  const faults: SlurLayoutFault[] = [];
  const directions: Set<PlacementEnum> = new Set(ordered.map((input) => input.context.direction));
  if (directions.size > 1) {
    faults.push({
      code: "incompatible-linked-placement",
      message: "Linked slur segments must share one placement.",
      segmentIndexes: ordered.map((input) => input.context.segmentIndex),
    });
  }
  if (ordered.some((input, index) => input.context.segmentIndex !== index)) {
    faults.push({
      code: "invalid-linked-segment-order",
      message: "Linked slur segment indexes must be consecutive.",
      segmentIndexes: ordered.map((input) => input.context.segmentIndex),
    });
  }
  const boundaryClearances: number[] = ordered.flatMap((input): number[] => {
    const clearances: number[] = [];
    if (input.context.start.systemBoundary) {
      clearances.push(boundaryClearance(input.context, "start"));
    }
    if (input.context.end.systemBoundary) {
      clearances.push(boundaryClearance(input.context, "end"));
    }
    return clearances;
  });
  const continuationClearance: number = boundaryClearances.length > 0
    ? Math.max(...boundaryClearances)
    : 0;
  const trajectory: SlurLinkedTrajectory = linkedTrajectory(ordered);
  let routedClearance: number = continuationClearance;
  let results: SlurLayoutResult[] = [];
  let normalizedInputs: NormalizedLinkedInput[] = [];
  const maximumAttempts: number = 24;
  for (let attempt: number = 0; attempt < maximumAttempts; attempt++) {
    normalizedInputs = ordered.map((input): NormalizedLinkedInput =>
      normalizeContinuationInput(input, trajectory, routedClearance),
    );
    synchronizeSameStaffBoundaryClearances(normalizedInputs);
    results = normalizedInputs.map((input): SlurLayoutResult =>
      calculateCandidateSlurLayout(input.context, input.seed, options),
    );
    const hasRejectedSelection: boolean = results.some((result): boolean =>
      Boolean(result.candidates.find(
        (candidate): boolean => candidate.id === result.selectedCandidateId,
      )?.rejected),
    );
    if (!hasRejectedSelection || boundaryClearances.length === 0) {
      break;
    }
    if (attempt < maximumAttempts - 1) {
      routedClearance += 0.75;
    }
  }
  const tangentMismatch: number = results.reduce(
    (sum, result, index): number =>
      sum + continuationTangentMismatch(normalizedInputs[index].context, result.geometry),
    0,
  );
  const totalScore: number = results.reduce((sum, result): number => {
    const selected: SlurCurveCandidate = result.candidates.find(
      (candidate): boolean => candidate.id === result.selectedCandidateId,
    );
    return sum + (selected?.rejected || !selected?.score
      ? rejectedCandidateScore
      : selected.score.total);
  }, tangentMismatch * options.scoreWeights.systemContinuity);
  const boundaryTargets: SlurContinuationBoundaryTarget[] = normalizedInputs.flatMap(
    (input): SlurContinuationBoundaryTarget[] => [...input.targets],
  );
  return {
    results,
    diagnostics: {
      groupId,
      continuationClearance: routedClearance,
      segmentIndexes: ordered.map((input) => input.context.segmentIndex),
      totalScore,
      tangentMismatch,
      sourceSemanticHeight: trajectory.sourceSemanticHeight,
      destinationSemanticHeight: trajectory.destinationSemanticHeight,
      continuationSlope: trajectory.continuationSlope,
      boundaryTargets,
      faults,
    },
  };
}

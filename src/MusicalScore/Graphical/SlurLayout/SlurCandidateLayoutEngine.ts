import { PointF2D } from "../../../Common/DataObjects/PointF2D";
import { PlacementEnum } from "../../VoiceData/Expressions/AbstractExpression";
import {
  SlurAnchorCandidate,
  SlurArticulationAdjustment,
  SlurArticulationContext,
  SlurBounds,
  SlurCandidateScore,
  SlurCandidateScoreWeights,
  SlurCurveCandidate,
  SlurCurveFamily,
  SlurCurveGeometry,
  SlurDiagnosticsLevel,
  SlurEndpointContext,
  SlurLayoutContext,
  SlurLayoutResult,
  SlurObstacle,
  SlurSkylineUpdate,
} from "./SlurLayoutTypes";

export interface SlurCandidateLayoutOptions {
  candidateLimit: number;
  diagnosticsLevel: SlurDiagnosticsLevel;
  maximumPreferredClearance: number;
  obstacleClearance: number;
  scoreWeights: SlurCandidateScoreWeights;
}

interface EvaluatedGeometry {
  maximumPenetration: number;
  minimumClearance: number;
  nearCollisionCount: number;
  obstacleIntersections: number;
  forbiddenObstacleIntersections: number;
  forbiddenObstacleIds: readonly string[];
  excessiveClearance: number;
  staffLineInteraction: number;
}

const curveFamilies: readonly SlurCurveFamily[] = [
  "normal",
  "shallow",
  "high",
  "flattened-long",
  "start-weighted",
  "end-weighted",
  "system-continuation",
];

const noteheadAttachments: readonly SlurAnchorCandidate["type"][] = [
  "notehead",
  "notehead-center",
  "notehead-shoulder",
  "outer-head",
];
const noteheadDisplacementFactor: number = 0.65;
const compactInStaffSpan: number = 5;

const finitePoint: (point: PointF2D) => boolean = (point: PointF2D): boolean =>
  Number.isFinite(point.x) && Number.isFinite(point.y);

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

function ledgerLineIsOnSlurSide(
  context: SlurLayoutContext,
  endpoint: SlurEndpointContext,
  obstacle: SlurObstacle,
): boolean {
  if (!endpoint.notehead || obstacle.type !== "ledger-line") {
    return false;
  }
  const tolerance: number = 0.05;
  return context.direction === PlacementEnum.Above
    ? obstacle.bounds.top <= endpoint.notehead.top + tolerance
    : obstacle.bounds.bottom >= endpoint.notehead.bottom - tolerance;
}

function endpointLedgerLinesOnSlurSide(
  context: SlurLayoutContext,
  endpoint: SlurEndpointContext,
  side: "start" | "end",
): SlurObstacle[] {
  return context.obstacles.filter(
    (obstacle): boolean =>
      (obstacle.endpoint === side || obstacle.endpoint === "both") &&
      ledgerLineIsOnSlurSide(context, endpoint, obstacle),
  );
}

export function pointOnSlurCurve(geometry: SlurCurveGeometry, t: number): PointF2D {
  const inverse: number = 1 - t;
  const inverseSquared: number = inverse * inverse;
  const tSquared: number = t * t;
  return new PointF2D(
    inverseSquared * inverse * geometry.p0.x +
      3 * inverseSquared * t * geometry.p1.x +
      3 * inverse * tSquared * geometry.p2.x +
      tSquared * t * geometry.p3.x,
    inverseSquared * inverse * geometry.p0.y +
      3 * inverseSquared * t * geometry.p1.y +
      3 * inverse * tSquared * geometry.p2.y +
      tSquared * t * geometry.p3.y,
  );
}

function makeAnchor(
  context: SlurLayoutContext,
  side: "start" | "end",
  x: number,
  y: number,
  type: SlurAnchorCandidate["type"],
  generationIndex: number,
  displacement: number,
): SlurAnchorCandidate {
  const endpoint: SlurEndpointContext = side === "start" ? context.start : context.end;
  const expectedArticulationPosition: number = context.direction === PlacementEnum.Above ? 3 : 4;
  const insideDurationArticulations: number = endpoint.articulations.filter(
    (articulation) =>
      articulation.position === expectedArticulationPosition &&
      articulation.classification === "duration",
  ).length;
  return {
    id: `${context.id}-${side}-${type}-${generationIndex}`,
    x,
    y,
    type,
    side,
    direction: context.direction,
    preferredTangent: endpoint.preferredTangent,
    penalties: {
      displacement,
      articulationRelationship:
        type === "outside-articulation" ? 0 : insideDurationArticulations * 0.24,
      stemRelationship:
        type === "stem" || type === "stem-tip" || type === "beam-side"
          ? endpoint.stemSide ? 0 : 0.45
          : endpoint.stemSide ? 0.3 : 0,
      // A tie at the same notehead does not make the finalized stem tip an
      // invalid slur attachment. The old blanket penalty made a stale
      // notehead anchor win even when the slur sat on the rendered stem side.
      // Retain a small warning for lateral notehead anchors, where the tie and
      // slur can genuinely compete for the same shoulder. This is semantic:
      // it must not depend on whichever attachment the comparison engine chose.
      tieConflict:
        endpoint.tiedEndpoint &&
        ["notehead", "notehead-shoulder", "outer-head"].includes(type)
          ? 0.5
          : 0,
    },
    generationIndex,
  };
}

export function generateSlurAnchors(
  context: SlurLayoutContext,
  seed: SlurCurveGeometry,
  endpointGap: number,
): { start: SlurAnchorCandidate[], end: SlurAnchorCandidate[] } {
  const result: { start: SlurAnchorCandidate[], end: SlurAnchorCandidate[] } = {
    start: [],
    end: [],
  };
  for (const side of ["start", "end"] as const) {
    const endpoint: SlurEndpointContext = side === "start" ? context.start : context.end;
    const seedPoint: PointF2D = side === "start" ? seed.p0 : seed.p3;
    let generationIndex: number = 0;
    const direction: number = context.direction === PlacementEnum.Above ? -1 : 1;
    const returnsAcrossSystems: boolean =
      context.isCrossSystem && side === "end" && context.start.systemBoundary;
    const noteheadCenterX: number | undefined = endpoint.notehead
      ? (endpoint.notehead.left + endpoint.notehead.right) / 2
      : undefined;
    const noteheadSideY: number | undefined = endpoint.notehead
      ? (direction < 0 ? endpoint.notehead.top : endpoint.notehead.bottom) + direction * endpointGap
      : undefined;
    const stemTipX: number | undefined = endpoint.stem
      ? (endpoint.stem.left + endpoint.stem.right) / 2 + (side === "start" ? 0.08 : -0.08)
      : undefined;
    const stemTipY: number | undefined = endpoint.stem
      ? (direction < 0 ? endpoint.stem.top : endpoint.stem.bottom) + direction * endpointGap
      : undefined;
    let seedDisplacement: number = endpoint.seedAttachment === "voice-entry" ? 0.12 : 0.04;
    if (
      endpoint.notehead &&
      noteheadAttachments.includes(endpoint.seedAttachment) &&
      noteheadCenterX !== undefined &&
      noteheadSideY !== undefined
    ) {
      // Compare imported notehead seeds with the rendered head rather than
      // giving every source coordinate the same nominal cost. MusicXML
      // bezier endpoints can sit at a distant shoulder (or even in open
      // space), and that geometry must remain available without being
      // artificially cheaper than a semantic attachment.
      seedDisplacement = Math.hypot(
        seedPoint.x - noteheadCenterX,
        seedPoint.y - noteheadSideY,
      ) * noteheadDisplacementFactor;
    }
    if (endpoint.seedAttachment === "stem" && stemTipX !== undefined && stemTipY !== undefined) {
      seedDisplacement += Math.hypot(seedPoint.x - stemTipX, seedPoint.y - stemTipY) * 0.42;
    }
    const seedStemHasFinalGeometry: boolean =
      endpoint.seedAttachment === "stem" && Boolean(endpoint.stem);
    const seedContainerHasFinalGeometry: boolean =
      endpoint.seedAttachment === "voice-entry" && Boolean(endpoint.notehead || endpoint.stem);
    const unreliableSeedStem: boolean =
      endpoint.seedAttachment === "stem" && !endpoint.stem && Boolean(endpoint.notehead);
    if (
      !seedStemHasFinalGeometry &&
      !seedContainerHasFinalGeometry &&
      !unreliableSeedStem &&
      !(returnsAcrossSystems && ["beam-side", "stem", "stem-side", "stem-tip"].includes(
        endpoint.seedAttachment,
      ))
    ) {
      result[side].push(
        makeAnchor(
          context,
          side,
          seedPoint.x,
          seedPoint.y,
          endpoint.seedAttachment,
          generationIndex++,
          seedDisplacement,
        ),
      );
    }
    if (endpoint.systemBoundary) {
      result[side].push(
        makeAnchor(context, side, seedPoint.x, seedPoint.y, "system-edge", generationIndex++, 0),
      );
      continue;
    }
    if (endpoint.notehead) {
      result[side].push(
        makeAnchor(
          context,
          side,
          noteheadCenterX,
          noteheadSideY,
          "notehead-center",
          generationIndex++,
          // The rendered crown is the semantic reference for an ordinary
          // single-note endpoint. Chords, stems, articulations, tangents, and
          // collision scoring can still make another candidate preferable.
          0,
        ),
      );
      const endpointLedgerLines: SlurObstacle[] = endpoint.chordSize <= 1
        ? endpointLedgerLinesOnSlurSide(context, endpoint, side)
        : [];
      const endpointOuterBounds: SlurBounds[] = [
        endpoint.notehead,
        ...endpoint.accidentals,
        ...endpointLedgerLines.map((obstacle): SlurBounds => obstacle.bounds),
      ];
      const shoulderGap: number = endpointLedgerLines.length > 0 ? endpointGap + 0.02 : 0.08;
      const x: number = side === "start"
        ? Math.max(...endpointOuterBounds.map((bounds): number => bounds.right)) + shoulderGap
        : Math.min(...endpointOuterBounds.map((bounds): number => bounds.left)) - shoulderGap;
      const sameSideBounds: SlurBounds[] = endpointLedgerLines.length > 0
        ? [endpoint.notehead]
        : [endpoint.notehead, ...endpoint.accidentals];
      const y: number =
        (direction < 0
          ? Math.min(...sameSideBounds.map((bounds): number => bounds.top))
          : Math.max(...sameSideBounds.map((bounds): number => bounds.bottom))) +
        direction * endpointGap;
      const displacement: number = Math.hypot(x - noteheadCenterX, y - noteheadSideY);
      result[side].push(
        makeAnchor(
          context,
          side,
          x,
          y,
          "notehead-shoulder",
          generationIndex++,
          displacement * noteheadDisplacementFactor,
        ),
      );
      // Chord endpoint geometry has already selected the placement-side outer
      // head. An additional inset anchor would pull opposing double slurs back
      // into the chord, so reserve it for single-note endpoints.
      if (endpoint.chordSize <= 1) {
        const noteheadWidth: number = endpoint.notehead.right - endpoint.notehead.left;
        const inset: number = Math.min(0.45, noteheadWidth * 0.42);
        const outerHeadX: number =
          side === "start" ? endpoint.notehead.right - inset : endpoint.notehead.left + inset;
        const outerHeadDisplacement: number = Math.hypot(
          outerHeadX - noteheadCenterX,
          y - noteheadSideY,
        );
        result[side].push(
          makeAnchor(
            context,
            side,
            outerHeadX,
            y,
            "outer-head",
            generationIndex++,
            outerHeadDisplacement * noteheadDisplacementFactor,
          ),
        );
      }
    }
    if (
      !returnsAcrossSystems &&
      endpoint.stemSide &&
      (endpoint.beamSideAnchor || endpoint.beams.length > 0)
    ) {
      const x: number = endpoint.beamSideAnchor?.x ?? (endpoint.stem
        ? (endpoint.stem.left + endpoint.stem.right) / 2
        : seedPoint.x);
      const beamEdge: number = endpoint.beamSideAnchor?.y ?? (
        direction < 0
          ? Math.min(...endpoint.beams.map((beam) => beam.top))
          : Math.max(...endpoint.beams.map((beam) => beam.bottom))
      );
      const y: number = beamEdge + direction * endpointGap;
      const displacement: number = Math.hypot(x - seedPoint.x, y - seedPoint.y);
      result[side].push(
        makeAnchor(
          context,
          side,
          x,
          y,
          "beam-side",
          generationIndex++,
          displacement * (context.sharedEndpointBeam || context.isCrossStaff ? 0.015 : 0.12),
        ),
      );
    }
    if (!returnsAcrossSystems && endpoint.stem && endpoint.stemSide) {
      const displacement: number = Math.hypot(
        stemTipX - seedPoint.x,
        stemTipY - seedPoint.y,
      );
      // Remote stem tips are undesirable for opposing/nested chord slurs, but
      // a single compact phrase on the stem side should be allowed to join the
      // finalized stems. Applying this guard to every chord caused polyphonic
      // phrases to cross both stems on their way to notehead anchors.
      const avoidRemoteCompactStem: boolean =
        endpoint.chordSize > 1 &&
        Math.abs(seed.p3.x - seed.p0.x) < 10 &&
        context.isNested;
      const displacementPenalty: number = avoidRemoteCompactStem
        ? displacement + 0.85
        : (context.sharedEndpointBeam || context.isCrossStaff) && endpoint.beamSideAnchor
          ? Math.min(displacement * 0.04, 0.12) + 0.35
        : Math.min(displacement * 0.04, 0.12);
      result[side].push(
        makeAnchor(
          context,
          side,
          stemTipX,
          stemTipY,
          "stem-tip",
          generationIndex++,
          displacementPenalty,
        ),
      );
    }
    const sameSideArticulations: SlurArticulationContext[] = endpoint.articulations.filter(
      (articulation) =>
        articulation.classification === "duration" &&
        (context.direction === PlacementEnum.Above
          ? articulation.position === 3
          : articulation.position === 4),
    );
    if (sameSideArticulations.length > 0) {
      const extreme: number =
        direction < 0
          ? Math.min(...sameSideArticulations.map((articulation) => articulation.bounds.top))
          : Math.max(...sameSideArticulations.map((articulation) => articulation.bounds.bottom));
      const y: number = extreme + direction * endpointGap;
      const x: number = endpoint.stemSide && stemTipX !== undefined
        ? stemTipX
        : noteheadCenterX ?? seedPoint.x;
      const displacement: number = Math.hypot(x - seedPoint.x, y - seedPoint.y);
      result[side].push(
        makeAnchor(
          context,
          side,
          x,
          y,
          "outside-articulation",
          generationIndex++,
          displacement * 0.14,
        ),
      );
    }
  }
  return result;
}

function contourPressureRatio(
  context: SlurLayoutContext,
  start: {x: number, y: number},
  end: {x: number, y: number},
): number {
  const width: number = end.x - start.x;
  if (width <= 0.001) {
    return 0.5;
  }
  if (isUnobstructedCompactCurve(context, start, end)) {
    // Endpoint noteheads dominate a short envelope and can pull its sampled
    // pressure to one side even though there is no internal notation to
    // avoid. Keep that ordinary two-note gesture optically balanced.
    return 0.5;
  }
  const samples: {ratio: number, pressure: number}[] = [];
  for (let sample: number = 0; sample <= 32; sample++) {
    const ratio: number = 0.12 + (sample / 32) * 0.76;
    const x: number = start.x + width * ratio;
    const envelopeIndex: number = Math.max(
      0,
      Math.min(
        context.envelope.skyline.length - 1,
        Math.round(x * context.envelope.samplingUnit),
      ),
    );
    const envelopeValue: number = context.direction === PlacementEnum.Above
      ? context.envelope.skyline[envelopeIndex]
      : context.envelope.bottomline[envelopeIndex];
    if (!Number.isFinite(envelopeValue)) {
      continue;
    }
    const baseline: number = lineY(start, end, x);
    const pressure: number = context.direction === PlacementEnum.Above
      ? baseline - envelopeValue
      : envelopeValue - baseline;
    samples.push({ratio, pressure});
  }
  if (samples.length === 0) {
    return 0.5;
  }
  const floor: number = Math.min(...samples.map((sample): number => sample.pressure));
  let totalWeight: number = 0;
  let weightedRatio: number = 0;
  for (const sample of samples) {
    // Subtract the uniform staff contour so an otherwise clear phrase remains
    // symmetrical. The small residual weight averages several nearby peaks
    // instead of snapping the crown to one skyline sample.
    const weight: number = Math.max(0, sample.pressure - floor);
    totalWeight += weight;
    weightedRatio += sample.ratio * weight;
  }
  if (totalWeight <= 0.001) {
    return 0.5;
  }
  const pressureRatio: number = weightedRatio / totalWeight;
  return Math.max(0.3, Math.min(0.7, 0.5 + (pressureRatio - 0.5) * 0.65));
}

function curveApexRatio(context: SlurLayoutContext, geometry: SlurCurveGeometry): number {
  let apexRatio: number = 0.5;
  let apexY: number = context.direction === PlacementEnum.Above
    ? Number.POSITIVE_INFINITY
    : Number.NEGATIVE_INFINITY;
  for (let sample: number = 0; sample <= 64; sample++) {
    const ratio: number = sample / 64;
    const point: PointF2D = pointOnSlurCurve(geometry, ratio);
    const isNewApex: boolean = context.direction === PlacementEnum.Above
      ? point.y < apexY
      : point.y > apexY;
    if (isNewApex) {
      apexY = point.y;
      apexRatio = (point.x - geometry.p0.x) /
        Math.max(0.001, geometry.p3.x - geometry.p0.x);
    }
  }
  return apexRatio;
}

function lineY(start: { x: number, y: number }, end: { x: number, y: number }, x: number): number {
  const width: number = end.x - start.x;
  if (Math.abs(width) < 0.0001) {
    return (start.y + end.y) / 2;
  }
  return start.y + (end.y - start.y) * ((x - start.x) / width);
}

function compactReferenceSpan(
  context: SlurLayoutContext,
  start: {x: number, y: number},
  end: {x: number, y: number},
): number {
  // Classify the musical gap rather than the candidate's attachment span.
  // Otherwise moving from the crown to an inward notehead edge can make one
  // candidate "compact" while a centred candidate for the same two notes is
  // not, rewarding visibly loose endpoints near the cutoff.
  const startX: number = context.start.notehead?.right ?? start.x;
  const endX: number = context.end.notehead?.left ?? end.x;
  return Math.abs(endX - startX);
}

interface ObstacleBowConstraint {
  ratio: number;
  requiredOffset: number;
  notationObstacle: boolean;
}

function obstacleBowConstraints(
  context: SlurLayoutContext,
  start: {x: number, y: number},
  end: {x: number, y: number},
): ObstacleBowConstraint[] {
  const constraints: ObstacleBowConstraint[] = [];
  const middleX: number = (start.x + end.x) / 2;
  const middleBaseline: number = lineY(start, end, middleX);
  if (compactReferenceSpan(context, start, end) >= compactInStaffSpan) {
    const staffEdgeClearance: number = 0.12;
    const staffEdgeBow: number = context.direction === PlacementEnum.Above
      ? middleBaseline - (context.envelope.topLineOffset - staffEdgeClearance)
      : context.envelope.bottomLineOffset + staffEdgeClearance - middleBaseline;
    // A phrase-length high family needs a genuine route outside the staff
    // while retaining its notehead attachments. A clear adjacent-note slur
    // may remain within the staff; forcing it around the staff edge makes it
    // much larger than the gesture it describes.
    if (staffEdgeBow > 0) {
      constraints.push({ratio: 0.5, requiredOffset: staffEdgeBow, notationObstacle: false});
    }
  }
  for (const obstacle of context.obstacles) {
    if (!isForbiddenObstacle(obstacle)) {
      continue;
    }
    // Do not make the high-family generator dive around an object contained
    // wholly inside an endpoint attachment zone, including a neighbouring
    // polyphonic head without endpoint metadata. The exact evaluator still
    // rejects a curve that actually crosses it; this only prevents a local
    // object from demanding an implausibly steep phrase-wide bow.
    const belongsToStartEndpoint: boolean = obstacle.endpoint === "start" || obstacle.endpoint === "both";
    const belongsToEndEndpoint: boolean = obstacle.endpoint === "end" || obstacle.endpoint === "both";
    const localStartObstacle: boolean = (!context.isCrossStaff || belongsToStartEndpoint)
      && obstacle.type !== "accidental" &&
      obstacle.bounds.right <= Math.max(
        start.x,
        context.start.notehead?.right ?? start.x,
      ) + obstacle.clearance;
    const localEndObstacle: boolean = (!context.isCrossStaff || belongsToEndEndpoint)
      && obstacle.type !== "accidental" &&
      obstacle.bounds.left >= Math.min(
        end.x,
        context.end.notehead?.left ?? end.x,
      ) - obstacle.clearance;
    if (localStartObstacle || localEndObstacle) {
      continue;
    }
    let left: number = Math.max(start.x, obstacle.bounds.left);
    let right: number = Math.min(end.x, obstacle.bounds.right);
    if (belongsToStartEndpoint) {
      left = Math.max(
        left,
        Math.max(start.x, context.start.notehead?.right ?? start.x) + obstacle.clearance,
      );
    }
    if (belongsToEndEndpoint) {
      right = Math.min(
        right,
        Math.min(end.x, context.end.notehead?.left ?? end.x) - obstacle.clearance,
      );
    }
    if (right <= left) {
      continue;
    }
    // A sloped beam or a compact tuplet can be most restrictive away from its
    // bounding-box centre. Sample the complete overlap so the routed family
    // clears the real obstacle with the least sufficient bow instead of either
    // missing an edge or falling back to an excessively deep source curve.
    for (let sample: number = 0; sample <= 8; sample++) {
      const x: number = left + (right - left) * (sample / 8);
      const t: number = (x - start.x) / Math.max(0.001, end.x - start.x);
      if (t <= 0.001 || t >= 0.999) {
        continue;
      }
      const baseline: number = lineY(start, end, x);
      const polygonRange: {top: number, bottom: number} | undefined = obstacle.polygon
        ? polygonYRangeAtX(obstacle.polygon, x)
        : undefined;
      const obstacleTop: number = polygonRange?.top ?? obstacle.bounds.top;
      const obstacleBottom: number = polygonRange?.bottom ?? obstacle.bounds.bottom;
      const neededAtX: number = context.direction === PlacementEnum.Above
        ? baseline - (obstacleTop - obstacle.clearance)
        : obstacleBottom + obstacle.clearance - baseline;
      if (neededAtX > 0) {
        constraints.push({ratio: t, requiredOffset: neededAtX, notationObstacle: true});
      }
    }
  }
  return constraints;
}

function requiredObstacleBow(
  context: SlurLayoutContext,
  start: {x: number, y: number},
  end: {x: number, y: number},
): number {
  let required: number = 0;
  for (const constraint of obstacleBowConstraints(context, start, end)) {
    const t: number = constraint.ratio;
    const cubicControlInfluence: number = Math.max(0.04, 3 * t * (1 - t));
    required = Math.max(required, constraint.requiredOffset / cubicControlInfluence);
  }
  return Math.max(0, required);
}

function requiredObstacleControlBows(
  context: SlurLayoutContext,
  start: {x: number, y: number},
  end: {x: number, y: number},
  minimumBow: number,
): {start: number, end: number} {
  let startBow: number = minimumBow;
  let endBow: number = minimumBow;
  const constraints: ObstacleBowConstraint[] = obstacleBowConstraints(context, start, end);
  // Project the two control heights onto every sampled clearance constraint.
  // This retains a balanced crown for a flat obstacle profile, but lets an
  // obstruction concentrated near one endpoint increase only the control
  // point that can clear it efficiently. Repeating the deterministic pass
  // converges after nearby constraints have adjusted one another.
  for (let iteration: number = 0; iteration < 8; iteration++) {
    let changed: boolean = false;
    for (const constraint of constraints) {
      const t: number = constraint.ratio;
      const startInfluence: number = 3 * (1 - t) * (1 - t) * t;
      const endInfluence: number = 3 * (1 - t) * t * t;
      const deficit: number = constraint.requiredOffset -
        (startInfluence * startBow + endInfluence * endBow);
      if (deficit <= 0.0001) {
        continue;
      }
      const squaredInfluence: number =
        startInfluence * startInfluence + endInfluence * endInfluence;
      if (squaredInfluence <= 0.000001) {
        continue;
      }
      startBow += deficit * startInfluence / squaredInfluence;
      endBow += deficit * endInfluence / squaredInfluence;
      changed = true;
    }
    if (!changed) {
      break;
    }
  }
  return {start: startBow, end: endBow};
}

function boundaryHasNotationPressure(
  context: SlurLayoutContext,
  start: {x: number, y: number},
  end: {x: number, y: number},
  side: "start" | "end",
): boolean {
  const sampledPressure: boolean = obstacleBowConstraints(context, start, end).some(
    (constraint): boolean => constraint.notationObstacle &&
      (side === "start" ? constraint.ratio <= 0.55 : constraint.ratio >= 0.45),
  );
  if (sampledPressure) {
    return true;
  }
  // A beam can already lie just inside a stem-tip baseline and therefore need
  // no additional sampled clearance, while still requiring both controls to
  // remain on the slur side for a one-piece arch. Treat real notation in the
  // boundary half as contour pressure; empty system-break fragments retain
  // their exact linked tangent.
  const midpoint: number = (start.x + end.x) / 2;
  return context.obstacles.some((obstacle): boolean =>
    isForbiddenObstacle(obstacle) &&
    obstacle.bounds.right >= Math.min(start.x, end.x) &&
    obstacle.bounds.left <= Math.max(start.x, end.x) &&
    (side === "start" ? obstacle.bounds.left <= midpoint : obstacle.bounds.right >= midpoint),
  );
}

function isUnobstructedCompactCurve(
  context: SlurLayoutContext,
  start: {x: number, y: number},
  end: {x: number, y: number},
): boolean {
  return context.start.articulations.length === 0 &&
    context.end.articulations.length === 0 &&
    compactReferenceSpan(context, start, end) < compactInStaffSpan &&
    requiredObstacleBow(context, start, end) <= 0.001;
}

function feasibleBoundaryTangent(
  context: SlurLayoutContext,
  side: "start" | "end",
  preferred: number,
  start: SlurAnchorCandidate,
  end: SlurAnchorCandidate,
): number {
  if (context.start.systemBoundary && context.end.systemBoundary) {
    return preferred;
  }
  const chordSlope: number = (end.y - start.y) / Math.max(0.001, end.x - start.x);
  if (context.direction === PlacementEnum.Above) {
    return side === "start"
      ? Math.min(preferred, chordSlope)
      : Math.max(preferred, chordSlope);
  }
  return side === "start"
    ? Math.max(preferred, chordSlope)
    : Math.min(preferred, chordSlope);
}

function familyGeometry(
  seed: SlurCurveGeometry,
  start: SlurAnchorCandidate,
  end: SlurAnchorCandidate,
  family: SlurCurveFamily,
  context: SlurLayoutContext,
): SlurCurveGeometry {
  if (
    family === "normal" &&
    start.type === context.start.seedAttachment &&
    end.type === context.end.seedAttachment &&
    Math.abs(start.x - seed.p0.x) < 0.0001 &&
    Math.abs(start.y - seed.p0.y) < 0.0001 &&
    Math.abs(end.x - seed.p3.x) < 0.0001 &&
    Math.abs(end.y - seed.p3.y) < 0.0001 &&
    (!context.isCrossStaff || context.isCrossSystem)
  ) {
    return cloneGeometry(seed);
  }
  const width: number = end.x - start.x;
  if (family === "system-continuation") {
    const p0: PointF2D = new PointF2D(start.x, start.y);
    const p3: PointF2D = new PointF2D(end.x, end.y);
    if (context.start.systemBoundary && context.end.systemBoundary) {
      const middleStartTangent: number = start.preferredTangent ?? 0;
      const middleEndTangent: number = end.preferredTangent ?? middleStartTangent;
      return {
        p0,
        p1: new PointF2D(start.x + width / 3, start.y + middleStartTangent * width / 3),
        p2: new PointF2D(end.x - width / 3, end.y - middleEndTangent * width / 3),
        p3,
      };
    }
    const startTangent: number = feasibleBoundaryTangent(
      context,
      "start",
      start.preferredTangent ?? 0,
      start,
      end,
    );
    const endTangent: number = feasibleBoundaryTangent(
      context,
      "end",
      end.preferredTangent ?? 0,
      start,
      end,
    );
    const control: PointF2D = context.start.systemBoundary
      ? new PointF2D(
        start.x + width * 0.35,
        start.y + startTangent * width * 0.35,
      )
      : new PointF2D(
        start.x + width * 0.65,
        end.y - endTangent * width * 0.35,
      );
    return {
      p0,
      p1: new PointF2D(
        start.x + (control.x - start.x) * 2 / 3,
        start.y + (control.y - start.y) * 2 / 3,
      ),
      p2: new PointF2D(
        end.x + (control.x - end.x) * 2 / 3,
        end.y + (control.y - end.y) * 2 / 3,
      ),
      p3,
    };
  }
  const pressureRatio: number = contourPressureRatio(context, start, end);
  let firstRatio: number = Math.max(0.18, Math.min(0.42, pressureRatio - 0.24));
  let secondRatio: number = Math.max(0.58, Math.min(0.82, pressureRatio + 0.24));
  let heightFactor: number = 1;
  switch (family) {
    case "shallow":
      // Short and cross-staff slurs need a readable arch. Flattening these
      // small gestures makes their endpoints look disconnected even when the
      // curve is technically collision-free.
      heightFactor = Math.abs(width) < 10 || context.isCrossStaff ? 1 : 0.78;
      break;
    case "high":
      heightFactor = 1;
      break;
    case "flattened-long":
      heightFactor = width > 14 ? 0.72 : 0.92;
      break;
    case "start-weighted":
      firstRatio = 0.04;
      secondRatio = 0.66;
      heightFactor = 1.22;
      break;
    case "end-weighted":
      firstRatio = 0.34;
      secondRatio = 0.96;
      heightFactor = 1.22;
      break;
    default:
      break;
  }
  let p1x: number = start.x + width * firstRatio;
  let p2x: number = start.x + width * secondRatio;
  const direction: number = context.direction === PlacementEnum.Above ? -1 : 1;
  let minimumBow: number = Math.min(3.2, Math.max(0.65, Math.abs(width) * 0.055));
  const derivesBowFromSemanticAnchors: boolean = [start.type, end.type].some(
    (type: SlurAnchorCandidate["type"]): boolean =>
      type === "stem-tip" || type === "outside-articulation",
  );
  const seedP1Line: number = lineY(seed.p0, seed.p3, seed.p1.x);
  const seedP2Line: number = lineY(seed.p0, seed.p3, seed.p2.x);
  const seedBow: number = Math.max(
    Math.abs(seed.p1.y - seedP1Line),
    Math.abs(seed.p2.y - seedP2Line),
  );
  if (derivesBowFromSemanticAnchors) {
    // Retain enough of the source contour to leave the staff cleanly, but cap
    // it relative to the newly selected span. A moved local endpoint must not
    // inherit the full depth of a remote notehead route. Dense notation is
    // handled by the high family's sampled obstacle clearance below.
    minimumBow = Math.max(minimumBow, Math.min(seedBow, minimumBow * 1.9));
  } else {
    // The exact source route remains a separate normal candidate. Regenerated
    // notehead routes retain the source contour only up to a span-relative
    // cap, so an exported bezier cannot force every semantic alternative to
    // reproduce its excessive bow. Compact phrases use the tighter cap; the
    // high family below remains responsible for real obstacle clearance.
    const sourceBowCapFactor: number = Math.abs(width) < 10
      ? 1.8
      : Math.abs(width) < 20 ? 1.6 : 1.8;
    minimumBow = Math.max(minimumBow, Math.min(seedBow, minimumBow * sourceBowCapFactor));
  }
  if (context.isCrossStaff) {
    // A steep cross-staff route needs enough independent bow to read as a
    // slur rather than a loose diagonal joining two different staves.
    minimumBow = Math.max(
      minimumBow,
      Math.min(2, 0.9 + Math.abs(end.y - start.y) * 0.12),
    );
  }
  let startBow: number = minimumBow;
  let endBow: number = minimumBow;
  if (family === "high") {
    // The ordinary skyline seed can remain inside a dense beam, tuplet, grace
    // cluster, or an already-selected inner slur. Reserve the high family as a
    // deterministic obstacle-routed alternative rather than merely scaling the
    // same insufficient bow by a fixed percentage.
    const routedBows: {start: number, end: number} = requiredObstacleControlBows(
      context,
      start,
      end,
      minimumBow,
    );
    startBow = routedBows.start * 1.08;
    endBow = routedBows.end * 1.08;
  }
  // The exact geometry seed is retained above as one candidate. Regenerated
  // semantic endpoint routes derive their bow from the selected anchors and
  // typed obstacles instead of reproducing a remote notehead route.
  let startControlBow: number = startBow * direction;
  let endControlBow: number = endBow * direction;
  if (context.isCrossStaff) {
    // `commonBow` is applied on the screen's y axis. For a steep cross-staff
    // phrase that represents only a fraction of the visible, perpendicular
    // curvature and makes the result read as a nearly straight diagonal.
    // Preserve a stable x progression while converting the intended bow to
    // its vertical projection. The cap prevents almost-vertical gestures from
    // producing an unreasonably high arch.
    const perpendicularProjection: number = Math.min(
      1.75,
      Math.hypot(width, end.y - start.y) / Math.max(0.001, Math.abs(width)),
    );
    startControlBow *= perpendicularProjection;
    endControlBow *= perpendicularProjection;
  }
  if (
    Math.abs(width) < 10 &&
    Math.abs(width) > 0.001 &&
    !context.isCrossStaff &&
    !context.start.systemBoundary &&
    !context.end.systemBoundary
  ) {
    // A compact, obstacle-routed slur can need a substantial bow while the
    // contour pressure places one control point very close to its endpoint.
    // That combination creates the hooked ends seen at different responsive
    // widths. Widen only a control arm whose actual endpoint tangent is too
    // steep, preserving asymmetric contours that already leave both notes
    // cleanly.
    const baselineSlope: number = (end.y - start.y) / width;
    const effectiveStartBow: number = startControlBow * heightFactor;
    const effectiveEndBow: number = endControlBow * heightFactor;
    // An independently routed high control can carry more bow than its mate.
    // Let that arm reach the midpoint when necessary; the paired controls can
    // meet there without reversing their x order. Ordinary families retain a
    // little more crown width.
    const maximumControlRun: number = Math.abs(width) * (family === "high" ? 0.5 : 0.44);
    const maximumEndpointSlope: number = 2.1;
    const widenControlRun: (initialRun: number, bowOffset: number) => number =
      (initialRun, bowOffset): number => {
        const tangentSlope: (run: number) => number = (run): number =>
          Math.abs(baselineSlope + bowOffset / Math.max(0.001, run));
        if (
          initialRun >= maximumControlRun ||
          tangentSlope(initialRun) <= maximumEndpointSlope ||
          tangentSlope(maximumControlRun) >= tangentSlope(initialRun)
        ) {
          return initialRun;
        }
        if (tangentSlope(maximumControlRun) > maximumEndpointSlope) {
          return maximumControlRun;
        }
        let lower: number = initialRun;
        let upper: number = maximumControlRun;
        for (let iteration: number = 0; iteration < 16; iteration++) {
          const midpoint: number = (lower + upper) / 2;
          if (tangentSlope(midpoint) > maximumEndpointSlope) {
            lower = midpoint;
          } else {
            upper = midpoint;
          }
        }
        return upper;
      };
    const horizontalDirection: number = Math.sign(width);
    const startRun: number = widenControlRun(Math.abs(p1x - start.x), effectiveStartBow);
    const endRun: number = widenControlRun(Math.abs(end.x - p2x), -effectiveEndBow);
    p1x = start.x + horizontalDirection * startRun;
    p2x = end.x - horizontalDirection * endRun;
  }
  const p1: PointF2D = new PointF2D(
    p1x,
    lineY(start, end, p1x) + startControlBow * heightFactor,
  );
  const p2: PointF2D = new PointF2D(
    p2x,
    lineY(start, end, p2x) + endControlBow * heightFactor,
  );
  if (context.start.systemBoundary) {
    const tangent: number = feasibleBoundaryTangent(
      context,
      "start",
      start.preferredTangent ?? 0,
      start,
      end,
    );
    const tangentY: number = start.y + tangent * (p1.x - start.x);
    // A boundary tangent is a continuity preference, not permission to pull
    // an obstacle-routed control back through a beam. Retain whichever value
    // lies farther on the slur side.
    p1.y = boundaryHasNotationPressure(context, start, end, "start")
      ? context.direction === PlacementEnum.Above
        ? Math.min(p1.y, tangentY)
        : Math.max(p1.y, tangentY)
      : tangentY;
  }
  if (context.end.systemBoundary) {
    const tangent: number = feasibleBoundaryTangent(
      context,
      "end",
      end.preferredTangent ?? 0,
      start,
      end,
    );
    const tangentY: number = end.y - tangent * (end.x - p2.x);
    p2.y = boundaryHasNotationPressure(context, start, end, "end")
      ? context.direction === PlacementEnum.Above
        ? Math.min(p2.y, tangentY)
        : Math.max(p2.y, tangentY)
      : tangentY;
  }
  return {
    p0: new PointF2D(start.x, start.y),
    p1,
    p2,
    p3: new PointF2D(end.x, end.y),
  };
}

function boundsContain(
  bounds: SlurObstacle["bounds"],
  point: PointF2D,
  clearance: number,
): boolean {
  return (
    point.x >= bounds.left - clearance &&
    point.x <= bounds.right + clearance &&
    point.y >= bounds.top - clearance &&
    point.y <= bounds.bottom + clearance
  );
}

function distanceToSegment(point: PointF2D, start: PointF2D, end: PointF2D): number {
  const dx: number = end.x - start.x;
  const dy: number = end.y - start.y;
  const lengthSquared: number = dx * dx + dy * dy;
  if (lengthSquared <= 0.000001) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const ratio: number = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
  );
  return Math.hypot(point.x - (start.x + ratio * dx), point.y - (start.y + ratio * dy));
}

function polygonContainsWithClearance(
  polygon: readonly PointF2D[],
  point: PointF2D,
  clearance: number,
): boolean {
  if (polygon.length < 3) {
    return false;
  }
  let inside: boolean = false;
  for (let index: number = 0, previous: number = polygon.length - 1;
    index < polygon.length;
    previous = index++) {
    const currentPoint: PointF2D = polygon[index];
    const previousPoint: PointF2D = polygon[previous];
    if (distanceToSegment(point, previousPoint, currentPoint) <= clearance) {
      return true;
    }
    const crossesRay: boolean =
      (currentPoint.y > point.y) !== (previousPoint.y > point.y) &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
        currentPoint.x;
    if (crossesRay) {
      inside = !inside;
    }
  }
  return inside;
}

function polygonYRangeAtX(
  polygon: readonly PointF2D[],
  x: number,
): {top: number, bottom: number} | undefined {
  const intersections: number[] = [];
  for (let index: number = 0; index < polygon.length; index++) {
    const start: PointF2D = polygon[index];
    const end: PointF2D = polygon[(index + 1) % polygon.length];
    const minimumX: number = Math.min(start.x, end.x);
    const maximumX: number = Math.max(start.x, end.x);
    if (x < minimumX || x > maximumX) {
      continue;
    }
    if (Math.abs(end.x - start.x) <= 0.000001) {
      intersections.push(start.y, end.y);
      continue;
    }
    const ratio: number = (x - start.x) / (end.x - start.x);
    intersections.push(start.y + (end.y - start.y) * ratio);
  }
  if (intersections.length === 0) {
    return undefined;
  }
  return {
    top: Math.min(...intersections),
    bottom: Math.max(...intersections),
  };
}

function sampleCount(geometry: SlurCurveGeometry): number {
  return Math.max(24, Math.min(256, Math.ceil(Math.abs(geometry.p3.x - geometry.p0.x) / 0.2)));
}

function curveParameterAtX(geometry: SlurCurveGeometry, x: number): number {
  let lower: number = 0;
  let upper: number = 1;
  for (let iteration: number = 0; iteration < 32; iteration++) {
    const middle: number = (lower + upper) / 2;
    if (pointOnSlurCurve(geometry, middle).x < x) {
      lower = middle;
    } else {
      upper = middle;
    }
  }
  return (lower + upper) / 2;
}

function isForbiddenObstacle(obstacle: SlurObstacle): boolean {
  switch (obstacle.type) {
    case "notehead":
    case "beam":
    case "ledger-line":
    case "accidental":
    case "tie":
    case "tuplet":
    case "grace-note":
    case "slur":
    case "stem":
      return true;
    default:
      return false;
  }
}

function isInsideEndpointAttachmentZone(
  context: SlurLayoutContext,
  geometry: SlurCurveGeometry,
  obstacle: SlurObstacle,
  point: PointF2D,
  clearance: number,
): boolean {
  if (obstacle.type === "accidental" || obstacle.type === "ledger-line") {
    return false;
  }
  if (obstacle.endpoint === "start" || obstacle.endpoint === "both") {
    // Only exempt the small region in which the curve actually leaves the
    // selected endpoint. Using obstacle.bounds.right here accidentally
    // exempted an entire beamed group or outgoing tie when its bounding box
    // extended across the phrase.
    const attachmentRight: number = Math.max(
      geometry.p0.x,
      context.start.notehead?.right ?? geometry.p0.x,
    );
    if (point.x <= attachmentRight + clearance) {
      return true;
    }
  }
  if (obstacle.endpoint === "end" || obstacle.endpoint === "both") {
    const attachmentLeft: number = Math.min(
      geometry.p3.x,
      context.end.notehead?.left ?? geometry.p3.x,
    );
    return point.x >= attachmentLeft - clearance;
  }
  return false;
}

function evaluateGeometry(
  context: SlurLayoutContext,
  geometry: SlurCurveGeometry,
  options: SlurCandidateLayoutOptions,
): EvaluatedGeometry {
  const count: number = sampleCount(geometry);
  let maximumPenetration: number = 0;
  let minimumClearance: number = Number.POSITIVE_INFINITY;
  let excessiveClearance: number = 0;
  let nearCollisionCount: number = 0;
  let obstacleIntersections: number = 0;
  let forbiddenObstacleIntersections: number = 0;
  const forbiddenObstacleIds: Set<string> = new Set<string>();
  let staffLineInteraction: number = 0;
  const permitsInStaff: boolean = isUnobstructedCompactCurve(
    context,
    geometry.p0,
    geometry.p3,
  );
  const endpointEnvelopeFraction: number = Math.abs(geometry.p3.x - geometry.p0.x) < 10 ? 0.28 : 0.16;
  for (let index: number = 1; index < count; index++) {
    const t: number = index / count;
    const point: PointF2D = pointOnSlurCurve(geometry, t);
    const envelopeIndex: number = Math.max(
      0,
      Math.min(
        context.envelope.skyline.length - 1,
        Math.round(point.x * context.envelope.samplingUnit),
      ),
    );
    const envelopeValue: number =
      context.direction === PlacementEnum.Above
        ? context.envelope.skyline[envelopeIndex]
        : context.envelope.bottomline[envelopeIndex];
    const insideStartAttachment: boolean = context.start.notehead
      ? point.x <= context.start.notehead.right + options.obstacleClearance
      : false;
    const insideEndAttachment: boolean = context.end.notehead
      ? point.x >= context.end.notehead.left - options.obstacleClearance
      : false;
    const interiorSample: boolean =
      t > endpointEnvelopeFraction &&
      t < 1 - endpointEnvelopeFraction &&
      !insideStartAttachment &&
      !insideEndAttachment;
    if (
      Number.isFinite(envelopeValue) &&
      interiorSample &&
      !permitsInStaff
    ) {
      const clearance: number =
        context.direction === PlacementEnum.Above
          ? envelopeValue - point.y
          : point.y - envelopeValue;
      minimumClearance = Math.min(minimumClearance, clearance);
      maximumPenetration = Math.max(maximumPenetration, options.obstacleClearance - clearance);
      if (clearance < options.obstacleClearance * 1.5) {
        nearCollisionCount += 1;
      }
      excessiveClearance += Math.max(0, clearance - options.maximumPreferredClearance) / count;
    }
    if (interiorSample && !permitsInStaff) {
      if (context.direction === PlacementEnum.Above) {
        staffLineInteraction += Math.max(0, point.y - context.envelope.topLineOffset + 0.1) / count;
      } else {
        staffLineInteraction +=
          Math.max(0, context.envelope.bottomLineOffset - point.y + 0.1) / count;
      }
    }
    for (const obstacle of context.obstacles) {
      const endpointClearance: number = Math.max(obstacle.clearance, 0.08);
      if (isInsideEndpointAttachmentZone(
        context,
        geometry,
        obstacle,
        point,
        endpointClearance,
      )) {
        continue;
      }
      if (obstacle.curve) {
        const obstacleWidth: number = obstacle.curve.p3.x - obstacle.curve.p0.x;
        if (
          Math.abs(obstacleWidth) > 0.0001 &&
          point.x >= obstacle.curve.p0.x &&
          point.x <= obstacle.curve.p3.x
        ) {
          const obstaclePoint: PointF2D = pointOnSlurCurve(
            obstacle.curve,
            (point.x - obstacle.curve.p0.x) / obstacleWidth,
          );
          if (
            Math.hypot(point.x - obstaclePoint.x, point.y - obstaclePoint.y) <
            Math.max(obstacle.clearance, 0.12)
          ) {
            obstacleIntersections += 1;
            if (isForbiddenObstacle(obstacle)) {
              forbiddenObstacleIntersections += 1;
              forbiddenObstacleIds.add(obstacle.id);
            }
          }
        }
        continue;
      }
      const obstacleClearance: number = Math.max(obstacle.clearance, 0.08);
      const intersectsObstacle: boolean = obstacle.polygon
        ? polygonContainsWithClearance(obstacle.polygon, point, obstacleClearance)
        : boundsContain(obstacle.bounds, point, obstacleClearance);
      if (intersectsObstacle) {
        obstacleIntersections += 1;
        if (isForbiddenObstacle(obstacle)) {
          forbiddenObstacleIntersections += 1;
          forbiddenObstacleIds.add(obstacle.id);
        }
      }
    }
  }
  // Uniform samples are intentionally bounded for performance, but a stem can
  // be much narrower than the resulting interval. Probe every hard obstacle at
  // its own horizontal edges and centre so a curve cannot pass through a thin
  // internal stem between two otherwise clear samples.
  for (const obstacle of context.obstacles) {
    if (!isForbiddenObstacle(obstacle) || obstacle.curve || forbiddenObstacleIds.has(obstacle.id)) {
      continue;
    }
    const obstacleClearance: number = Math.max(obstacle.clearance, 0.08);
    const left: number = Math.max(geometry.p0.x, obstacle.bounds.left - obstacleClearance);
    const right: number = Math.min(geometry.p3.x, obstacle.bounds.right + obstacleClearance);
    if (right <= left) {
      continue;
    }
    const probeXs: number[] = [left, (left + right) / 2, right];
    const intersectsObstacle: boolean = probeXs.some((x: number): boolean => {
      const point: PointF2D = pointOnSlurCurve(geometry, curveParameterAtX(geometry, x));
      if (isInsideEndpointAttachmentZone(context, geometry, obstacle, point, obstacleClearance)) {
        return false;
      }
      return obstacle.polygon
        ? polygonContainsWithClearance(obstacle.polygon, point, obstacleClearance)
        : boundsContain(obstacle.bounds, point, obstacleClearance);
    });
    if (intersectsObstacle) {
      obstacleIntersections += 1;
      forbiddenObstacleIntersections += 1;
      forbiddenObstacleIds.add(obstacle.id);
    }
  }
  return {
    maximumPenetration,
    minimumClearance: Number.isFinite(minimumClearance)
      ? minimumClearance
      : options.obstacleClearance,
    nearCollisionCount,
    obstacleIntersections,
    forbiddenObstacleIntersections,
    forbiddenObstacleIds: [...forbiddenObstacleIds],
    excessiveClearance,
    staffLineInteraction,
  };
}

function scoreCandidate(
  context: SlurLayoutContext,
  candidate: SlurCurveCandidate,
  options: SlurCandidateLayoutOptions,
): SlurCandidateScore {
  const evaluation: EvaluatedGeometry = evaluateGeometry(context, candidate.geometry, options);
  const startSlope: number = Math.abs(
    (candidate.geometry.p1.y - candidate.geometry.p0.y) /
      Math.max(0.001, candidate.geometry.p1.x - candidate.geometry.p0.x),
  );
  const endSlope: number = Math.abs(
    (candidate.geometry.p3.y - candidate.geometry.p2.y) /
      Math.max(0.001, candidate.geometry.p3.x - candidate.geometry.p2.x),
  );
  const midpoint: PointF2D = pointOnSlurCurve(candidate.geometry, 0.5);
  const baselineMidpoint: number = (candidate.geometry.p0.y + candidate.geometry.p3.y) / 2;
  const expectedDirection: number = context.direction === PlacementEnum.Above ? -1 : 1;
  const wrongDirectionContour: number = Math.max(
    0,
    -(midpoint.y - baselineMidpoint) * expectedDirection,
  );
  const targetApexRatio: number = contourPressureRatio(
    context,
    candidate.geometry.p0,
    candidate.geometry.p3,
  );
  const contour: number = wrongDirectionContour +
    Math.abs(curveApexRatio(context, candidate.geometry) - targetApexRatio) * 4;
  const phraseSlope: number = Math.abs(
    (candidate.geometry.p3.y - candidate.geometry.p0.y) /
      Math.max(0.001, candidate.geometry.p3.x - candidate.geometry.p0.x),
  );
  const acuteNoteheadPenalty: (anchor: SlurAnchorCandidate) => number =
    (anchor): number => {
      if (anchor.type === "notehead-center") {
        const endpoint: SlurEndpointContext = anchor.side === "start" ? context.start : context.end;
        // The placement-side outer head is already selected for a chord. A
        // shallow chord phrase can still leave that head more cleanly from its
        // shoulder, but single-note crowns must not receive this blanket cost.
        return endpoint.chordSize > 1 && phraseSlope < 0.65 ? 0.5 : 0;
      }
      if (phraseSlope <= 0.65) {
        return 0;
      }
      if (!["notehead", "notehead-shoulder", "outer-head"].includes(anchor.type)) {
        return 0;
      }
      // A steep tangent reads more cleanly at the notehead crown than at a
      // lateral shoulder. This remains a small preference: exact stems,
      // beams, articulations, and collision clearance still dominate.
      return Math.min(0.18, (phraseSlope - 0.65) * 0.12);
    };
  const anchorDisplacement: number =
    candidate.startAnchor.penalties.displacement +
    candidate.endAnchor.penalties.displacement +
    candidate.startAnchor.penalties.stemRelationship +
    candidate.endAnchor.penalties.stemRelationship +
    acuteNoteheadPenalty(candidate.startAnchor) +
    acuteNoteheadPenalty(candidate.endAnchor);
  const semanticEndpointPenalty: (anchor: SlurAnchorCandidate) => number =
    (anchor): number => {
      const endpoint: SlurEndpointContext = anchor.side === "start" ? context.start : context.end;
      let penalty: number = 0;
      const phraseWidth: number = Math.abs(
        context.end.seedAnchor.x - context.start.seedAnchor.x,
      );
      if (anchor.type === "stem-tip" && endpoint.chordSize > 1 && phraseWidth >= 10) {
        penalty += 2.25;
      }
      if (anchor.type === "beam-side" && !context.sharedEndpointBeam && !context.isCrossStaff) {
        penalty += 0.45;
      }
      if (
        anchor.side === "end" &&
        context.isCrossSystem &&
        context.start.systemBoundary &&
        (anchor.type === "beam-side" || anchor.type === "stem-tip")
      ) {
        // A continuation returning on a new system cannot reconnect visually
        // to the originating beam. Prefer the destination notehead so a local
        // beam or stem does not pull the returning segment into a steep hook.
        penalty += 5;
      }
      const hasEndpointLedger: boolean = endpointLedgerLinesOnSlurSide(
        context,
        endpoint,
        anchor.side,
      ).length > 0;
      if (hasEndpointLedger) {
        penalty += ["notehead", "notehead-center"].includes(anchor.type) ? 5
          : anchor.type === "outer-head" ? 2
            : 0;
      }
      return penalty;
    };
  const semanticAttachment: number =
    semanticEndpointPenalty(candidate.startAnchor) + semanticEndpointPenalty(candidate.endAnchor);
  const articulation: number =
    candidate.startAnchor.penalties.articulationRelationship +
    candidate.endAnchor.penalties.articulationRelationship;
  const tieInteraction: number =
    candidate.startAnchor.penalties.tieConflict + candidate.endAnchor.penalties.tieConflict;
  const tangent: number = Math.max(0, startSlope - 1.25) + Math.max(0, endSlope - 1.25);
  const slope: number = Math.max(0, startSlope - 2.5) + Math.max(0, endSlope - 2.5);
  const startControlRun: number = Math.abs(candidate.geometry.p1.x - candidate.geometry.p0.x);
  const endControlRun: number = Math.abs(candidate.geometry.p3.x - candidate.geometry.p2.x);
  const controlRunImbalance: number = Math.abs(startControlRun - endControlRun) /
    Math.max(0.001, Math.abs(candidate.geometry.p3.x - candidate.geometry.p0.x));
  const contourImbalanceAllowance: number = 0.08 + Math.abs(targetApexRatio - 0.5) * 1.25;
  const unjustifiedControlImbalance: number = Math.max(
    0,
    controlRunImbalance - contourImbalanceAllowance,
  );
  // Strongly unequal control arms make one endpoint read as a hook. Permit
  // that asymmetry when the measured obstacle contour asks for it, otherwise
  // prefer the balanced family even if the hook has marginally more clearance.
  const curvature: number = Math.abs(startSlope - endSlope) * 0.08 +
    unjustifiedControlImbalance * 16;
  const boundarySlopeMismatch: (
    anchor: SlurAnchorCandidate,
    endpoint: PointF2D,
    control: PointF2D,
  ) => number = (anchor, endpoint, control): number => {
    const actual: number = (control.y - endpoint.y) /
      Math.max(0.001, control.x - endpoint.x);
    return Math.abs(actual - (anchor.preferredTangent ?? 0));
  };
  const systemContinuity: number =
    (context.start.systemBoundary
      ? boundarySlopeMismatch(candidate.startAnchor, candidate.geometry.p0, candidate.geometry.p1)
      : 0) +
    (context.end.systemBoundary
      ? boundarySlopeMismatch(candidate.endAnchor, candidate.geometry.p3, candidate.geometry.p2)
      : 0);
  const clearance: number =
    Math.max(0, options.obstacleClearance - evaluation.minimumClearance) +
    Math.max(0, evaluation.maximumPenetration) * 0.35;
  const weights: SlurCandidateScoreWeights = options.scoreWeights;
  const score: SlurCandidateScore = {
    total: 0,
    collision: evaluation.forbiddenObstacleIntersections,
    clearance,
    excessiveClearance: evaluation.excessiveClearance,
    anchorDisplacement: anchorDisplacement + semanticAttachment,
    tangent,
    slope,
    curvature,
    contour,
    articulation,
    tieInteraction,
    staffLineInteraction: evaluation.staffLineInteraction,
    nesting: context.isNested ? evaluation.nearCollisionCount * 0.01 : 0,
    systemContinuity,
    nearCollisionCount: evaluation.nearCollisionCount,
  };
  score.total =
    score.collision * 10000 +
    score.clearance * weights.clearance +
    score.excessiveClearance * weights.excessiveClearance +
    score.anchorDisplacement * weights.anchorDisplacement +
    score.tangent * weights.tangent +
    score.slope * weights.slope +
    score.curvature * weights.curvature +
    score.contour * weights.contour +
    score.articulation * weights.articulation +
    score.tieInteraction * weights.tieInteraction +
    score.staffLineInteraction * weights.staffLineInteraction +
    score.nesting * weights.nesting +
    score.systemContinuity * weights.systemContinuity;
  return score;
}

function keepsDurationArticulationsInside(
  candidate: SlurCurveCandidate,
  context: SlurLayoutContext,
  clearance: number,
): boolean {
  const expectedPosition: number = context.direction === PlacementEnum.Above ? 3 : 4;
  for (const endpoint of [context.start, context.end]) {
    const articulations: SlurArticulationContext[] = endpoint.articulations.filter(
      (articulation): boolean =>
        articulation.classification === "duration" &&
        articulation.position === expectedPosition,
    );
    if (articulations.length === 0) {
      continue;
    }
    const point: PointF2D = endpoint.side === "start"
      ? candidate.geometry.p0
      : candidate.geometry.p3;
    const clearsArticulations: boolean = context.direction === PlacementEnum.Above
      ? point.y <= Math.min(...articulations.map((articulation): number => articulation.bounds.top))
        - clearance
      : point.y >= Math.max(...articulations.map((articulation): number => articulation.bounds.bottom))
        + clearance;
    if (!clearsArticulations) {
      return false;
    }
  }
  return true;
}

function rejectionReason(
  candidate: SlurCurveCandidate,
  context: SlurLayoutContext,
  options: SlurCandidateLayoutOptions,
): string | undefined {
  const { p0, p1, p2, p3 } = candidate.geometry;
  if (![p0, p1, p2, p3].every(finitePoint)) {
    return "non-finite";
  }
  if (p3.x <= p0.x + 0.0001) {
    return "reversed";
  }
  if (p1.x < p0.x || p2.x < p1.x || p2.x > p3.x) {
    return "looping";
  }
  let positiveCurvature: boolean = false;
  let negativeCurvature: boolean = false;
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const inverse: number = 1 - t;
    const dx: number =
      3 * inverse * inverse * (p1.x - p0.x) +
      6 * inverse * t * (p2.x - p1.x) +
      3 * t * t * (p3.x - p2.x);
    const dy: number =
      3 * inverse * inverse * (p1.y - p0.y) +
      6 * inverse * t * (p2.y - p1.y) +
      3 * t * t * (p3.y - p2.y);
    const ddx: number = 6 * inverse * (p2.x - 2 * p1.x + p0.x) + 6 * t * (p3.x - 2 * p2.x + p1.x);
    const ddy: number = 6 * inverse * (p2.y - 2 * p1.y + p0.y) + 6 * t * (p3.y - 2 * p2.y + p1.y);
    const cross: number = dx * ddy - dy * ddx;
    positiveCurvature = positiveCurvature || cross > 0.0001;
    negativeCurvature = negativeCurvature || cross < -0.0001;
  }
  if (positiveCurvature && negativeCurvature) {
    return "inflected";
  }
  const startSlope: number = Math.abs((p1.y - p0.y) / Math.max(0.001, p1.x - p0.x));
  const endSlope: number = Math.abs((p3.y - p2.y) / Math.max(0.001, p3.x - p2.x));
  const maximumSlope: number = context.start.systemBoundary
    || context.end.systemBoundary
    || candidate.family === "high"
    ? 12
    : 5.6713;
  if (startSlope > maximumSlope || endSlope > maximumSlope) {
    return "excessively-steep";
  }
  if (!keepsDurationArticulationsInside(candidate, context, options.obstacleClearance)) {
    return "duration-articulation-outside-slur";
  }
  return undefined;
}

function semanticArticulationAdjustments(
  context: SlurLayoutContext,
  geometry: SlurCurveGeometry,
  clearance: number,
): SlurArticulationAdjustment[] {
  const adjustments: SlurArticulationAdjustment[] = [];
  for (const endpoint of [context.start, context.end]) {
    const t: number = endpoint.side === "start" ? 0.045 : 0.955;
    const curvePoint: PointF2D = pointOnSlurCurve(geometry, t);
    const expectedPosition: number = context.direction === PlacementEnum.Above ? 3 : 4;
    for (const articulation of endpoint.articulations) {
      if (
        articulation.position !== expectedPosition ||
        !["force", "stress"].includes(articulation.classification)
      ) {
        continue;
      }
      const missingClearance: number =
        context.direction === PlacementEnum.Above
          ? articulation.bounds.bottom - (curvePoint.y - clearance)
          : curvePoint.y + clearance - articulation.bounds.top;
      adjustments.push({
        articulationId: articulation.id,
        outwardShift: articulation.outwardShift + Math.max(0, missingClearance * 10),
      });
    }
  }
  return adjustments;
}

export function createSkylineUpdates(
  context: SlurLayoutContext,
  geometry: SlurCurveGeometry,
): { skylineUpdates: SlurSkylineUpdate[], bottomlineUpdates: SlurSkylineUpdate[] } {
  const skyline: Map<number, number> = new Map<number, number>();
  const bottomline: Map<number, number> = new Map<number, number>();
  const count: number = sampleCount(geometry);
  const length: number =
    context.direction === PlacementEnum.Above
      ? context.envelope.skyline.length
      : context.envelope.bottomline.length;
  for (let index: number = 0; index <= count; index++) {
    const point: PointF2D = pointOnSlurCurve(geometry, index / count);
    const left: number = Math.max(
      0,
      Math.min(length - 1, Math.floor(point.x * context.envelope.samplingUnit)),
    );
    for (const target of [left, left + 1]) {
      if (target < 0 || target >= length) {
        continue;
      }
      if (context.direction === PlacementEnum.Above) {
        skyline.set(target, Math.min(skyline.get(target) ?? Number.POSITIVE_INFINITY, point.y));
      } else {
        bottomline.set(
          target,
          Math.max(bottomline.get(target) ?? Number.NEGATIVE_INFINITY, point.y),
        );
      }
    }
  }
  return {
    skylineUpdates: [...skyline].map(([index, value]) => ({ index, value })),
    bottomlineUpdates: [...bottomline].map(([index, value]) => ({ index, value })),
  };
}

export function calculateCandidateSlurLayout(
  context: SlurLayoutContext,
  seed: SlurCurveGeometry,
  options: SlurCandidateLayoutOptions,
): SlurLayoutResult {
  const anchors: { start: SlurAnchorCandidate[], end: SlurAnchorCandidate[] } = generateSlurAnchors(
    context,
    seed,
    options.obstacleClearance,
  );
  const candidates: SlurCurveCandidate[] = [];
  let generationIndex: number = 0;
  const anchorPairs: {start: SlurAnchorCandidate, end: SlurAnchorCandidate}[] =
    anchors.start.flatMap((start): {start: SlurAnchorCandidate, end: SlurAnchorCandidate}[] =>
      anchors.end.map((end): {start: SlurAnchorCandidate, end: SlurAnchorCandidate} => ({start, end})),
    ).sort((left, right): number => {
      const penalty: (pair: {start: SlurAnchorCandidate, end: SlurAnchorCandidate}) => number =
        (pair): number =>
          pair.start.penalties.displacement + pair.end.penalties.displacement +
          pair.start.penalties.stemRelationship + pair.end.penalties.stemRelationship +
          pair.start.penalties.articulationRelationship * 2 +
          pair.end.penalties.articulationRelationship * 2 +
          pair.start.penalties.tieConflict * 2 + pair.end.penalties.tieConflict * 2;
      return penalty(left) - penalty(right)
      || Math.min(left.start.generationIndex, left.end.generationIndex)
        - Math.min(right.start.generationIndex, right.end.generationIndex)
      || left.start.generationIndex - right.start.generationIndex
      || left.end.generationIndex - right.end.generationIndex;
    });
  outer: for (const pair of anchorPairs) {
    const startAnchor: SlurAnchorCandidate = pair.start;
    const endAnchor: SlurAnchorCandidate = pair.end;
      const unobstructedCompactCurve: boolean = isUnobstructedCompactCurve(
        context,
        startAnchor,
        endAnchor,
      );
      for (const family of curveFamilies) {
        const anchorWidth: number = Math.abs(endAnchor.x - startAnchor.x);
        if (
          (family === "shallow" && anchorWidth < 10) ||
          (family === "flattened-long" && anchorWidth < 14)
        ) {
          // These families are optical reductions for genuinely broad
          // phrases. On compact and cross-staff gestures they make the slur
          // read as a loose diagonal or an under-curved tie.
          continue;
        }
        if (
          unobstructedCompactCurve &&
          (family === "start-weighted" || family === "end-weighted")
        ) {
          // Weighted families deliberately bias the crown toward notation
          // pressure. With no internal obstacle, that bias only turns a short
          // two-note slur into an oversized, skewed hook.
          continue;
        }
        if (
          family === "system-continuation" &&
          !context.start.systemBoundary &&
          !context.end.systemBoundary
        ) {
          continue;
        }
        if (generationIndex >= Math.max(1, options.candidateLimit)) {
          break outer;
        }
        const candidate: SlurCurveCandidate = {
          id: `${context.id}-${family}-${generationIndex}`,
          startAnchor,
          endAnchor,
          geometry: familyGeometry(seed, startAnchor, endAnchor, family, context),
          family,
          rejected: false,
          generationIndex,
          articulationAdjustments: [],
        };
        candidate.rejectionReason = rejectionReason(candidate, context, options);
        if (!candidate.rejectionReason) {
          const evaluation: EvaluatedGeometry = evaluateGeometry(context, candidate.geometry, options);
          if (evaluation.forbiddenObstacleIntersections > 0) {
            candidate.rejectionReason = "obstacle-intersection";
            candidate.rejectionObstacleIds = evaluation.forbiddenObstacleIds;
          }
        }
        candidate.rejected = Boolean(candidate.rejectionReason);
        if (!candidate.rejected) {
          candidate.score = scoreCandidate(context, candidate, options);
        }
        candidates.push(candidate);
        generationIndex += 1;
      }
  }
  const survivors: SlurCurveCandidate[] = candidates.filter((candidate) => !candidate.rejected);
  survivors.sort(
    (left, right) =>
      (left.score?.total ?? Number.POSITIVE_INFINITY) -
        (right.score?.total ?? Number.POSITIVE_INFINITY) ||
      (left.score?.nearCollisionCount ?? Number.MAX_SAFE_INTEGER) -
        (right.score?.nearCollisionCount ?? Number.MAX_SAFE_INTEGER) ||
      (left.score?.anchorDisplacement ?? Number.POSITIVE_INFINITY) -
        (right.score?.anchorDisplacement ?? Number.POSITIVE_INFINITY) ||
      Number(left.family !== "normal") - Number(right.family !== "normal") ||
      left.generationIndex - right.generationIndex,
  );
  const selected: SlurCurveCandidate = survivors[0] ?? candidates[0];
  const geometry: SlurCurveGeometry = cloneGeometry(selected?.geometry ?? seed);
  const articulationAdjustments: SlurArticulationAdjustment[] = semanticArticulationAdjustments(
    context,
    geometry,
    options.obstacleClearance,
  );
  if (selected) {
    selected.articulationAdjustments = articulationAdjustments;
  }
  const updates: { skylineUpdates: SlurSkylineUpdate[], bottomlineUpdates: SlurSkylineUpdate[] } =
    createSkylineUpdates(context, geometry);
  const retainedCandidates: readonly SlurCurveCandidate[] =
    options.diagnosticsLevel === "candidates" ? candidates : selected ? [selected] : [];
  return {
    geometry,
    selectedCandidateId: selected?.id ?? `${context.id}-seed`,
    family: selected?.family ?? "normal",
    candidates: retainedCandidates,
    articulationAdjustments,
    skylineUpdates: updates.skylineUpdates,
    bottomlineUpdates: updates.bottomlineUpdates,
  };
}

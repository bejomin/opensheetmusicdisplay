import { expect } from "chai";
import { PointF2D } from "../../../src/Common/DataObjects/PointF2D";
import { PlacementEnum } from "../../../src/MusicalScore/VoiceData/Expressions/AbstractExpression";
import { SlurCandidateLayoutOptions } from
  "../../../src/MusicalScore/Graphical/SlurLayout/SlurCandidateLayoutEngine";
import {
  calculateLinkedSlurLayouts,
  SlurLinkedLayoutInput,
  SlurLinkedLayoutOutput,
} from "../../../src/MusicalScore/Graphical/SlurLayout/SlurLinkedLayoutEngine";
import {
  SlurCurveCandidate,
  SlurCurveGeometry,
  SlurContinuationBoundaryTarget,
  SlurEndpointContext,
  SlurLayoutContext,
} from "../../../src/MusicalScore/Graphical/SlurLayout/SlurLayoutTypes";

const options: SlurCandidateLayoutOptions = {
  candidateLimit: 96,
  diagnosticsLevel: "candidates",
  maximumPreferredClearance: 2.5,
  obstacleClearance: 0.35,
  scoreWeights: {
    clearance: 40,
    excessiveClearance: 4,
    anchorDisplacement: 12,
    tangent: 10,
    slope: 8,
    curvature: 8,
    contour: 2,
    articulation: 24,
    tieInteraction: 24,
    staffLineInteraction: 12,
    nesting: 30,
    systemContinuity: 20,
  },
};

function endpoint(side: "start" | "end", x: number, boundary: boolean): SlurEndpointContext {
  return {
    side,
    present: !boundary,
    notehead: boundary ? undefined : {left: x - 0.5, right: x + 0.5, top: 1.5, bottom: 2.5},
    stemSide: false,
    beams: [],
    accidentals: [],
    articulations: [],
    seedAnchor: new PointF2D(x, boundary ? -1 : 1.2),
    seedAttachment: boundary ? "system-edge" : "notehead",
    tiedEndpoint: false,
    chordSize: boundary ? 0 : 1,
    polyphonic: false,
    grace: false,
    systemBoundary: boundary,
  };
}

function input(
  segmentIndex: number,
  startBoundary: boolean,
  endBoundary: boolean,
  direction: PlacementEnum = PlacementEnum.Above,
): SlurLinkedLayoutInput {
  const start: SlurEndpointContext = endpoint("start", 2, startBoundary);
  const end: SlurEndpointContext = endpoint("end", 18, endBoundary);
  const context: SlurLayoutContext = {
    id: `linked-${segmentIndex}`,
    linkedGroupId: "linked-unit",
    direction,
    start,
    end,
    obstacles: [],
    envelope: {
      samplingUnit: 10,
      skyline: Array(201).fill(-0.8 - segmentIndex * 0.2),
      bottomline: Array(201).fill(4.8 + segmentIndex * 0.2),
      topLineOffset: 0,
      bottomLineOffset: 4,
      width: 20,
    },
    segmentIndex,
    segmentCount: 2,
    isCrossStaff: false,
    isCrossSystem: true,
    isNested: false,
  };
  return {
    context,
    seed: {
      p0: new PointF2D(start.seedAnchor.x, start.seedAnchor.y),
      p1: new PointF2D(6, -2.5),
      p2: new PointF2D(14, -2.5),
      p3: new PointF2D(end.seedAnchor.x, end.seedAnchor.y),
    },
  };
}

describe("linked slur layout engine", (): void => {
  it("uses one continuation trajectory and matching break tangents", (): void => {
    const output: SlurLinkedLayoutOutput = calculateLinkedSlurLayouts(
      [input(0, false, true), input(1, true, false)],
      options,
    );
    const first: SlurCurveGeometry = output.results[0].geometry;
    const second: SlurCurveGeometry = output.results[1].geometry;

    expect(output.diagnostics.continuationClearance).to.be.greaterThan(1.2);
    expect(first.p3.y).to.be.closeTo(second.p0.y, 0.1);
    expect(output.diagnostics.continuationSlope).to.equal(0);
    expect(first.p2.y).to.be.closeTo(first.p3.y, 1e-9);
    expect(second.p1.y).to.be.closeTo(second.p0.y, 1e-9);
    expect(output.diagnostics.tangentMismatch).to.equal(0);
    expect(output.results.every((result) =>
      !result.candidates.find((candidate) => candidate.id === result.selectedCandidateId)?.rejected,
    )).to.equal(true);
  });

  it("keeps a middle continuation segment finite and horizontal", (): void => {
    const middle: SlurLinkedLayoutInput = input(0, true, true);
    middle.context.segmentCount = 1;
    const output: SlurLinkedLayoutOutput = calculateLinkedSlurLayouts([middle], options);
    const geometry: SlurCurveGeometry = output.results[0].geometry;

    expect(geometry.p0.y).to.equal(geometry.p1.y);
    expect(geometry.p2.y).to.equal(geometry.p3.y);
    expect([geometry.p0, geometry.p1, geometry.p2, geometry.p3].every(
      (point): boolean => Number.isFinite(point.x) && Number.isFinite(point.y),
    )).to.equal(true);
  });

  it("bounds continuation travel when a real note sits close to the system edge", (): void => {
    const first: SlurLinkedLayoutInput = input(0, false, true);
    const second: SlurLinkedLayoutInput = input(1, true, false);
    first.context.start.seedAnchor.x = 15;
    first.context.start.notehead = {left: 14.5, right: 15.5, top: 1.5, bottom: 2.5};
    first.seed.p0.x = 15;
    second.context.end.seedAnchor.x = 5;
    second.context.end.notehead = {left: 4.5, right: 5.5, top: 1.5, bottom: 2.5};
    second.seed.p3.x = 5;

    const output: SlurLinkedLayoutOutput = calculateLinkedSlurLayouts([first, second], options);
    const opening: SlurCurveGeometry = output.results[0].geometry;
    const returning: SlurCurveGeometry = output.results[1].geometry;

    expect(Math.abs(opening.p3.y - first.context.start.seedAnchor.y)).to.be.lessThan(1.5);
    expect(Math.abs(returning.p0.y - second.context.end.seedAnchor.y)).to.be.lessThan(1.5);
    expect(opening.p2.y).to.equal(opening.p3.y);
    expect(returning.p1.y).to.equal(returning.p0.y);
    expect(output.diagnostics.boundaryTargets).to.have.length(2);
  });

  it("uses one relative clearance on both sides of a same-staff system break", (): void => {
    const first: SlurLinkedLayoutInput = input(0, false, true, PlacementEnum.Below);
    const second: SlurLinkedLayoutInput = input(1, true, false, PlacementEnum.Below);
    first.context.envelope.bottomline = Array(201).fill(8.2);
    second.context.envelope.bottomline = Array(201).fill(5.1);
    second.context.end.articulations = [{
      id: "tenuto",
      glyphType: "a-",
      classification: "duration",
      position: 4,
      bounds: {left: 17.7, right: 18.3, top: 2.8, bottom: 3.15},
      outwardShift: 0,
    }];

    const output: SlurLinkedLayoutOutput = calculateLinkedSlurLayouts([first, second], options);
    const outgoingTarget: SlurContinuationBoundaryTarget = output.diagnostics.boundaryTargets.find(
      (target): boolean => target.segmentIndex === 0 && target.side === "end",
    );
    const returningTarget: SlurContinuationBoundaryTarget = output.diagnostics.boundaryTargets.find(
      (target): boolean => target.segmentIndex === 1 && target.side === "start",
    );

    expect(returningTarget.effectiveClearance).to.equal(outgoingTarget.effectiveClearance);
    expect(output.results[0].geometry.p3.y - first.context.envelope.bottomLineOffset)
      .to.equal(outgoingTarget.effectiveClearance);
    expect(output.results[1].geometry.p0.y - second.context.envelope.bottomLineOffset)
      .to.equal(returningTarget.effectiveClearance);
  });

  it("bases a returning cross-staff boundary on the destination notehead", (): void => {
    const first: SlurLinkedLayoutInput = input(0, false, true);
    const second: SlurLinkedLayoutInput = input(1, true, false);
    second.context.isCrossStaff = true;
    second.context.isCrossSystem = true;
    second.context.end.seedAnchor.y = 6;
    second.context.end.notehead = {left: 17.5, right: 18.5, top: 1.5, bottom: 2.5};
    second.seed.p3.y = 6;

    const output: SlurLinkedLayoutOutput = calculateLinkedSlurLayouts([first, second], options);
    const returningTarget: number = output.diagnostics.boundaryTargets.find(
      (target): boolean => target.segmentIndex === 1 && target.side === "start",
    ).target;

    expect(returningTarget).to.be.lessThan(3);
    expect(Math.abs(returningTarget - 1.15)).to.be.lessThan(Math.abs(returningTarget - 6));
  });

  it("points both cross-staff fragments along the complete rising phrase", (): void => {
    const first: SlurLinkedLayoutInput = input(0, false, true);
    const second: SlurLinkedLayoutInput = input(1, true, false);
    first.context.isCrossStaff = true;
    second.context.isCrossStaff = true;
    first.staffOffsetY = 8;
    second.staffOffsetY = 0;

    const output: SlurLinkedLayoutOutput = calculateLinkedSlurLayouts([first, second], options);
    const opening: SlurCurveGeometry = output.results[0].geometry;
    const returning: SlurCurveGeometry = output.results[1].geometry;

    expect(output.diagnostics.sourceSemanticHeight)
      .to.be.greaterThan(output.diagnostics.destinationSemanticHeight);
    expect(output.diagnostics.continuationSlope).to.be.lessThan(0);
    expect(opening.p3.y).to.be.lessThan(opening.p0.y);
    expect(returning.p0.y).to.be.greaterThan(returning.p3.y);
    expect(opening.p3.y - opening.p2.y).to.be.lessThan(0);
    expect(returning.p1.y - returning.p0.y).to.be.lessThan(0);
    expect(output.diagnostics.boundaryTargets.every(
      (target): boolean => target.tangent < 0 && Number.isFinite(target.projectedTarget),
    )).to.equal(true);
  });

  it("uses endpoint pitches when cross-system coordinate frames disagree", (): void => {
    const first: SlurLinkedLayoutInput = input(0, false, true);
    const second: SlurLinkedLayoutInput = input(1, true, false);
    first.sourcePitchHalfTone = 36;
    first.destinationPitchHalfTone = 55;
    second.sourcePitchHalfTone = 36;
    second.destinationPitchHalfTone = 55;
    first.staffOffsetY = 0;
    second.staffOffsetY = 0.2;

    const output: SlurLinkedLayoutOutput = calculateLinkedSlurLayouts([first, second], options);
    const opening: SlurCurveGeometry = output.results[0].geometry;
    const returning: SlurCurveGeometry = output.results[1].geometry;

    expect(output.diagnostics.sourceSemanticHeight)
      .to.be.greaterThan(output.diagnostics.destinationSemanticHeight);
    expect(output.diagnostics.continuationSlope).to.be.lessThan(0);
    expect(opening.p3.y).to.be.lessThan(opening.p0.y);
    expect(returning.p0.y).to.be.greaterThan(returning.p3.y);
  });

  it("keeps a short return close to its destination instead of making a steep hook", (): void => {
    const first: SlurLinkedLayoutInput = input(0, false, true);
    const second: SlurLinkedLayoutInput = input(1, true, false);
    second.context.end.seedAnchor.x = 3.6;
    second.context.end.notehead = {left: 3.1, right: 4.1, top: 1.5, bottom: 2.5};
    second.seed.p3.x = 3.6;

    const output: SlurLinkedLayoutOutput = calculateLinkedSlurLayouts([first, second], options);
    const returning: SlurCurveGeometry = output.results[1].geometry;

    expect(Math.abs(returning.p0.y - 1.15)).to.be.lessThan(0.9);
    expect(Math.abs((returning.p1.y - returning.p0.y) /
      (returning.p1.x - returning.p0.x))).to.be.lessThan(0.1);
  });

  it("returns from outside a duration articulation into the endpoint", (): void => {
    const first: SlurLinkedLayoutInput = input(0, false, true, PlacementEnum.Below);
    const second: SlurLinkedLayoutInput = input(1, true, false, PlacementEnum.Below);
    second.context.end.articulations = [{
      id: "tenuto",
      glyphType: "a-",
      classification: "duration",
      position: 4,
      bounds: {left: 17.7, right: 18.3, top: 2.8, bottom: 3.15},
      outwardShift: 0,
    }];

    const output: SlurLinkedLayoutOutput = calculateLinkedSlurLayouts([first, second], options);
    const returning: SlurCurveGeometry = output.results[1].geometry;
    const selected: SlurCurveCandidate = output.results[1].candidates.find(
      (candidate): boolean => candidate.id === output.results[1].selectedCandidateId,
    );

    expect(selected.endAnchor.type).to.equal("outside-articulation");
    expect(returning.p2.y).to.be.greaterThan(returning.p3.y);
  });

  it("relaxes an infeasible outgoing tangent instead of inflecting the fragment", (): void => {
    const first: SlurLinkedLayoutInput = input(0, false, true);
    const second: SlurLinkedLayoutInput = input(1, true, false);
    first.context.start.seedAnchor.y = 1.2;
    first.seed.p0.y = 1.2;
    second.context.end.seedAnchor.y = -2;
    second.context.end.notehead = {left: 17.5, right: 18.5, top: -2.5, bottom: -1.5};
    second.seed.p3.y = -2;

    const output: SlurLinkedLayoutOutput = calculateLinkedSlurLayouts([first, second], options);
    const opening: SlurCurveGeometry = output.results[0].geometry;
    const openingTarget: SlurContinuationBoundaryTarget = output.diagnostics.boundaryTargets.find(
      (target): boolean => target.segmentIndex === 0 && target.side === "end",
    );
    const localChordSlope: number = (opening.p3.y - opening.p0.y) /
      (opening.p3.x - opening.p0.x);

    expect(openingTarget.tangent).to.be.at.least(localChordSlope - 1e-9);
    expect(opening.p3.y - opening.p2.y).to.be.at.least(
      localChordSlope * (opening.p3.x - opening.p2.x) - 1e-9,
    );
    expect(output.results[0].candidates.find(
      (candidate): boolean => candidate.id === output.results[0].selectedCandidateId,
    )?.rejectionReason).not.to.equal("inflected");
  });

  it("reports incompatible linked placement as a structured fault", (): void => {
    const output: SlurLinkedLayoutOutput = calculateLinkedSlurLayouts(
      [input(0, false, true), input(1, true, false, PlacementEnum.Below)],
      options,
    );

    expect(output.diagnostics.faults.map((fault) => fault.code)).to.include(
      "incompatible-linked-placement",
    );
  });

  it("includes rejected selections in the linked route score", (): void => {
    const reversed: SlurLinkedLayoutInput = input(0, false, false);
    reversed.context.start.notehead = {left: 17.5, right: 18.5, top: 1.5, bottom: 2.5};
    reversed.context.end.notehead = {left: 1.5, right: 2.5, top: 1.5, bottom: 2.5};
    reversed.context.start.seedAnchor = new PointF2D(18, 1.2);
    reversed.context.end.seedAnchor = new PointF2D(2, 1.2);
    reversed.seed.p0 = new PointF2D(18, 1.2);
    reversed.seed.p3 = new PointF2D(2, 1.2);

    const output: SlurLinkedLayoutOutput = calculateLinkedSlurLayouts([reversed], options);
    const selected: SlurCurveCandidate = output.results[0].candidates.find(
      (candidate): boolean => candidate.id === output.results[0].selectedCandidateId,
    );

    expect(selected?.rejected).to.equal(true);
    expect(output.diagnostics.totalScore).to.be.at.least(1_000_000);
  });
});

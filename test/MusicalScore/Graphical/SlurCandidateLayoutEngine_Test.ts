import { expect } from "chai";
import { PointF2D } from "../../../src/Common/DataObjects/PointF2D";
import { PlacementEnum } from "../../../src/MusicalScore/VoiceData/Expressions/AbstractExpression";
import {
  calculateCandidateSlurLayout,
  generateSlurAnchors,
  SlurCandidateLayoutOptions,
} from "../../../src/MusicalScore/Graphical/SlurLayout/SlurCandidateLayoutEngine";
import {
  SlurAnchorCandidate,
  SlurCurveGeometry,
  SlurCurveCandidate,
  SlurEndpointContext,
  SlurLayoutContext,
  SlurLayoutResult,
  SlurObstacle,
} from "../../../src/MusicalScore/Graphical/SlurLayout/SlurLayoutTypes";

const endpoint: (side: "start" | "end", x: number) => SlurEndpointContext = (
  side: "start" | "end",
  x: number,
): SlurEndpointContext => ({
  side,
  present: true,
  notehead: { left: x - 0.5, right: x + 0.5, top: 1.5, bottom: 2.5 },
  stemSide: false,
  beams: [],
  accidentals: [],
  articulations: [],
  seedAnchor: new PointF2D(x, 1.2),
  seedAttachment: "notehead",
  tiedEndpoint: false,
  chordSize: 1,
  polyphonic: false,
  grace: false,
  systemBoundary: false,
});

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

function context(overrides: Partial<SlurLayoutContext> = {}): SlurLayoutContext {
  return {
    id: "unit-slur",
    direction: PlacementEnum.Above,
    start: endpoint("start", 2),
    end: endpoint("end", 18),
    obstacles: [],
    envelope: {
      samplingUnit: 10,
      skyline: Array(201).fill(0),
      bottomline: Array(201).fill(4),
      topLineOffset: 0,
      bottomLineOffset: 4,
      width: 20,
    },
    segmentIndex: 0,
    segmentCount: 1,
    isCrossStaff: false,
    isCrossSystem: false,
    isNested: false,
    ...overrides,
  };
}

const seed: SlurCurveGeometry = {
  p0: new PointF2D(2, 1.2),
  p1: new PointF2D(6, -2.2),
  p2: new PointF2D(14, -2.2),
  p3: new PointF2D(18, 1.2),
};

describe("candidate slur layout engine", (): void => {
  it("scores a bounded deterministic candidate set", (): void => {
    const first: SlurLayoutResult = calculateCandidateSlurLayout(context(), seed, options);
    const second: SlurLayoutResult = calculateCandidateSlurLayout(context(), seed, options);

    expect(first.candidates.length).to.be.greaterThan(1).and.at.most(96);
    expect(first.selectedCandidateId).to.equal(second.selectedCandidateId);
    expect(first.geometry).to.deep.equal(second.geometry);
    expect(first.candidates.map((candidate) => candidate.score?.total)).to.deep.equal(
      second.candidates.map((candidate) => candidate.score?.total),
    );
    expect(first.skylineUpdates.length).to.be.greaterThan(0);
  });

  it("keeps weighted controls close to the endpoint they protect", (): void => {
    const result: SlurLayoutResult = calculateCandidateSlurLayout(context(), seed, options);
    const startWeighted: SlurCurveCandidate = result.candidates.find(
      (candidate) => candidate.family === "start-weighted",
    );
    const endWeighted: SlurCurveCandidate = result.candidates.find(
      (candidate) => candidate.family === "end-weighted",
    );
    const width: number = seed.p3.x - seed.p0.x;

    expect(startWeighted.geometry.p1.x).to.be.lessThan(seed.p0.x + width * 0.05);
    expect(endWeighted.geometry.p2.x).to.be.greaterThan(seed.p0.x + width * 0.95);
  });

  it("hard-rejects curves intersecting an internal notehead", (): void => {
    const result: SlurLayoutResult = calculateCandidateSlurLayout(
      context({
        obstacles: [
          {
            id: "middle-head",
            type: "notehead",
            bounds: { left: 9, right: 11, top: -1, bottom: 2 },
            clearance: 0.1,
          },
        ],
      }),
      seed,
      options,
    );

    expect(
      result.candidates.some((candidate) => candidate.rejectionReason === "obstacle-intersection"),
    ).to.equal(true);
    expect(
      result.candidates.some((candidate) => candidate.rejectionObstacleIds?.includes("middle-head")),
    ).to.equal(true);
    const selected: SlurCurveCandidate = result.candidates.find(
      (candidate) => candidate.id === result.selectedCandidateId,
    );
    expect(selected?.rejected).to.equal(false);
  });

  it("hard-rejects a thin internal stem between regular curve samples", (): void => {
    const thinStem: SlurObstacle = {
      id: "thin-middle-stem",
      type: "stem",
      bounds: {left: 9.087, right: 9.107, top: -1.7, bottom: 0.4},
      clearance: 0.08,
    };
    const result: SlurLayoutResult = calculateCandidateSlurLayout(
      context({obstacles: [thinStem]}),
      seed,
      options,
    );

    expect(result.candidates.some(
      (candidate): boolean => candidate.rejectionObstacleIds?.includes(thinStem.id),
    )).to.equal(true);
    const selected: SlurCurveCandidate = result.candidates.find(
      (candidate): boolean => candidate.id === result.selectedCandidateId,
    );
    expect(selected?.rejected).to.equal(false);
    expect(selected?.rejectionObstacleIds ?? []).not.to.include(thinStem.id);
  });

  it("does not let an endpoint-local polyphonic head inflate the high route", (): void => {
    const localHead: SlurObstacle = {
      id: "endpoint-local-polyphonic-head",
      type: "notehead",
      bounds: {left: 1.6, right: 2.4, top: 2.8, bottom: 5.8},
      clearance: 0.1,
    };
    const belowSeed: SlurCurveGeometry = {
      p0: new PointF2D(2, 2.8),
      p1: new PointF2D(6, 6),
      p2: new PointF2D(14, 6),
      p3: new PointF2D(18, 2.8),
    };
    const result: SlurLayoutResult = calculateCandidateSlurLayout(
      context({direction: PlacementEnum.Below, obstacles: [localHead]}),
      belowSeed,
      options,
    );
    const high: SlurCurveCandidate = result.candidates.find(
      (candidate): boolean => candidate.family === "high",
    );

    expect(high.geometry.p1.y).to.be.lessThan(10);
    expect(result.candidates.some(
      (candidate): boolean => candidate.rejectionObstacleIds?.includes(localHead.id),
    )).to.equal(true);
  });

  it("raises obstacle-routed curves only as far as their clearance requires", (): void => {
    const nearlyClearedSeed: SlurCurveGeometry = {
      p0: new PointF2D(2, 1.2),
      p1: new PointF2D(6, -2.2),
      p2: new PointF2D(14, -2.2),
      p3: new PointF2D(18, 1.2),
    };
    const result: SlurLayoutResult = calculateCandidateSlurLayout(
      context({
        obstacles: [{
          id: "near-seed-head",
          type: "notehead",
          bounds: {left: 9, right: 11, top: -1.3, bottom: 0.2},
          clearance: 0.1,
        }],
      }),
      nearlyClearedSeed,
      options,
    );
    const routed: SlurCurveCandidate = result.candidates.find(
      (candidate) => candidate.family === "high" && candidate.generationIndex === 2,
    );
    const seedBow: number = nearlyClearedSeed.p0.y - nearlyClearedSeed.p1.y;
    const routedBow: number = routed.geometry.p0.y - routed.geometry.p1.y;

    expect(routed.rejected).to.equal(false);
    expect(routedBow).to.be.greaterThan(seedBow);
    expect(routedBow).to.be.lessThan(seedBow * 1.5);
  });

  it("concentrates obstacle-routed bow near the obstructed end", (): void => {
    const result: SlurLayoutResult = calculateCandidateSlurLayout(
      context({
        obstacles: [{
          id: "late-beam",
          type: "beam",
          bounds: {left: 10, right: 16, top: -2.8, bottom: -1.8},
          clearance: 0.1,
        }],
      }),
      seed,
      options,
    );
    const routed: SlurCurveCandidate = result.candidates.find(
      (candidate): boolean => candidate.family === "high" && candidate.generationIndex === 2,
    );
    const startBaseline: number = seed.p0.y +
      (seed.p3.y - seed.p0.y) * ((routed.geometry.p1.x - seed.p0.x) / (seed.p3.x - seed.p0.x));
    const endBaseline: number = seed.p0.y +
      (seed.p3.y - seed.p0.y) * ((routed.geometry.p2.x - seed.p0.x) / (seed.p3.x - seed.p0.x));
    const startBow: number = startBaseline - routed.geometry.p1.y;
    const endBow: number = endBaseline - routed.geometry.p2.y;

    expect(routed.rejected).to.equal(false);
    expect(endBow).to.be.greaterThan(startBow * 1.25);
  });

  it("offers a notehead crown while retaining the geometry-seed attachment candidate", (): void => {
    const anchors: {start: SlurAnchorCandidate[], end: SlurAnchorCandidate[]} = generateSlurAnchors(
      context(),
      seed,
      options.obstacleClearance,
    );
    const crown: SlurAnchorCandidate = anchors.start.find(
      (anchor) => anchor.type === "notehead-center",
    );

    expect(crown.x).to.equal(2);
    expect(crown.y).to.equal(1.15);
    expect(anchors.start.some((anchor) => anchor.type === "notehead")).to.equal(true);
    expect(anchors.end.some((anchor) => anchor.type === "notehead")).to.equal(true);
  });

  it("prices detached notehead seeds from the rendered crown at both endpoints", (): void => {
    const detachedSeed: SlurCurveGeometry = {
      p0: new PointF2D(3.2, 0.2),
      p1: new PointF2D(4, -1.4),
      p2: new PointF2D(16, -1.4),
      p3: new PointF2D(16.8, 0.2),
    };
    const anchors: {start: SlurAnchorCandidate[], end: SlurAnchorCandidate[]} =
      generateSlurAnchors(context(), detachedSeed, options.obstacleClearance);

    for (const side of ["start", "end"] as const) {
      const seedAnchor: SlurAnchorCandidate = anchors[side].find(
        (anchor): boolean => anchor.type === "notehead",
      );
      const crown: SlurAnchorCandidate = anchors[side].find(
        (anchor): boolean => anchor.type === "notehead-center",
      );
      const outerHead: SlurAnchorCandidate = anchors[side].find(
        (anchor): boolean => anchor.type === "outer-head",
      );
      expect(seedAnchor.penalties.displacement).to.be.greaterThan(
        crown.penalties.displacement,
      );
      expect(seedAnchor.penalties.displacement).to.be.greaterThan(0.9);
      expect(outerHead.penalties.displacement).to.be.greaterThan(0.05);
    }
  });

  it("favours rendered crowns for a compact unobstructed single-note slur", (): void => {
    const detachedSeed: SlurCurveGeometry = {
      p0: new PointF2D(3.2, 0.2),
      p1: new PointF2D(4, -3.8),
      p2: new PointF2D(6, -3.8),
      p3: new PointF2D(6.8, 0.2),
    };
    const clearContext: SlurLayoutContext = context({end: endpoint("end", 8)});
    clearContext.envelope = {
      ...clearContext.envelope,
      skyline: Array(201).fill(4),
      topLineOffset: 4,
    };
    const result: SlurLayoutResult = calculateCandidateSlurLayout(
      clearContext,
      detachedSeed,
      options,
    );
    const selected: SlurCurveCandidate = result.candidates.find(
      (candidate): boolean => candidate.id === result.selectedCandidateId,
    );
    const selectedBow: number = Math.max(
      Math.abs(selected.geometry.p1.y - selected.geometry.p0.y),
      Math.abs(selected.geometry.p2.y - selected.geometry.p3.y),
    );
    const sourceBow: number = Math.max(
      Math.abs(detachedSeed.p1.y - detachedSeed.p0.y),
      Math.abs(detachedSeed.p2.y - detachedSeed.p3.y),
    );

    expect(selected.startAnchor.type).to.equal("notehead-center");
    expect(["notehead", "notehead-center"]).to.include(selected.endAnchor.type);
    expect(selected.endAnchor.x).to.be.closeTo(8, 1e-9);
    expect(selectedBow).to.be.greaterThan(0.6);
    expect(selectedBow).to.be.lessThan(sourceBow / 2);
    expect(result.candidates.some(
      (candidate): boolean =>
        candidate.startAnchor.type === "notehead-shoulder" ||
        candidate.endAnchor.type === "outer-head",
    )).to.equal(true);
  });

  it("caps imported bow for regenerated broad-phrase candidates", (): void => {
    const exaggeratedSeed: SlurCurveGeometry = {
      p0: new PointF2D(2, 1.2),
      p1: new PointF2D(6, -8.8),
      p2: new PointF2D(14, -8.8),
      p3: new PointF2D(18, 1.2),
    };
    const clearContext: SlurLayoutContext = context();
    clearContext.envelope = {
      ...clearContext.envelope,
      skyline: Array(201).fill(4),
      topLineOffset: 4,
    };
    const result: SlurLayoutResult = calculateCandidateSlurLayout(
      clearContext,
      exaggeratedSeed,
      options,
    );
    const selected: SlurCurveCandidate = result.candidates.find(
      (candidate): boolean => candidate.id === result.selectedCandidateId,
    );
    const selectedBow: number = Math.max(
      Math.abs(selected.geometry.p1.y - selected.geometry.p0.y),
      Math.abs(selected.geometry.p2.y - selected.geometry.p3.y),
    );

    expect(selected.family).not.to.equal("normal");
    expect(selectedBow).to.be.lessThan(2);
  });

  it("does not reuse a drifted staff-entry stem anchor", (): void => {
    const driftedStart: SlurEndpointContext = {
      ...endpoint("start", 2),
      stem: {left: 1.95, right: 2.05, top: 0, bottom: 3},
      stemSide: true,
      seedAnchor: new PointF2D(5, 1.2),
      seedAttachment: "stem",
    };
    const driftedSeed: SlurCurveGeometry = {
      p0: new PointF2D(5, 1.2),
      p1: new PointF2D(8, -2.2),
      p2: new PointF2D(14, -2.2),
      p3: new PointF2D(18, 1.2),
    };
    const result: SlurLayoutResult = calculateCandidateSlurLayout(
      context({start: driftedStart}),
      driftedSeed,
      options,
    );
    const anchors: {start: SlurAnchorCandidate[], end: SlurAnchorCandidate[]} =
      generateSlurAnchors(context({start: driftedStart}), driftedSeed, options.obstacleClearance);
    const selected: SlurCurveCandidate = result.candidates.find(
      (candidate) => candidate.id === result.selectedCandidateId,
    );
    const finalizedStem: SlurAnchorCandidate = anchors.start.find(
      (anchor): boolean => anchor.type === "stem-tip",
    );

    expect(anchors.start.some((anchor) => anchor.type === "stem")).to.equal(false);
    expect(finalizedStem.x).to.be.closeTo(2.08, 0.001);
    expect(selected.startAnchor.type).not.to.equal("stem");
    expect(selected.geometry.p0.x).not.to.be.closeTo(driftedSeed.p0.x, 0.001);
  });

  it("does not penalize a finalized stem-tip merely because its note is tied", (): void => {
    const tiedEnd: SlurEndpointContext = {
      ...endpoint("end", 18),
      stem: {left: 17.95, right: 18.05, top: -0.5, bottom: 2.5},
      stemSide: true,
      tiedEndpoint: true,
      seedAttachment: "notehead",
    };
    const anchors: {start: SlurAnchorCandidate[], end: SlurAnchorCandidate[]} = generateSlurAnchors(
      context({end: tiedEnd}),
      seed,
      options.obstacleClearance,
    );
    const stemTip: SlurAnchorCandidate = anchors.end.find(
      (anchor) => anchor.type === "stem-tip",
    );

    expect(stemTip).not.to.equal(undefined);
    expect(stemTip.penalties.tieConflict).to.equal(0);

    const originalShoulder: SlurAnchorCandidate = anchors.end.find(
      (anchor) => anchor.type === "notehead-shoulder",
    );
    const alternateShoulder: SlurAnchorCandidate = generateSlurAnchors(
      context({end: {...tiedEnd, seedAttachment: "stem"}}),
      seed,
      options.obstacleClearance,
    ).end.find((anchor) => anchor.type === "notehead-shoulder");
    expect(originalShoulder.penalties.tieConflict).to.equal(0.5);
    expect(alternateShoulder.penalties.tieConflict).to.equal(0.5);
  });

  it("uses finalized stem and beam surfaces for eligible phrase endpoints", (): void => {
    const stemEnd: SlurEndpointContext = {
      ...endpoint("end", 18),
      stem: {left: 17.95, right: 18.05, top: -0.5, bottom: 2.5},
      stemSide: true,
    };
    const stemResult: SlurLayoutResult = calculateCandidateSlurLayout(
      context({end: stemEnd}),
      seed,
      options,
    );
    const selectedStem: SlurCurveCandidate = stemResult.candidates.find(
      (candidate: SlurCurveCandidate): boolean => candidate.id === stemResult.selectedCandidateId,
    );
    expect(selectedStem.endAnchor.type, JSON.stringify(stemResult.candidates
      .filter((candidate: SlurCurveCandidate): boolean => !candidate.rejected)
      .sort((left: SlurCurveCandidate, right: SlurCurveCandidate): number => left.score.total - right.score.total)
      .slice(0, 8)
      .map((candidate: SlurCurveCandidate) => ({
        anchors: [candidate.startAnchor.type, candidate.endAnchor.type],
        family: candidate.family,
        score: candidate.score,
      })))).to.equal("stem-tip");

    const returningBeamEnd: SlurEndpointContext = {
      ...stemEnd,
      beams: [{left: 11, right: 18.2, top: -1, bottom: -0.5}],
      beamSideAnchor: new PointF2D(18, -1),
    };
    const returningContext: SlurLayoutContext = context({
      start: {...endpoint("start", 2), systemBoundary: true},
      end: returningBeamEnd,
      isCrossSystem: true,
      segmentIndex: 1,
      segmentCount: 2,
    });
    const returningAnchors: {start: SlurAnchorCandidate[], end: SlurAnchorCandidate[]} =
      generateSlurAnchors(returningContext, seed, options.obstacleClearance);
    expect(returningAnchors.end.some((anchor: SlurAnchorCandidate): boolean =>
      anchor.type === "beam-side")).to.equal(true);

    const returningChordContext: SlurLayoutContext = {
      ...returningContext,
      end: {...returningBeamEnd, chordSize: 2},
    };
    const returningChordAnchors: {start: SlurAnchorCandidate[], end: SlurAnchorCandidate[]} =
      generateSlurAnchors(returningChordContext, seed, options.obstacleClearance);
    expect(returningChordAnchors.end.some((anchor: SlurAnchorCandidate): boolean =>
      anchor.type === "beam-side" || anchor.type === "stem-tip")).to.equal(false);
  });

  it("favours a balanced crown on a flat obstacle profile", (): void => {
    const asymmetricSeed: SlurCurveGeometry = {
      p0: new PointF2D(2, 1.2),
      p1: new PointF2D(2.8, -2.2),
      p2: new PointF2D(10, -2.2),
      p3: new PointF2D(18, 1.2),
    };
    const result: SlurLayoutResult = calculateCandidateSlurLayout(
      context(),
      asymmetricSeed,
      options,
    );
    const selected: SlurCurveCandidate = result.candidates.find(
      (candidate) => candidate.id === result.selectedCandidateId,
    );
    const crownX: number = (selected.geometry.p1.x + selected.geometry.p2.x) / 2;

    expect(crownX).to.be.closeTo(10, 0.75);
  });

  it("measures the crown against the note-to-note chord on a steep broad phrase", (): void => {
    const descendingEnd: SlurEndpointContext = {
      ...endpoint("end", 18),
      notehead: {left: 17.5, right: 18.5, top: 5.8, bottom: 6.8},
      seedAnchor: new PointF2D(18, 5.45),
    };
    const steepSeed: SlurCurveGeometry = {
      p0: new PointF2D(2, 1.2),
      p1: new PointF2D(7, -0.2),
      p2: new PointF2D(13, 3.8),
      p3: new PointF2D(18, 5.45),
    };
    const result: SlurLayoutResult = calculateCandidateSlurLayout(
      context({
        end: descendingEnd,
        obstacles: [{
          id: "late-accidental",
          type: "accidental",
          bounds: {left: 13.2, right: 14.1, top: 3.65, bottom: 5.1},
          clearance: 0.1,
        }],
      }),
      steepSeed,
      options,
    );
    const selected: SlurCurveCandidate = result.candidates.find(
      (candidate): boolean => candidate.id === result.selectedCandidateId,
    );
    const startRun: number = selected.geometry.p1.x - selected.geometry.p0.x;
    const endRun: number = selected.geometry.p3.x - selected.geometry.p2.x;

    expect(["notehead", "notehead-center"]).to.include(selected.startAnchor.type);
    expect(selected.startAnchor.x).to.be.closeTo(2, 0.001);
    expect(selected.startAnchor.y).to.be.closeTo(1.15, 0.001);
    expect(selected.family).to.not.equal("start-weighted");
    expect(startRun).to.be.closeTo(endRun, 1.5);
  });

  it("offers a finalized stem-tip anchor for a chord on the slur side", (): void => {
    const chordStart: SlurEndpointContext = {
      ...endpoint("start", 2),
      chordSize: 4,
      stem: {left: 1.95, right: 2.05, top: -4, bottom: 3},
      stemSide: true,
    };
    const anchors: {start: SlurAnchorCandidate[], end: SlurAnchorCandidate[]} = generateSlurAnchors(
      context({start: chordStart}),
      seed,
      options.obstacleClearance,
    );

    expect(anchors.start.some((anchor) => anchor.type === "stem-tip")).to.equal(true);
  });

  it("uses the stem side to identify a chord phrase in polyphonic texture", (): void => {
    const chordStart: SlurEndpointContext = {
      ...endpoint("start", 2),
      chordSize: 2,
      polyphonic: true,
      stem: {left: 1.95, right: 2.05, top: 1.5, bottom: 5},
      stemSide: true,
    };
    const result: SlurLayoutResult = calculateCandidateSlurLayout(
      context({start: chordStart, direction: PlacementEnum.Below}),
      {
        p0: new PointF2D(2, 5.35),
        p1: new PointF2D(6, 7),
        p2: new PointF2D(14, 7),
        p3: new PointF2D(18, 2.85),
      },
      options,
    );
    const selected: SlurCurveCandidate = result.candidates.find(
      (candidate): boolean => candidate.id === result.selectedCandidateId,
    );

    expect(selected.startAnchor.type).to.equal("stem-tip");
  });

  it("keeps long chord stem tips behind the semantic outer notehead", (): void => {
    const chordEnd: SlurEndpointContext = {
      ...endpoint("end", 18),
      chordSize: 3,
      stem: {left: 17.95, right: 18.05, top: -3, bottom: 3},
      stemSide: true,
    };
    const result: SlurLayoutResult = calculateCandidateSlurLayout(
      context({end: chordEnd}),
      seed,
      options,
    );
    const stemTip: SlurCurveCandidate = result.candidates.find(
      (candidate): boolean => candidate.endAnchor.type === "stem-tip" && !candidate.rejected,
    );
    const crown: SlurCurveCandidate = result.candidates.find(
      (candidate): boolean => candidate.endAnchor.type === "notehead-center" && !candidate.rejected,
    );

    expect(stemTip.score.anchorDisplacement).to.be.greaterThan(crown.score.anchorDisplacement);
    expect(result.selectedCandidateId).to.not.equal(stemTip.id);
  });

  it("favours a lateral shoulder at a ledger-lined endpoint", (): void => {
    const ledgerContext: SlurLayoutContext = context({
      obstacles: [{
        id: "end-ledger",
        type: "ledger-line",
        bounds: {left: 17.2, right: 18.8, top: 1.45, bottom: 1.45},
        endpoint: "end",
        clearance: 0.12,
      }],
      end: {
        ...endpoint("end", 18),
        accidentals: [{left: 16.4, right: 17.1, top: 0.5, bottom: 2.5}],
      },
    });
    const result: SlurLayoutResult = calculateCandidateSlurLayout(ledgerContext, seed, options);
    const selected: SlurCurveCandidate = result.candidates.find(
      (candidate): boolean => candidate.id === result.selectedCandidateId,
    );

    expect(selected.endAnchor.type).to.equal("notehead-shoulder");
    expect(selected.endAnchor.x).to.be.lessThan(16.05);
    expect(selected.endAnchor.y).to.equal(1.15);
  });

  it("does not displace an above slur for a ledger below the notehead crown", (): void => {
    const ledgerContext: SlurLayoutContext = context({
      obstacles: [{
        id: "end-ledger-below-crown",
        type: "ledger-line",
        bounds: {left: 17.2, right: 18.8, top: 2, bottom: 2},
        endpoint: "end",
        clearance: 0.12,
      }],
    });
    const anchors: {start: SlurAnchorCandidate[], end: SlurAnchorCandidate[]} =
      generateSlurAnchors(ledgerContext, seed, options.obstacleClearance);
    const shoulder: SlurAnchorCandidate = anchors.end.find(
      (anchor): boolean => anchor.type === "notehead-shoulder",
    );
    const result: SlurLayoutResult = calculateCandidateSlurLayout(ledgerContext, seed, options);
    const selected: SlurCurveCandidate = result.candidates.find(
      (candidate): boolean => candidate.id === result.selectedCandidateId,
    );

    expect(shoulder.x).to.be.closeTo(17.42, 1e-9);
    expect(["notehead", "notehead-center"]).to.include(selected.endAnchor.type);
    expect(selected.endAnchor.x).to.be.closeTo(18, 1e-9);
  });

  it("does not offer a stem tip on the opposite side of a notehead", (): void => {
    const oppositeStemStart: SlurEndpointContext = {
      ...endpoint("start", 2),
      stem: {left: 1.95, right: 2.05, top: -2, bottom: 2.5},
      stemSide: false,
      beams: [{left: 1.8, right: 18.2, top: -2.5, bottom: -2}],
    };
    const anchors: {start: SlurAnchorCandidate[], end: SlurAnchorCandidate[]} = generateSlurAnchors(
      context({start: oppositeStemStart}),
      seed,
      options.obstacleClearance,
    );

    expect(anchors.start.some((anchor) => anchor.type === "stem-tip")).to.equal(false);
    expect(anchors.start.some((anchor) => anchor.type === "beam-side")).to.equal(false);
  });

  it("keeps a nested compact chord stem tip as a fallback behind the outer head", (): void => {
    const compactSeed: SlurCurveGeometry = {
      p0: new PointF2D(2, 1.2),
      p1: new PointF2D(3.5, -0.8),
      p2: new PointF2D(6.5, -0.8),
      p3: new PointF2D(8, 1.2),
    };
    const chordStart: SlurEndpointContext = {
      ...endpoint("start", 2),
      chordSize: 3,
      stem: {left: 1.95, right: 2.05, top: -4, bottom: 3},
      stemSide: true,
    };
    const anchors: {start: SlurAnchorCandidate[], end: SlurAnchorCandidate[]} = generateSlurAnchors(
      context({start: chordStart, end: endpoint("end", 8), isNested: true}),
      compactSeed,
      options.obstacleClearance,
    );
    const stemTip: SlurAnchorCandidate = anchors.start.find((anchor) => anchor.type === "stem-tip");
    const notehead: SlurAnchorCandidate = anchors.start.find((anchor) => anchor.type === "notehead");
    const penalty: (anchor: SlurAnchorCandidate) => number = (anchor) =>
      anchor.penalties.displacement + anchor.penalties.stemRelationship;

    expect(stemTip).not.to.equal(undefined);
    expect(penalty(stemTip)).to.be.greaterThan(penalty(notehead));
  });

  it("keeps a single compact chord phrase on its semantic outer heads", (): void => {
    const compactSeed: SlurCurveGeometry = {
      p0: new PointF2D(2, 1.2),
      p1: new PointF2D(3.5, -4.8),
      p2: new PointF2D(6.5, -4.8),
      p3: new PointF2D(8, 1.2),
    };
    const chordEndpoint: (side: "start" | "end", x: number) => SlurEndpointContext =
      (side, x): SlurEndpointContext => ({
        ...endpoint(side, x),
        chordSize: 3,
        stem: {left: x - 0.05, right: x + 0.05, top: -2, bottom: 3},
        stemSide: true,
      });
    const layoutContext: SlurLayoutContext = context({
      start: chordEndpoint("start", 2),
      end: chordEndpoint("end", 8),
    });
    const result: SlurLayoutResult = calculateCandidateSlurLayout(
      layoutContext,
      compactSeed,
      options,
    );
    const selected: SlurCurveCandidate = result.candidates.find(
      (candidate): boolean => candidate.id === result.selectedCandidateId,
    );
    const selectedBow: number = Math.abs(
      selected.geometry.p1.y -
      (selected.geometry.p0.y + selected.geometry.p3.y) / 2,
    );
    const seedBow: number = Math.abs(compactSeed.p1.y - compactSeed.p0.y);

    expect(["notehead", "notehead-center", "notehead-shoulder", "outer-head"])
      .to.include(selected.startAnchor.type);
    expect(["notehead", "notehead-center", "notehead-shoulder", "outer-head"])
      .to.include(selected.endAnchor.type);
    expect(selectedBow).to.be.lessThan(seedBow / 2);
  });

  it("keeps a duration articulation inside the selected slur", (): void => {
    const articulatedEnd: SlurEndpointContext = {
      ...endpoint("end", 18),
      // The finalized stem stops on the note-side of the staccato, reproducing
      // the real endpoint overlap this rule must reject.
      stem: {left: 17.95, right: 18.05, top: 1.2, bottom: 3},
      stemSide: true,
      seedAttachment: "stem",
      articulations: [{
        id: "staccato",
        glyphType: "a.",
        classification: "duration",
        position: 3,
        bounds: {left: 17.8, right: 18.2, top: 0.7, bottom: 1.1},
        outwardShift: 0,
      }],
    };
    const result: SlurLayoutResult = calculateCandidateSlurLayout(
      context({end: articulatedEnd}),
      seed,
      options,
    );
    const selected: SlurCurveCandidate = result.candidates.find(
      (candidate) => candidate.id === result.selectedCandidateId,
    );

    expect(selected.endAnchor.type).to.equal("outside-articulation");
    expect(selected.geometry.p3.y).to.be.lessThan(articulatedEnd.articulations[0].bounds.top);
    expect(result.candidates.some(
      (candidate): boolean =>
        candidate.endAnchor.type === "stem-tip" &&
        candidate.rejectionReason === "duration-articulation-outside-slur",
    )).to.equal(true);
  });

  it("does not offer shallow or flattened-long families for compact phrase slurs", (): void => {
    const shortSeed: SlurCurveGeometry = {
      p0: new PointF2D(2, 1.2),
      p1: new PointF2D(3.5, -0.8),
      p2: new PointF2D(6.5, -0.8),
      p3: new PointF2D(8, 1.2),
    };
    const result: SlurLayoutResult = calculateCandidateSlurLayout(
      context({end: endpoint("end", 8)}),
      shortSeed,
      options,
    );
    expect(result.candidates.some((candidate) => candidate.family === "shallow")).to.equal(false);
    expect(result.candidates.some((candidate) => candidate.family === "flattened-long")).to.equal(false);
    expect(result.candidates.some((candidate) => candidate.family === "normal")).to.equal(true);
  });

  it("keeps an unobstructed adjacent-note slur shallow and balanced within the staff", (): void => {
    const compactSeed: SlurCurveGeometry = {
      p0: new PointF2D(2, 1.2),
      p1: new PointF2D(3.4, 0.4),
      p2: new PointF2D(5.6, 0.4),
      p3: new PointF2D(7, 1.2),
    };
    const result: SlurLayoutResult = calculateCandidateSlurLayout(
      context({end: endpoint("end", 7)}),
      compactSeed,
      options,
    );
    const selected: SlurCurveCandidate = result.candidates.find(
      (candidate): boolean => candidate.id === result.selectedCandidateId,
    );
    const midpoint: number = (selected.geometry.p0.x + selected.geometry.p3.x) / 2;
    const firstControlOffset: number = midpoint - selected.geometry.p1.x;
    const secondControlOffset: number = selected.geometry.p2.x - midpoint;
    const bow: number = Math.max(
      Math.abs(selected.geometry.p1.y - selected.geometry.p0.y),
      Math.abs(selected.geometry.p2.y - selected.geometry.p3.y),
    );

    expect(selected.family).to.equal("normal");
    expect(selected.startAnchor.type).to.equal("notehead-center");
    expect(selected.endAnchor.type).to.equal("notehead-center");
    expect(selected.score.clearance).to.equal(0);
    expect(selected.score.staffLineInteraction).to.equal(0);
    expect(firstControlOffset).to.be.closeTo(secondControlOffset, 0.001);
    expect(bow).to.be.lessThan(1);
    expect(result.candidates.some(
      (candidate): boolean =>
        candidate.family === "start-weighted" || candidate.family === "end-weighted",
    )).to.equal(false);
  });

  it("retains weighted and high routes for a compact slur with an internal obstacle", (): void => {
    const compactSeed: SlurCurveGeometry = {
      p0: new PointF2D(2, 1.2),
      p1: new PointF2D(3.1, 0.4),
      p2: new PointF2D(4.9, 0.4),
      p3: new PointF2D(6, 1.2),
    };
    const result: SlurLayoutResult = calculateCandidateSlurLayout(
      context({
        end: endpoint("end", 6),
        obstacles: [{
          id: "compact-internal-notehead",
          type: "notehead",
          bounds: {left: 3.5, right: 4.5, top: -0.8, bottom: 0.8},
          clearance: 0.1,
        }],
      }),
      compactSeed,
      options,
    );

    expect(result.candidates.some(
      (candidate): boolean => candidate.family === "start-weighted",
    )).to.equal(true);
    expect(result.candidates.some(
      (candidate): boolean => candidate.family === "end-weighted",
    )).to.equal(true);
    expect(result.candidates.some(
      (candidate): boolean => candidate.family === "high" && !candidate.rejected,
    )).to.equal(true);
  });

  it("widens compact control arms that would hook into an endpoint", (): void => {
    const compactSeed: SlurCurveGeometry = {
      p0: new PointF2D(2, 1.2),
      p1: new PointF2D(3, -1),
      p2: new PointF2D(7, -1),
      p3: new PointF2D(8, 1.2),
    };
    const compactContext: SlurLayoutContext = context({
      end: endpoint("end", 8),
      obstacles: [{
        id: "compact-centre-obstacle",
        type: "notehead",
        bounds: {left: 4.4, right: 5.6, top: -2.4, bottom: 0.4},
        clearance: 0.1,
      }],
    });
    const result: SlurLayoutResult = calculateCandidateSlurLayout(
      compactContext,
      compactSeed,
      options,
    );
    const routed: SlurCurveCandidate = result.candidates.find(
      (candidate): boolean =>
        candidate.family === "high" &&
        !candidate.rejected &&
        candidate.startAnchor.type === "notehead-center" &&
        candidate.endAnchor.type === "notehead-center",
    );
    const startSlope: number = Math.abs(
      (routed.geometry.p1.y - routed.geometry.p0.y) /
      (routed.geometry.p1.x - routed.geometry.p0.x),
    );
    const endSlope: number = Math.abs(
      (routed.geometry.p3.y - routed.geometry.p2.y) /
      (routed.geometry.p3.x - routed.geometry.p2.x),
    );

    expect(startSlope, JSON.stringify(routed.geometry)).to.be.at.most(2.11);
    expect(endSlope, JSON.stringify(routed.geometry)).to.be.at.most(2.11);
  });

  it("places a chord endpoint shoulder outside its selected accidental", (): void => {
    const accidentalStart: SlurEndpointContext = {
      ...endpoint("start", 2),
      notehead: {left: 1.5, right: 2.5, top: 1.5, bottom: 2.5},
      accidentals: [{left: 0.4, right: 1.3, top: -0.25, bottom: 2.8}],
      chordSize: 2,
    };
    const anchors: {start: SlurAnchorCandidate[], end: SlurAnchorCandidate[]} = generateSlurAnchors(
      context({start: accidentalStart}),
      seed,
      options.obstacleClearance,
    );
    const shoulder: SlurAnchorCandidate = anchors.start.find(
      (anchor) => anchor.type === "notehead-shoulder",
    );

    expect(shoulder.y).to.equal(-0.25 - options.obstacleClearance);
  });

  it("scores movable articulations as soft obstacles", (): void => {
    const result: SlurLayoutResult = calculateCandidateSlurLayout(
      context({
        obstacles: [
          {
            id: "movable-accent",
            type: "force-articulation",
            articulationClass: "force",
            bounds: { left: 9, right: 11, top: -3, bottom: 1 },
            clearance: 0.1,
          },
        ],
      }),
      seed,
      options,
    );

    expect(result.candidates.some((candidate) => !candidate.rejected)).to.equal(true);
    expect(
      result.candidates.every((candidate) => candidate.rejectionReason !== "obstacle-intersection"),
    ).to.equal(true);
  });

  it("offers beam-side anchors outside a finalized endpoint beam", (): void => {
    const beamedStart: SlurEndpointContext = {
      ...endpoint("start", 2),
      stem: { left: 1.95, right: 2.05, top: 0, bottom: 3 },
      stemSide: true,
      beams: [{ left: 1.8, right: 18.2, top: -0.5, bottom: 0 }],
    };
    const beamedEnd: SlurEndpointContext = {
      ...endpoint("end", 18),
      stem: { left: 17.95, right: 18.05, top: 0, bottom: 3 },
      stemSide: true,
      beams: [{ left: 1.8, right: 18.2, top: -0.5, bottom: 0 }],
    };
    const result: SlurLayoutResult = calculateCandidateSlurLayout(
      context({ start: beamedStart, end: beamedEnd }),
      seed,
      options,
    );

    expect(
      result.candidates.some(
        (candidate) =>
          candidate.startAnchor.type === "beam-side" || candidate.endAnchor.type === "beam-side",
      ),
    ).to.equal(true);
  });

  it("uses exact local beam edges and prefers them for a shared beamed phrase", (): void => {
    const beamedStart: SlurEndpointContext = {
      ...endpoint("start", 2),
      stem: { left: 1.95, right: 2.05, top: -1.4, bottom: 3 },
      stemSide: true,
      beams: [{ left: 1.8, right: 18.2, top: -1.4, bottom: 0 }],
      beamSideAnchor: new PointF2D(2, -1.1),
    };
    const beamedEnd: SlurEndpointContext = {
      ...endpoint("end", 18),
      stem: { left: 17.95, right: 18.05, top: -2.2, bottom: 3 },
      stemSide: true,
      beams: [{ left: 1.8, right: 18.2, top: -2.4, bottom: -0.8 }],
      beamSideAnchor: new PointF2D(18, -2.05),
    };
    const layoutContext: SlurLayoutContext = context({
      start: beamedStart,
      end: beamedEnd,
      sharedEndpointBeam: true,
    });
    const anchors: {start: SlurAnchorCandidate[], end: SlurAnchorCandidate[]} =
      generateSlurAnchors(layoutContext, seed, options.obstacleClearance);
    const startBeam: SlurAnchorCandidate = anchors.start.find((anchor) => anchor.type === "beam-side");
    const endBeam: SlurAnchorCandidate = anchors.end.find((anchor) => anchor.type === "beam-side");

    expect(startBeam.x).to.equal(2);
    expect(startBeam.y).to.be.closeTo(-1.45, 1e-9);
    expect(endBeam.x).to.equal(18);
    expect(endBeam.y).to.be.closeTo(-2.4, 1e-9);

    const result: SlurLayoutResult = calculateCandidateSlurLayout(layoutContext, seed, options);
    const selected: SlurCurveCandidate = result.candidates.find(
      (candidate) => candidate.id === result.selectedCandidateId,
    );
    expect(selected.startAnchor.type).to.equal("beam-side");
    expect(selected.endAnchor.type).to.equal("beam-side");
  });

  it("keeps a valid semantic beam attachment ahead of a cheaper head fallback", (): void => {
    const beamedStart: SlurEndpointContext = {
      ...endpoint("start", 2),
      stem: { left: 1.95, right: 2.05, top: -1.4, bottom: 3 },
      stemSide: true,
      beams: [{ left: 1.8, right: 10, top: -1.4, bottom: 0 }],
      beamSideAnchor: new PointF2D(2, -1.1),
    };
    const boundaryEnd: SlurEndpointContext = {
      ...endpoint("end", 18),
      present: false,
      notehead: undefined,
      stem: undefined,
      systemBoundary: true,
      seedAnchor: new PointF2D(18, 1.2),
      seedAttachment: "system-edge",
      preferredTangent: 0,
    };
    const result: SlurLayoutResult = calculateCandidateSlurLayout(
      context({ start: beamedStart, end: boundaryEnd, isCrossSystem: true }),
      seed,
      {
        ...options,
        scoreWeights: { ...options.scoreWeights, systemContinuity: 1000 },
      },
    );
    const selected: SlurCurveCandidate = result.candidates.find(
      (candidate): boolean => candidate.id === result.selectedCandidateId,
    );
    const cheapestHeadFallback: SlurCurveCandidate = result.candidates
      .filter(
        (candidate): boolean =>
          !candidate.rejected &&
          ["notehead", "notehead-center", "notehead-shoulder", "outer-head"].includes(
            candidate.startAnchor.type,
          ),
      )
      .sort(
        (left, right): number =>
          (left.score?.total ?? Number.POSITIVE_INFINITY) -
          (right.score?.total ?? Number.POSITIVE_INFINITY),
      )[0];

    expect(selected.startAnchor.type).to.equal("beam-side");
    expect(cheapestHeadFallback.score.total).to.be.lessThan(selected.score.total);
  });

  it("returns a cross-staff continuation to an eligible destination beam", (): void => {
    const boundaryStart: SlurEndpointContext = {
      ...endpoint("start", 2),
      systemBoundary: true,
      seedAttachment: "system-edge",
    };
    const beamedEnd: SlurEndpointContext = {
      ...endpoint("end", 18),
      seedAnchor: new PointF2D(18, -2.05),
      seedAttachment: "beam-side",
      stem: { left: 17.95, right: 18.05, top: -2.2, bottom: 3 },
      stemSide: true,
      beams: [{ left: 1.8, right: 18.2, top: -2.4, bottom: -0.8 }],
      beamSideAnchor: new PointF2D(18, -2.05),
    };
    const returnSeed: SlurCurveGeometry = {
      p0: new PointF2D(2, -2.05),
      p1: new PointF2D(6, -2.05),
      p2: new PointF2D(14, -2.05),
      p3: new PointF2D(18, -2.05),
    };
    const result: SlurLayoutResult = calculateCandidateSlurLayout(
      context({
        start: boundaryStart,
        end: beamedEnd,
        isCrossStaff: true,
        isCrossSystem: true,
      }),
      returnSeed,
      options,
    );
    const selected: SlurCurveCandidate = result.candidates.find(
      (candidate): boolean => candidate.id === result.selectedCandidateId,
    );

    expect(selected.endAnchor.type).to.equal("beam-side");
    expect(
      result.candidates.some((candidate) => candidate.endAnchor.type === "beam-side"),
    ).to.equal(true);
    expect(
      result.candidates.some((candidate) => candidate.endAnchor.type === "stem-tip"),
    ).to.equal(false);
  });

  it("returns every linked continuation to its destination notehead", (): void => {
    const boundaryStart: SlurEndpointContext = {
      ...endpoint("start", 2),
      systemBoundary: true,
      seedAttachment: "system-edge",
    };
    const tiedChordEnd: SlurEndpointContext = {
      ...endpoint("end", 18),
      chordSize: 3,
      tiedEndpoint: true,
      seedAnchor: new PointF2D(18, -3.35),
      seedAttachment: "stem",
      stem: {left: 17.95, right: 18.05, top: -3, bottom: 3},
      stemSide: true,
    };
    const result: SlurLayoutResult = calculateCandidateSlurLayout(
      context({
        start: boundaryStart,
        end: tiedChordEnd,
        isCrossSystem: true,
      }),
      {
        p0: new PointF2D(2, -1),
        p1: new PointF2D(6, -1),
        p2: new PointF2D(14, -2),
        p3: new PointF2D(18, -3.35),
      },
      options,
    );
    const selected: SlurCurveCandidate = result.candidates.find(
      (candidate): boolean => candidate.id === result.selectedCandidateId,
    );

    expect(selected.endAnchor.type).to.not.equal("stem-tip");
    expect(selected.endAnchor.type).to.not.equal("beam-side");
    expect(result.candidates.some(
      (candidate): boolean => ["stem-tip", "beam-side"].includes(candidate.endAnchor.type),
    )).to.equal(false);
  });

  it("keeps an alternate endpoint anchor from inflecting a system exit", (): void => {
    const stemStart: SlurEndpointContext = {
      ...endpoint("start", 2),
      stem: {left: 1.95, right: 2.05, top: -1, bottom: 2.5},
      stemSide: true,
    };
    const boundaryEnd: SlurEndpointContext = {
      ...endpoint("end", 18),
      present: false,
      notehead: undefined,
      seedAnchor: new PointF2D(18, -1),
      seedAttachment: "system-edge",
      preferredTangent: -0.2,
      systemBoundary: true,
    };
    const result: SlurLayoutResult = calculateCandidateSlurLayout(
      context({start: stemStart, end: boundaryEnd, isCrossSystem: true}),
      {
        p0: new PointF2D(2, 1.2),
        p1: new PointF2D(6, -1.8),
        p2: new PointF2D(14, -1),
        p3: new PointF2D(18, -1),
      },
      options,
    );
    const routed: SlurCurveCandidate = result.candidates.find(
      (candidate): boolean =>
        candidate.family === "system-continuation" &&
        candidate.startAnchor.type === "stem-tip" &&
        !candidate.rejected,
    );
    const endSlope: number = (routed.geometry.p3.y - routed.geometry.p2.y) /
      (routed.geometry.p3.x - routed.geometry.p2.x);

    expect(endSlope).to.be.at.least(-1e-9);
  });

  it("keeps an unobstructed notehead endpoint centred before a system exit", (): void => {
    const boundaryEnd: SlurEndpointContext = {
      ...endpoint("end", 18),
      present: false,
      notehead: undefined,
      seedAnchor: new PointF2D(18, -1),
      seedAttachment: "system-edge",
      systemBoundary: true,
    };
    const result: SlurLayoutResult = calculateCandidateSlurLayout(
      context({end: boundaryEnd, isCrossSystem: true}),
      seed,
      options,
    );
    const selected: SlurCurveCandidate = result.candidates.find(
      (candidate): boolean => candidate.id === result.selectedCandidateId,
    );

    expect(selected.startAnchor.type).to.equal("notehead-center");
  });

  it("does not flatten a routed boundary control back through an obstacle", (): void => {
    const boundaryEnd: SlurEndpointContext = {
      ...endpoint("end", 18),
      present: false,
      notehead: undefined,
      seedAnchor: new PointF2D(18, 1.2),
      seedAttachment: "system-edge",
      preferredTangent: 0,
      systemBoundary: true,
    };
    const result: SlurLayoutResult = calculateCandidateSlurLayout(
      context({
        end: boundaryEnd,
        isCrossSystem: true,
        obstacles: [{
          id: "beam-before-break",
          type: "beam",
          // Already below the endpoint baseline: it needs no extra high-family
          // clearance, but the boundary control must still stay above it.
          bounds: {left: 9, right: 16, top: 1.5, bottom: 2.5},
          clearance: 0.1,
        }],
      }),
      seed,
      options,
    );
    const routed: SlurCurveCandidate = result.candidates.find(
      (candidate): boolean => candidate.family === "high" && !candidate.rejected,
    );

    expect(routed.geometry.p2.y).to.be.lessThan(routed.geometry.p3.y);
  });

  it("does not exempt a spanning endpoint beam outside the attachment zone", (): void => {
    const spanningBeam: SlurObstacle = {
      id: "endpoint-spanning-beam",
      type: "beam" as const,
      bounds: {left: 1.8, right: 18.2, top: -3.1, bottom: 0.1},
      polygon: [
        new PointF2D(1.8, -3.1),
        new PointF2D(18.2, -3.1),
        new PointF2D(18.2, 0.1),
        new PointF2D(1.8, 0.1),
      ],
      endpoint: "both" as const,
      clearance: 0.1,
    };
    const result: SlurLayoutResult = calculateCandidateSlurLayout(
      context({
        start: {
          ...endpoint("start", 2),
          stem: {left: 1.95, right: 2.05, top: -3.1, bottom: 2.5},
          stemSide: true,
          beams: [spanningBeam.bounds],
        },
        end: {
          ...endpoint("end", 18),
          stem: {left: 17.95, right: 18.05, top: -3.1, bottom: 2.5},
          stemSide: true,
          beams: [spanningBeam.bounds],
        },
        obstacles: [spanningBeam],
      }),
      seed,
      options,
    );
    const selected: SlurCurveCandidate = result.candidates.find(
      (candidate) => candidate.id === result.selectedCandidateId,
    );

    expect(
      result.candidates.some(
        (candidate) => candidate.rejectionObstacleIds?.includes(spanningBeam.id),
      ),
    ).to.equal(true);
    expect(selected?.rejected).to.equal(false);
  });

  it("uses the finalized beam polygon instead of its loose bounding box", (): void => {
    const slopedBeam: SlurObstacle = {
      id: "sloped-beam",
      type: "beam",
      bounds: {left: 6, right: 14, top: -4, bottom: -1.6},
      polygon: [
        new PointF2D(6, -4),
        new PointF2D(6.2, -4),
        new PointF2D(14, -1.8),
        new PointF2D(13.8, -1.6),
      ],
      clearance: 0.1,
    };
    const result: SlurLayoutResult = calculateCandidateSlurLayout(
      context({obstacles: [slopedBeam]}),
      seed,
      options,
    );
    const exactSeed: SlurCurveCandidate = result.candidates.find(
      (candidate): boolean =>
        candidate.family === "normal" &&
        candidate.geometry.p0.x === seed.p0.x &&
        candidate.geometry.p0.y === seed.p0.y &&
        candidate.geometry.p3.x === seed.p3.x &&
        candidate.geometry.p3.y === seed.p3.y,
    );

    expect(exactSeed.rejectionObstacleIds?.includes(slopedBeam.id) ?? false).to.equal(false);
  });

  it("does not exempt an outgoing endpoint tie outside the attachment zone", (): void => {
    const outgoingTie: SlurObstacle = {
      id: "outgoing-endpoint-tie",
      type: "tie" as const,
      bounds: {left: 2, right: 12, top: -2.4, bottom: 1.3},
      endpoint: "start" as const,
      clearance: 0.1,
      curve: {
        p0: new PointF2D(2, 1.1),
        p1: new PointF2D(5, -2),
        p2: new PointF2D(9, -2),
        p3: new PointF2D(12, 1.1),
      },
    };
    const result: SlurLayoutResult = calculateCandidateSlurLayout(
      context({obstacles: [outgoingTie]}),
      seed,
      options,
    );

    expect(
      result.candidates.some(
        (candidate) => candidate.rejectionObstacleIds?.includes(outgoingTie.id),
      ),
    ).to.equal(true);
  });

  it("keeps outer-head and beam-side choices in a capped candidate set", (): void => {
    const complexEndpoint: SlurEndpointContext = {
      ...endpoint("start", 2),
      stem: { left: 1.95, right: 2.05, top: 0, bottom: 3 },
      stemSide: true,
      beams: [{ left: 1.8, right: 18.2, top: -0.5, bottom: 0 }],
      articulations: [{
        id: "accent",
        glyphType: "a>",
        classification: "force",
        position: 3,
        bounds: { left: 1.5, right: 2.5, top: -1.5, bottom: -0.5 },
        outwardShift: 0,
      }],
    };
    const result: SlurLayoutResult = calculateCandidateSlurLayout(
      context({ start: complexEndpoint }),
      seed,
      {...options, candidateLimit: 48},
    );
    const anchorTypes: Set<string> = new Set(result.candidates.flatMap((candidate) => [
      candidate.startAnchor.type,
      candidate.endAnchor.type,
    ]));

    expect(anchorTypes.has("outer-head")).to.equal(true);
    expect(anchorTypes.has("beam-side")).to.equal(true);
  });

  it("records invalid reversed geometry as a hard rejection", (): void => {
    const reversed: SlurCurveGeometry = {
      p0: new PointF2D(18, 1),
      p1: new PointF2D(14, -1),
      p2: new PointF2D(6, -1),
      p3: new PointF2D(2, 1),
    };
    const result: SlurLayoutResult = calculateCandidateSlurLayout(
      context({ start: endpoint("start", 18), end: endpoint("end", 2) }),
      reversed,
      options,
    );

    expect(result.candidates.every((candidate) => candidate.rejected)).to.equal(true);
    expect(
      result.candidates.every((candidate) => candidate.rejectionReason === "reversed"),
    ).to.equal(true);
  });

  it("generates non-inflected alternatives when seed controls overshoot a diagonal endpoint", (): void => {
    const overshootingSeed: SlurCurveGeometry = {
      p0: new PointF2D(2, 4),
      p1: new PointF2D(6, 4.3),
      p2: new PointF2D(20, 7.5),
      p3: new PointF2D(18, 1.5),
    };
    const result: SlurLayoutResult = calculateCandidateSlurLayout(
      context({
        start: { ...endpoint("start", 2), seedAnchor: overshootingSeed.p0 },
        end: { ...endpoint("end", 18), seedAnchor: overshootingSeed.p3 },
      }),
      overshootingSeed,
      options,
    );

    const retainedSeed: SlurCurveCandidate = result.candidates.find(
      (candidate) =>
        candidate.family === "normal" &&
        candidate.startAnchor.generationIndex === 0 &&
        candidate.endAnchor.generationIndex === 0,
    );
    expect(retainedSeed.rejectionReason).to.equal("looping");
    expect(result.candidates.some((candidate) => !candidate.rejected)).to.equal(true);
  });

  it("treats selected inner slurs as hard obstacles for an outer route", (): void => {
    const inner: SlurCurveGeometry = {
      p0: new PointF2D(5, 0.4),
      p1: new PointF2D(8, -1.8),
      p2: new PointF2D(12, -1.8),
      p3: new PointF2D(15, 0.4),
    };
    const result: SlurLayoutResult = calculateCandidateSlurLayout(
      context({
        isNested: true,
        obstacles: [{
          id: "selected-inner-slur",
          type: "slur",
          bounds: {left: 5, right: 15, top: -1.8, bottom: 0.4},
          clearance: 0.2,
          curve: inner,
        }],
      }),
      seed,
      options,
    );
    const selected: SlurCurveCandidate = result.candidates.find(
      (candidate) => candidate.id === result.selectedCandidateId,
    );

    expect(result.candidates.some((candidate) => candidate.rejectionReason === "obstacle-intersection"))
      .to.equal(true);
    expect(selected?.rejected).to.equal(false);
  });

  it("routes around grace-note, tuplet, and neighbouring-tie geometry", (): void => {
    const result: SlurLayoutResult = calculateCandidateSlurLayout(
      context({
        obstacles: [
          {
            id: "grace-head",
            type: "grace-note",
            bounds: {left: 5, right: 6, top: -1.4, bottom: 0.4},
            clearance: 0.12,
          },
          {
            id: "tuplet-number",
            type: "tuplet",
            bounds: {left: 9, right: 11, top: -2.2, bottom: -1.2},
            clearance: 0.12,
          },
          {
            id: "neighbouring-tie",
            type: "tie",
            bounds: {left: 13, right: 16, top: -1.1, bottom: 0.5},
            clearance: 0.12,
            curve: {
              p0: new PointF2D(13, 0.2),
              p1: new PointF2D(14, -0.8),
              p2: new PointF2D(15, -0.8),
              p3: new PointF2D(16, 0.2),
            },
          },
        ],
      }),
      seed,
      options,
    );

    expect(result.candidates.some((candidate) => candidate.rejectionReason === "obstacle-intersection"))
      .to.equal(true);
    expect(result.candidates.some((candidate) => !candidate.rejected)).to.equal(true);
  });
});

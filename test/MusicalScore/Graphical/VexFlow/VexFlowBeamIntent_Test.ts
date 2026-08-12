import { expect } from "chai";
/* eslint-disable max-len -- keeping each compact MusicXML note legible as one fixture record */
import { OpenSheetMusicDisplay } from "../../../../src/OpenSheetMusicDisplay/OpenSheetMusicDisplay";
import { GraphicalMeasure } from "../../../../src/MusicalScore/Graphical/GraphicalMeasure";
import { VexFlowMeasure } from "../../../../src/MusicalScore/Graphical/VexFlow/VexFlowMeasure";
import { Beam } from "../../../../src/MusicalScore/VoiceData/Beam";
import { Note } from "../../../../src/MusicalScore/VoiceData/Note";
import { TestUtils } from "../../../Util/TestUtils";

const scoreXml: string = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>2</divisions><time><beats>6</beats><beat-type>8</beat-type></time><staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><stem default-y="15">up</stem><staff>2</staff><beam number="1">begin</beam></note>
      <note><pitch><step>E</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><stem default-y="15.25">up</stem><staff>2</staff><beam number="1">continue</beam></note>
      <note><pitch><step>G</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><stem default-y="15">up</stem><staff>2</staff><beam number="1">continue</beam></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><stem default-y="15.25">up</stem><staff>2</staff><beam number="1">continue</beam></note>
      <note><pitch><step>G</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><stem default-y="15">up</stem><staff>2</staff><beam number="1">continue</beam></note>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><stem default-y="15.25">up</stem><staff>2</staff><beam number="1">end</beam></note>
    </measure>
    <measure number="2">
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><stem default-y="15">up</stem><staff>2</staff><beam number="1">begin</beam><notations><slur type="start" number="1" orientation="over"/></notations></note>
      <note><pitch><step>E</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><stem default-y="18">up</stem><staff>2</staff><beam number="1">continue</beam></note>
      <note><pitch><step>G</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><stem default-y="21">up</stem><staff>2</staff><beam number="1">continue</beam></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><stem default-y="-97">down</stem><staff>1</staff><beam number="1">continue</beam><notations><slur type="stop" number="1" orientation="over"/></notations></note>
      <note><pitch><step>E</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><stem default-y="21">up</stem><staff>2</staff><beam number="1">continue</beam></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><stem default-y="-94">down</stem><staff>1</staff><beam number="1">end</beam></note>
    </measure>
  </part>
</score-partwise>`;

function sourceNotes(osmd: OpenSheetMusicDisplay, measureIndex: number): Note[] {
  return osmd.Sheet.SourceMeasures[measureIndex].VerticalSourceStaffEntryContainers
    .flatMap((container) => container.StaffEntries.filter(Boolean))
    .flatMap((staffEntry) => staffEntry.VoiceEntries)
    .flatMap((voiceEntry) => voiceEntry.Notes);
}

function renderedBeams(measure: GraphicalMeasure): any[] {
  return Object.values((measure as any).vfbeams ?? {}).flat() as any[];
}

describe("VexFlow authored and cross-staff beams", () => {
  let osmd: OpenSheetMusicDisplay;

  beforeEach(async (): Promise<void> => {
    const container: HTMLElement = TestUtils.getDivElement(document);
    osmd = TestUtils.createOpenSheetMusicDisplay(container);
    osmd.EngravingRules.SlurDiagnosticsLevel = "candidates";
    await osmd.load(new DOMParser().parseFromString(scoreXml, "application/xml"));
    osmd.render();
  });

  it("retains finite stem endpoints and recognizes a near-horizontal authored beam", (): void => {
    const notes: Note[] = sourceNotes(osmd, 0);
    expect(notes.map((note): number => note.StemDefaultYXml)).to.deep.equal([15, 15.25, 15, 15.25, 15, 15.25]);
    const beam: Beam = notes[0].NoteBeam;
    expect(beam.Notes).to.have.length(6);
    expect(beam.HasFlatBeamHint).to.equal(true);

    notes[5].StemDefaultYXml = 15.75;
    expect(beam.HasFlatBeamHint, "authored endpoints outside the flat tolerance keep their slope").to.equal(false);
    notes[5].StemDefaultYXml = undefined;
    expect(beam.HasFlatBeamHint, "a partial authored hint is not enough to flatten a beam").to.equal(false);
    notes[5].StemDefaultYXml = 15.25;
    expect(beam.HasFlatBeamHint).to.equal(true);

    const lowerMeasure: VexFlowMeasure = osmd.GraphicSheet.MeasureList[0][1] as VexFlowMeasure;
    const vfBeam: any = renderedBeams(lowerMeasure)[0];
    expect(vfBeam).to.not.equal(undefined);
    expect(vfBeam.renderOptions.flatBeams).to.equal(true);
    expect(vfBeam.slope).to.equal(0);
    const stave: any = (lowerMeasure as any).stave;
    const staveY: number = stave.getY();
    expect(
      Math.abs(vfBeam.renderOptions.flatBeamOffset - staveY),
      "the calculated flat beam follows the stave from layout coordinates to page coordinates",
    ).to.be.lessThan(100);

    // The cached VexFlow offset is an absolute canvas coordinate. A redraw must
    // derive it from the current note positions, even if an earlier pass left a
    // stale value from a different page or zoom coordinate space.
    vfBeam.renderOptions.flatBeamOffset = -5000;
    vfBeam.renderOptions.flat_beam_offset = -5000;
    lowerMeasure.setAbsoluteCoordinates(stave.getX(), staveY + 600);
    expect(
      Math.abs(vfBeam.renderOptions.flatBeamOffset - (staveY + 600)),
      "a translated authored flat beam discards its stale absolute offset",
    ).to.be.lessThan(100);
    lowerMeasure.setAbsoluteCoordinates(stave.getX(), staveY);
    expect(Math.abs(vfBeam.renderOptions.flatBeamOffset - staveY)).to.be.lessThan(100);
  });

  it("draws one ordered beam across both staves without a duplicate", (): void => {
    const notes: Note[] = sourceNotes(osmd, 1);
    const beam: Beam = notes[0].NoteBeam;
    expect(beam.HasFlatBeamHint).to.equal(false);
    expect(notes.every((note): boolean => note.NoteBeam === beam)).to.equal(true);

    const upperMeasure: VexFlowMeasure = osmd.GraphicSheet.MeasureList[1][0] as VexFlowMeasure;
    const lowerMeasure: VexFlowMeasure = osmd.GraphicSheet.MeasureList[1][1] as VexFlowMeasure;
    expect(renderedBeams(upperMeasure)).to.have.length(0);
    expect(renderedBeams(lowerMeasure)).to.have.length(1);

    const vfBeam: any = renderedBeams(lowerMeasure)[0];
    expect(vfBeam.getNotes()).to.have.length(6);
    expect(new Set(vfBeam.getNotes().map((note): unknown => note.getStave())).size).to.equal(2);
    expect(vfBeam.getNotes().every((note: any): boolean => note.getBeam() === vfBeam)).to.equal(true);
    expect(
      vfBeam.getNotes().map((note: any): number => note.getStemDirection()),
      "cross-staff notes retain their explicit MusicXML stem directions",
    ).to.deep.equal([1, 1, 1, -1, 1, -1]);
    const polygonYs: number[] = vfBeam.getRenderedBeamPolygons()
      .flatMap((polygon: any): number[] => polygon.points.map((point: any): number => point.y));
    const staveYs: number[] = [(upperMeasure as any).stave.getY(), (lowerMeasure as any).stave.getY()];
    const beamCenterY: number = (Math.min(...polygonYs) + Math.max(...polygonYs)) / 2;
    expect(
      beamCenterY,
      "the finalized beam uses the two staves' real vertical separation",
    ).to.be.within(Math.min(...staveYs) - 60, Math.max(...staveYs) + 100);

    osmd.updateGraphic();
    osmd.render();
    const rerenderedUpper: VexFlowMeasure = osmd.GraphicSheet.MeasureList[1][0] as VexFlowMeasure;
    const rerenderedLower: VexFlowMeasure = osmd.GraphicSheet.MeasureList[1][1] as VexFlowMeasure;
    expect(renderedBeams(rerenderedUpper), "rerender does not move or duplicate the cross-staff beam").to.have.length(0);
    expect(renderedBeams(rerenderedLower)).to.have.length(1);
    expect(renderedBeams(rerenderedLower)[0].getNotes()).to.have.length(6);
  });

  it("lays a cross-staff slur out against the complete spanning notation", (): void => {
    const staffLines: any[] = osmd.GraphicSheet.MusicPages[0].MusicSystems[0].StaffLines;
    const slur: any = staffLines.flatMap((staffLine): any[] => staffLine.GraphicalSlurs)
      .find((candidate): boolean => candidate.layoutContext?.isCrossStaff);

    expect(slur).to.not.equal(undefined);
    expect(slur.layoutContext.sharedEndpointBeam).to.equal(true);
    expect(slur.layoutContext.start.beamSideAnchor).to.not.equal(undefined);
    expect(slur.layoutContext.obstacles.filter((obstacle): boolean => obstacle.type === "notehead").length)
      .to.be.greaterThan(2);
    expect(slur.layoutContext.obstacles.some((obstacle): boolean => obstacle.type === "stem")).to.equal(true);
    expect(slur.layoutContext.obstacles.some((obstacle): boolean => obstacle.type === "beam")).to.equal(true);
    expect(slur.diagnostics.startAttachment).to.equal("beam-side");
    const selected: any = slur.layoutResult.candidates.find(
      (candidate): boolean => candidate.id === slur.layoutResult.selectedCandidateId,
    );
    const rejectedObstacles: any[] = slur.layoutContext.obstacles.filter(
      (obstacle): boolean => selected.rejectionObstacleIds?.includes(obstacle.id),
    );
    expect(selected.rejected, JSON.stringify({
      family: selected.family,
      geometry: selected.geometry,
      reason: selected.rejectionReason,
      obstacles: rejectedObstacles,
      highCandidates: slur.layoutResult.candidates.filter((candidate): boolean => candidate.family === "high")
        .slice(0, 4).map((candidate): unknown => ({
          geometry: candidate.geometry,
          anchors: [candidate.startAnchor.type, candidate.endAnchor.type],
          reason: candidate.rejectionReason,
          obstacleIds: candidate.rejectionObstacleIds,
        })),
    }))
      .to.equal(false);
  });
});

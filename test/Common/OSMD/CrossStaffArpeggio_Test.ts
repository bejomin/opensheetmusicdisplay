import {expect} from "chai";
import {GraphicalMeasure} from "../../../src/MusicalScore/Graphical/GraphicalMeasure";
import {VexFlowVoiceEntry} from "../../../src/MusicalScore/Graphical/VexFlow/VexFlowVoiceEntry";
import {OpenSheetMusicDisplay} from "../../../src/OpenSheetMusicDisplay/OpenSheetMusicDisplay";
import {Note} from "../../../src/MusicalScore/VoiceData/Note";
import {SourceStaffEntry} from "../../../src/MusicalScore/VoiceData/SourceStaffEntry";
import {VerticalSourceStaffEntryContainer} from
  "../../../src/MusicalScore/VoiceData/VerticalSourceStaffEntryContainer";
import {TestUtils} from "../../Util/TestUtils";

describe("MusicXML cross-staff arpeggios", (): void => {
  it("groups equal numbers across staves and keeps different numbers separate", async (): Promise<void> => {
    const osmd: OpenSheetMusicDisplay = await loadArpeggioScore();
    const containers: VerticalSourceStaffEntryContainer[] =
      osmd.Sheet.SourceMeasures[0].VerticalSourceStaffEntryContainers;
    const firstUpper: SourceStaffEntry = containers[0].StaffEntries[0];
    const firstLower: SourceStaffEntry = containers[0].StaffEntries[1];
    const firstUpperNote: Note = firstUpper.VoiceEntries[0].Notes[0];
    const firstLowerNote: Note = firstLower.VoiceEntries[0].Notes[0];

    expect(firstUpperNote.Arpeggio).to.equal(firstLowerNote.Arpeggio);
    expect(firstUpperNote.Arpeggio.number).to.equal(1);
    expect(firstUpperNote.Arpeggio.notes).to.have.length(6);
    expect(firstUpperNote.Arpeggio.unbroken).to.equal(true);
    expect(firstUpperNote.Arpeggio.parentVoiceEntry).to.equal(firstLower.VoiceEntries[0]);
    expect(firstUpper.VoiceEntries[0].Arpeggio).to.equal(undefined);
    expect(firstLower.VoiceEntries[0].Arpeggio).to.equal(firstUpperNote.Arpeggio);

    const secondUpperNote: Note = containers[1].StaffEntries[0].VoiceEntries[0].Notes[0];
    const secondLowerNote: Note = containers[1].StaffEntries[1].VoiceEntries[0].Notes[0];
    expect(secondUpperNote.Arpeggio.number).to.equal(1);
    expect(secondLowerNote.Arpeggio.number).to.equal(2);
    expect(secondUpperNote.Arpeggio).to.not.equal(secondLowerNote.Arpeggio);
    expect(secondUpperNote.Arpeggio.notes).to.have.length(3);
    expect(secondLowerNote.Arpeggio.notes).to.have.length(3);
  });

  it("renders one stroke with an explicit endpoint for the cross-staff group", async (): Promise<void> => {
    const osmd: OpenSheetMusicDisplay = await loadArpeggioScore();
    osmd.render();

    const upperMeasure: GraphicalMeasure = osmd.GraphicSheet.findGraphicalMeasure(0, 0);
    const lowerMeasure: GraphicalMeasure = osmd.GraphicSheet.findGraphicalMeasure(0, 1);
    const upperFirst: VexFlowVoiceEntry = upperMeasure.staffEntries[0].graphicalVoiceEntries[0] as VexFlowVoiceEntry;
    const lowerFirst: VexFlowVoiceEntry = lowerMeasure.staffEntries[0].graphicalVoiceEntries[0] as VexFlowVoiceEntry;
    const upperSecond: VexFlowVoiceEntry = upperMeasure.staffEntries[1].graphicalVoiceEntries[0] as VexFlowVoiceEntry;
    const lowerSecond: VexFlowVoiceEntry = lowerMeasure.staffEntries[1].graphicalVoiceEntries[0] as VexFlowVoiceEntry;
    const upperFirstStrokes: any[] = upperFirst.vfStaveNote.getModifiersByType("Stroke");
    const lowerFirstStrokes: any[] = lowerFirst.vfStaveNote.getModifiersByType("Stroke");

    expect(upperFirstStrokes).to.have.length(0);
    expect(lowerFirstStrokes).to.have.length(1);
    expect(lowerFirstStrokes[0].noteEnd).to.equal(upperFirst.vfStaveNote);
    expect(upperSecond.vfStaveNote.getModifiersByType("Stroke")).to.have.length(1);
    expect(lowerSecond.vfStaveNote.getModifiersByType("Stroke")).to.have.length(1);

    const strokeBounds: {getY(): number, getH(): number} = lowerFirstStrokes[0].getBoundingBox();
    expect(strokeBounds.getY()).to.be.at.most(Math.min(...upperFirst.vfStaveNote.getYs()));
    expect(strokeBounds.getY() + strokeBounds.getH()).to.be.at.least(Math.max(...lowerFirst.vfStaveNote.getYs()));
  });
});

async function loadArpeggioScore(): Promise<OpenSheetMusicDisplay> {
  const score: Document = TestUtils.getScore("test_arpeggio_cross_staff.musicxml");
  expect(score).to.not.equal(undefined);
  const osmd: OpenSheetMusicDisplay = TestUtils.createOpenSheetMusicDisplay(TestUtils.getDivElement(document));
  await osmd.load(score);
  return osmd;
}

import { expect } from "chai";
import { OpenSheetMusicDisplay } from "../../../../src/OpenSheetMusicDisplay/OpenSheetMusicDisplay";
import { NoteHeadShape } from "../../../../src/MusicalScore/VoiceData/Notehead";
import { ArticulationEnum } from "../../../../src/MusicalScore/VoiceData/VoiceEntry";
import * as VF from "../../../../src/MusicalScore/Graphical/VexFlow/VexFlowAdapter";
import { TestUtils } from "../../../Util/TestUtils";

/* eslint-disable max-len -- compact MusicXML notes are clearer as one fixture record */
const grandStaffFermataScore: string = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1"><measure number="1">
    <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>
      <clef number="1"><sign>G</sign><line>2</line></clef>
      <clef number="2"><sign>F</sign><line>4</line></clef>
    </attributes>
    <note><pitch><step>G</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><staff>1</staff><notations><fermata type="upright"/></notations></note>
    <backup><duration>4</duration></backup>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>3</voice><type>whole</type><staff>1</staff><notations><fermata type="upright"/></notations></note>
    <backup><duration>4</duration></backup>
    <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><type>whole</type><staff>2</staff><notations><fermata type="upright"/></notations></note>
    <backup><duration>4</duration></backup>
    <note><pitch><step>E</step><octave>2</octave></pitch><duration>4</duration><voice>4</voice><type>whole</type><staff>2</staff><notations><fermata type="upright"/></notations></note>
  </measure></part>
</score-partwise>`;
/* eslint-enable max-len */

describe("VexFlow 5 compatibility geometry", () => {
    it("renders mixed slash and normal noteheads in one percussion chord", async (): Promise<void> => {
        const score: Document = TestUtils.getScore("test_drums_slash_chord.musicxml");
        const osmd: OpenSheetMusicDisplay = TestUtils.createOpenSheetMusicDisplay(TestUtils.getDivElement(document));

        await osmd.load(score);
        osmd.render();

        const chordEntry: any = osmd.GraphicSheet.MeasureList
            .flatMap((measureList: any[]) => measureList)
            .flatMap((measure: any) => measure.staffEntries)
            .flatMap((staffEntry: any) => staffEntry.graphicalVoiceEntries)
            .find((voiceEntry: any) => voiceEntry.notes?.length === 2);
        expect(chordEntry, "expected a two-note percussion chord").to.not.equal(undefined);

        const slashNote: any = chordEntry.notes.find(
            (note: any): boolean => note.sourceNote.Notehead?.Shape === NoteHeadShape.SLASH,
        );
        const staveNote: VF.StaveNote = chordEntry.vfStaveNote;
        const slashGlyph: string = VF.Note.getGlyphProps(staveNote.getDuration(), "s").codeHead;
        expect(slashNote, "expected a slash notehead in the chord").to.not.equal(undefined);
        expect(staveNote.noteHeads[slashNote.vfnoteIndex].getText()).to.equal(slashGlyph);
    });

    it("keeps inverted fermata source data and modifier counts stable across rebuilds", async (): Promise<void> => {
        const score: Document = TestUtils.getScore("test_fermata_inverted_placement.musicxml");
        const osmd: OpenSheetMusicDisplay = TestUtils.createOpenSheetMusicDisplay(TestUtils.getDivElement(document));
        await osmd.load(score);

        const articulationCounts: () => number[] = (): number[] => osmd.Sheet.SourceMeasures
            .flatMap((measure: any) => measure.VerticalSourceStaffEntryContainers)
            .flatMap((container: any) => container.StaffEntries.filter(Boolean))
            .flatMap((staffEntry: any) => staffEntry.VoiceEntries)
            .map((voiceEntry: any) => voiceEntry.Articulations.length);
        const renderedInvertedFermatas: () => any[] = (): any[] => osmd.GraphicSheet.MeasureList
            .flatMap((measureList: any[]) => measureList)
            .flatMap((measure: any) => measure.staffEntries)
            .flatMap((staffEntry: any) => staffEntry.graphicalVoiceEntries)
            .flatMap((voiceEntry: any) => voiceEntry.vfStaveNote?.modifiers ?? [])
            .filter((modifier: any): boolean =>
                modifier.osmdArticulationEnum === ArticulationEnum.invertedfermata,
            );

        osmd.render();
        const initialCounts: number[] = articulationCounts();
        expect(renderedInvertedFermatas()).to.have.length(1);

        osmd.updateGraphic();
        osmd.render();
        expect(articulationCounts()).to.deep.equal(initialCounts);
        expect(renderedInvertedFermatas()).to.have.length(1);
    });

    it("renders one fermata on each outer side of a grand staff", async (): Promise<void> => {
        const osmd: OpenSheetMusicDisplay = TestUtils.createOpenSheetMusicDisplay(TestUtils.getDivElement(document));
        await osmd.load(grandStaffFermataScore);

        const renderedFermatas: (staffIndex: number) => any[] = (staffIndex: number): any[] =>
            osmd.GraphicSheet.MeasureList
                .map((measureList: any[]) => measureList[staffIndex])
                .filter(Boolean)
                .flatMap((measure: any) => measure.staffEntries)
                .flatMap((staffEntry: any) => staffEntry.graphicalVoiceEntries)
                .flatMap((voiceEntry: any) => voiceEntry.vfStaveNote?.modifiers ?? [])
                .filter((modifier: any): boolean =>
                    modifier.osmdArticulationEnum === ArticulationEnum.fermata ||
                    modifier.osmdArticulationEnum === ArticulationEnum.invertedfermata,
                );
        const sourceFermataCount: () => number = (): number => osmd.Sheet.SourceMeasures
            .flatMap((measure: any) => measure.VerticalSourceStaffEntryContainers)
            .flatMap((container: any) => container.StaffEntries.filter(Boolean))
            .flatMap((staffEntry: any) => staffEntry.VoiceEntries)
            .flatMap((voiceEntry: any) => voiceEntry.Articulations)
            .filter((articulation: any): boolean =>
                articulation.articulationEnum === ArticulationEnum.fermata ||
                articulation.articulationEnum === ArticulationEnum.invertedfermata,
            ).length;

        osmd.render();
        expect(sourceFermataCount()).to.equal(4);
        expect(renderedFermatas(0)).to.have.length(1);
        expect(renderedFermatas(0)[0].osmdArticulationEnum).to.equal(ArticulationEnum.fermata);
        expect(renderedFermatas(0)[0].getPosition()).to.equal(VF.Modifier.Position.ABOVE);
        expect(renderedFermatas(1)).to.have.length(1);
        expect(renderedFermatas(1)[0].osmdArticulationEnum).to.equal(ArticulationEnum.invertedfermata);
        expect(renderedFermatas(1)[0].getPosition()).to.equal(VF.Modifier.Position.BELOW);

        osmd.updateGraphic();
        osmd.render();
        expect(sourceFermataCount()).to.equal(4);
        expect(renderedFermatas(0)).to.have.length(1);
        expect(renderedFermatas(1)).to.have.length(1);
    });

    it("draws unmeasured buzz rolls with finite finalized stem geometry", async (): Promise<void> => {
        const score: Document = TestUtils.getScore("test_tremolo_unmeasured_buzz_roll.musicxml");
        const container: HTMLElement = TestUtils.getDivElement(document);
        const osmd: OpenSheetMusicDisplay = TestUtils.createOpenSheetMusicDisplay(container);
        await osmd.load(score);
        osmd.render();

        const buzzRolls: Element[] = Array.from(container.querySelectorAll("g[id^='vf-buzzRoll']"));
        expect(buzzRolls.length).to.be.greaterThan(0);
        for (const path of buzzRolls.flatMap((group: Element): Element[] => Array.from(group.querySelectorAll("path")))) {
            expect(path.getAttribute("d")).to.not.match(/NaN|Infinity/);
        }
    });
});

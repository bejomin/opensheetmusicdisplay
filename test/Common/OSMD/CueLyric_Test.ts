import { expect } from "chai";
import { OpenSheetMusicDisplay } from "../../../src/OpenSheetMusicDisplay/OpenSheetMusicDisplay";
import { TestUtils } from "../../Util/TestUtils";

// Dorico writes its alternate sung line as a second rhythmic voice with
// <type size="cue">, not as zero-duration grace notes.
const score: string = `<?xml version="1.0" encoding="utf-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list>
  <part id="P1"><measure number="1">
    <attributes><divisions>2</divisions><time><beats>1</beats><beat-type>4</beat-type></time>
      <clef><sign>G</sign><line>2</line></clef></attributes>
    <note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration>
      <voice>1</voice><type>quarter</type></note>
    <backup><duration>2</duration></backup>
    <note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration>
      <voice>2</voice><type size="cue">eighth</type>
      <lyric number="4"><syllabic>single</syllabic><text>mer</text></lyric>
      <lyric number="3"><syllabic>single</syllabic><text>I</text></lyric>
      <lyric number="1"><syllabic>single</syllabic><text>this</text></lyric>
      <lyric number="2"><syllabic>single</syllabic><text>do</text></lyric></note>
    <note><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration>
      <voice>2</voice><type size="cue">eighth</type>
      <lyric number="4"><syllabic>single</syllabic><text>ri</text></lyric>
      <lyric number="3"><syllabic>single</syllabic><text>may</text></lyric>
      <lyric number="1"><syllabic>single</syllabic><text>the</text></lyric>
      <lyric number="2"><syllabic>single</syllabic><text>not</text></lyric></note>
  </measure></part>
</score-partwise>`;

describe("rhythmic cue-note lyrics", (): void => {
    it("retains four sung lines and draws smaller rhythmic cue notes", async (): Promise<void> => {
        const container: HTMLElement = TestUtils.getDivElement(document);
        const osmd: OpenSheetMusicDisplay = TestUtils.createOpenSheetMusicDisplay(
            container,
        );
        await osmd.load(score);
        osmd.render();

        const entries: any[] = osmd.GraphicSheet.MeasureList[0][0].staffEntries;
        const cueVoices: any[] = entries.flatMap((entry: any): any[] => entry.graphicalVoiceEntries)
            .filter((entry: any): boolean => entry.notes[0]?.sourceNote.IsCueNote);
        expect(cueVoices).to.have.length(2);
        expect(cueVoices.map((entry: any): string => entry.vfStaveNote.getCategory()))
            .to.deep.equal(["StaveNote", "StaveNote"]);
        expect(cueVoices.map((entry: any): number => entry.vfStaveNote.getFontScale()))
            .to.deep.equal([2 / 3, 2 / 3]);
        const lyrics: string[] = entries.flatMap((entry: any): string[] =>
            entry.LyricsEntries.map((lyric: any): string => lyric.LyricsEntry.Text));
        expect(lyrics).to.have.members(["mer", "I", "this", "do", "ri", "may", "the", "not"]);
        expect(lyrics).to.have.length(8);
        for (const word of lyrics) {
            expect(container.textContent).to.contain(word);
        }
    });
});

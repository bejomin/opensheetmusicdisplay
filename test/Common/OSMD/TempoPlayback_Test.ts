import { expect } from "chai";
import { OpenSheetMusicDisplay } from "../../../src/OpenSheetMusicDisplay/OpenSheetMusicDisplay";
import { TestUtils } from "../../Util/TestUtils";

function explicitTempoMap(osmd: OpenSheetMusicDisplay): Array<{ tempo: number, timestamp: number }> {
    return osmd.Sheet.TimestampSortedTempoExpressionsList
        .filter(expression => Number.isFinite(
            expression.InstantaneousTempo?.ExplicitPlaybackTempoInQuarterBpm,
        ))
        .map(expression => ({
            tempo: expression.InstantaneousTempo.ExplicitPlaybackTempoInQuarterBpm,
            timestamp: expression.AbsoluteTimestamp.RealValue,
        }));
}

describe("explicit MusicXML playback tempo", () => {
    it("anchors an initial after-backup metronome mark to the first measure content", async () => {
        const xml: string = `<?xml version="1.0"?><score-partwise version="4.0">
          <part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list>
          <part id="P1"><measure number="1">
            <attributes><divisions>1</divisions><time><beats>2</beats><beat-type>2</beat-type></time>
              <clef><sign>G</sign><line>2</line></clef></attributes>
            <note><rest/><duration>4</duration><type>whole</type></note>
            <backup><duration>4</duration></backup>
            <direction placement="above"><direction-type><metronome>
              <beat-unit>half</beat-unit><per-minute>92</per-minute>
            </metronome></direction-type></direction>
          </measure></part></score-partwise>`;
        const osmd: OpenSheetMusicDisplay = TestUtils.createOpenSheetMusicDisplay(
            TestUtils.getDivElement(document),
        );
        await osmd.load(xml);
        osmd.render();
        const measure: any = osmd.GraphicSheet.MeasureList[0][0];
        const stave: any = measure.getVFStave();
        const mark: any = stave.getModifiers().find(
            (modifier: any): boolean => modifier.getCategory?.() === "StaveTempo",
        );
        expect(mark).to.not.equal(undefined);
        expect(mark.getBoundingBox().getX()).to.be.closeTo(
            stave.getX() + measure.beginInstructionsWidth * 10,
            1,
        );
    });

    it("keeps sibling tempo words with their metronome mark without deriving playback from the words", async () => {
        const xml: string = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0">
          <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
          <part id="P1"><measure number="1">
            <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
            <direction placement="above">
              <direction-type><metronome parentheses="yes">
                <beat-unit>half</beat-unit><beat-unit-dot/><per-minute>46</per-minute>
              </metronome></direction-type>
              <direction-type><words>Slower</words></direction-type>
              <sound tempo="90"/>
            </direction>
            <note><rest/><duration>4</duration><type>whole</type></note>
          </measure></part>
        </score-partwise>`;
        const osmd: OpenSheetMusicDisplay = TestUtils.createOpenSheetMusicDisplay(
            TestUtils.getDivElement(document),
        );

        await osmd.load(xml);

        const entries: any[] = osmd.Sheet.SourceMeasures[0].TempoExpressions[0].EntriesList;
        const expression: any = entries[0].Expression;
        expect(entries).to.have.length(1);
        expect(expression.isMetronomeMark).to.equal(true);
        expect(expression.metronomeText).to.equal("Slower");
        expect(expression.metronomeParentheses).to.equal(true);
        expect(expression.ExplicitPlaybackTempoInQuarterBpm).to.equal(90);
    });

    it("does not merge tempo words from a separate MusicXML direction into a metronome mark", async () => {
        const xml: string = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0">
          <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
          <part id="P1"><measure number="1">
            <attributes><divisions>1</divisions></attributes>
            <direction><direction-type><words>Andante</words></direction-type></direction>
            <direction><direction-type><metronome>
              <beat-unit>quarter</beat-unit><per-minute>72</per-minute>
            </metronome></direction-type></direction>
            <note><rest/><duration>1</duration><type>quarter</type></note>
          </measure></part>
        </score-partwise>`;
        const osmd: OpenSheetMusicDisplay = TestUtils.createOpenSheetMusicDisplay(
            TestUtils.getDivElement(document),
        );

        await osmd.load(xml);

        const expressions: any[] = osmd.Sheet.SourceMeasures[0].TempoExpressions
            .flatMap((multiTempo: any): any[] => multiTempo.EntriesList.map((entry: any): any => entry.Expression));
        const mark: any = expressions.find((expression: any): boolean => expression.isMetronomeMark);
        expect(mark.metronomeText).to.equal(undefined);
        expect(expressions.some((expression: any): boolean => expression.Label === "Andante")).to.equal(true);
    });

    it("renders multiple timestamped metronome marks in one measure above colliding chords", async () => {
        const xml: string = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0">
          <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
          <part id="P1"><measure number="1">
            <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
              <clef><sign>G</sign><line>2</line></clef></attributes>
            <direction placement="above"><direction-type><words>Slower</words></direction-type>
              <direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>80</per-minute></metronome></direction-type>
            </direction>
            <harmony placement="above"><root><root-step>C</root-step></root><kind>major</kind></harmony>
            <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
            <direction placement="above"><direction-type><metronome>
              <beat-unit>quarter</beat-unit><per-minute>100</per-minute>
            </metronome></direction-type></direction>
            <harmony placement="above"><root><root-step>G</root-step></root><kind>major</kind></harmony>
            <note><pitch><step>G</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
            <note><rest/><duration>2</duration><type>half</type></note>
          </measure></part>
        </score-partwise>`;
        const container: HTMLElement = TestUtils.getDivElement(document);
        const osmd: OpenSheetMusicDisplay = TestUtils.createOpenSheetMusicDisplay(container);

        await osmd.load(xml);
        osmd.render();

        const measure: any = osmd.GraphicSheet.MeasureList[0][0];
        const marks: any[] = measure.getVFStave().getModifiers()
            .filter((modifier: any): boolean => modifier.getCategory?.() === "StaveTempo")
            .sort((left: any, right: any): number => left.getBoundingBox().getX() - right.getBoundingBox().getX());
        const chords: any[] = measure.staffEntries
            .flatMap((staffEntry: any): any[] => staffEntry.graphicalChordContainers)
            .sort((left: any, right: any): number =>
                left.PositionAndShape.AbsolutePosition.x - right.PositionAndShape.AbsolutePosition.x,
            );

        expect(marks).to.have.length(2);
        expect(marks[1].getBoundingBox().getX()).to.be.greaterThan(marks[0].getBoundingBox().getX());
        const secondBeat: any = measure.staffEntries.find(
            (entry: any): boolean => Math.abs(entry.relInMeasureTimestamp.RealValue - 0.25) < 0.000001,
        );
        expect(secondBeat).to.not.equal(undefined);
        expect(marks[1].getBoundingBox().getX()).to.be.closeTo(
            measure.getVFStave().getX() + secondBeat.PositionAndShape.RelativePosition.x * 10,
            1,
        );
        expect(chords).to.have.length(2);
        for (let index: number = 0; index < marks.length; index++) {
            const markBottom: number = marks[index].getBoundingBox().getY() + marks[index].getBoundingBox().getH();
            const chordTop: number = (
                chords[index].PositionAndShape.AbsolutePosition.y +
                chords[index].PositionAndShape.BorderMarginTop
            ) * 10;
            expect(markBottom).to.be.at.most(chordTop - osmd.EngravingRules.TempoYSpacing * 10 + 0.01);
        }
    });

    it("exposes sound and metronome tempos as quarter-BPM without inferring words", async () => {
        const xml: string = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0">
          <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
          <part id="P1">
            <measure number="1">
              <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
              <direction><direction-type><words>Allegro</words></direction-type><sound tempo="92"/></direction>
              <note><rest/><duration>4</duration><type>whole</type></note>
            </measure>
            <measure number="2">
              <direction><direction-type><metronome>
                <beat-unit>eighth</beat-unit><beat-unit-dot/><per-minute>120</per-minute>
              </metronome></direction-type></direction>
              <note><rest/><duration>4</duration><type>whole</type></note>
            </measure>
            <measure number="3">
              <direction><direction-type><words>rit.</words></direction-type></direction>
              <note><rest/><duration>4</duration><type>whole</type></note>
            </measure>
          </part>
        </score-partwise>`;
        const osmd: OpenSheetMusicDisplay = TestUtils.createOpenSheetMusicDisplay(
            TestUtils.getDivElement(document),
        );

        await osmd.load(xml);

        const playbackTempos: number[] = osmd.Sheet.TimestampSortedTempoExpressionsList
            .map(expression => expression.InstantaneousTempo?.ExplicitPlaybackTempoInQuarterBpm)
            .filter(value => Number.isFinite(value));
        expect(playbackTempos).to.deep.equal([92, 90]);
    });

    it("prefers a sound tempo over a display metronome mark", async () => {
        const xml: string = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0">
          <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
          <part id="P1"><measure number="1">
            <attributes><divisions>1</divisions></attributes>
            <direction>
              <direction-type><metronome><beat-unit>half</beat-unit><per-minute>45</per-minute></metronome></direction-type>
              <sound tempo="96"/>
            </direction>
            <note><rest/><duration>1</duration><type>quarter</type></note>
          </measure></part>
        </score-partwise>`;
        const osmd: OpenSheetMusicDisplay = TestUtils.createOpenSheetMusicDisplay(
            TestUtils.getDivElement(document),
        );

        await osmd.load(xml);

        expect(
            osmd.Sheet.TimestampSortedTempoExpressionsList[0]
                .InstantaneousTempo.ExplicitPlaybackTempoInQuarterBpm,
        ).to.equal(96);
    });

    it("reads offset measure-level sound tempos used for gradual playback", async () => {
        const xml: string = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0">
          <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
          <part id="P1"><measure number="1">
            <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
            <note><rest/><duration>16</duration><type>whole</type></note>
            <backup><duration>16</duration></backup>
            <sound tempo="120"/>
            <sound tempo="90"><offset>4</offset></sound>
            <sound tempo="60"><offset>8</offset></sound>
          </measure></part>
        </score-partwise>`;
        const osmd: OpenSheetMusicDisplay = TestUtils.createOpenSheetMusicDisplay(
            TestUtils.getDivElement(document),
        );

        await osmd.load(xml);

        const tempoMap: Array<{ tempo: number, timestamp: number }> =
            osmd.Sheet.TimestampSortedTempoExpressionsList.map(expression => ({
                tempo: expression.InstantaneousTempo?.ExplicitPlaybackTempoInQuarterBpm,
                timestamp: expression.AbsoluteTimestamp.RealValue,
            }));
        expect(tempoMap).to.deep.equal([
            { tempo: 120, timestamp: 0 },
            { tempo: 90, timestamp: 0.25 },
            { tempo: 60, timestamp: 0.5 },
        ]);
    });

    it("normalizes Dorico unfolded offsets against a same-measure gradual marking", async () => {
        const xml: string = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0">
          <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
          <part id="P1">
            <measure number="1">
              <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
              <sound tempo="120"/><note><rest/><duration>16</duration><type>whole</type></note>
            </measure>
            <measure number="2">
              <note><rest/><duration>16</duration><type>whole</type></note><backup><duration>16</duration></backup>
              <sound tempo="110"><offset>385</offset></sound>
              <sound tempo="100"><offset>386</offset></sound>
              <sound tempo="90"><offset>387</offset></sound>
              <sound tempo="80"><offset>388</offset></sound>
              <direction><direction-type><words>allarg.</words></direction-type></direction>
              <forward><duration>16</duration></forward>
            </measure>
          </part>
        </score-partwise>`;
        const osmd: OpenSheetMusicDisplay = TestUtils.createOpenSheetMusicDisplay(
            TestUtils.getDivElement(document),
        );

        await osmd.load(xml);

        expect(explicitTempoMap(osmd)).to.deep.equal([
            { tempo: 120, timestamp: 0 },
            { tempo: 110, timestamp: 17 / 16 },
            { tempo: 100, timestamp: 18 / 16 },
            { tempo: 90, timestamp: 19 / 16 },
            { tempo: 80, timestamp: 20 / 16 },
        ]);
    });

    it("anchors a following-measure Dorico cluster to the preceding gradual marking", async () => {
        const xml: string = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0">
          <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
          <part id="P1">
            <measure number="1">
              <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
              <sound tempo="120"/><note><rest/><duration>8</duration><type>half</type></note>
              <direction><direction-type><words>rit.</words></direction-type></direction>
              <note><rest/><duration>8</duration><type>half</type></note>
            </measure>
            <measure number="2">
              <sound tempo="110"><offset>805</offset></sound>
              <sound tempo="100"><offset>806</offset></sound>
              <sound tempo="90"><offset>807</offset></sound>
              <sound tempo="80"><offset>808</offset></sound>
              <attributes><divisions>4</divisions></attributes>
              <note><rest/><duration>16</duration><type>whole</type></note>
            </measure>
          </part>
        </score-partwise>`;
        const osmd: OpenSheetMusicDisplay = TestUtils.createOpenSheetMusicDisplay(
            TestUtils.getDivElement(document),
        );

        await osmd.load(xml);

        expect(explicitTempoMap(osmd)).to.deep.equal([
            { tempo: 120, timestamp: 0 },
            { tempo: 110, timestamp: 9 / 16 },
            { tempo: 100, timestamp: 10 / 16 },
            { tempo: 90, timestamp: 11 / 16 },
            { tempo: 80, timestamp: 12 / 16 },
        ]);
    });
});

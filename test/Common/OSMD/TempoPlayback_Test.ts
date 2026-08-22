import { expect } from "chai";
import { OpenSheetMusicDisplay } from "../../../src/OpenSheetMusicDisplay/OpenSheetMusicDisplay";
import { TestUtils } from "../../Util/TestUtils";

describe("explicit MusicXML playback tempo", () => {
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
});

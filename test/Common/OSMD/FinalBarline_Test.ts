import { expect } from "chai";
import { OpenSheetMusicDisplay } from "../../../src/OpenSheetMusicDisplay/OpenSheetMusicDisplay";
import { SystemLinesEnum } from "../../../src/MusicalScore/Graphical/SystemLinesEnum";
import * as VF from "../../../src/MusicalScore/Graphical/VexFlow/VexFlowAdapter";
import { TestUtils } from "../../Util/TestUtils";

function score(finalBarline = "", twoMeasures = false): string {
    const firstMeasure: string = `<measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef></attributes>
      <note><rest/><duration>4</duration><type>whole</type></note>
      ${twoMeasures ? "" : finalBarline}
    </measure>`;
    const secondMeasure: string = twoMeasures
        ? `<measure number="2"><note><rest/><duration>4</duration><type>whole</type></note>${finalBarline}</measure>`
        : "";
    return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0">
      <part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list>
      <part id="P1">${firstMeasure}${secondMeasure}</part>
    </score-partwise>`;
}

function endBarType(osmd: OpenSheetMusicDisplay, measureIndex: number): number {
    const measure: any = osmd.GraphicSheet.MeasureList[measureIndex][0];
    return measure.getVFStave().getModifiers()[1].getType();
}

describe("inferred final barline display", (): void => {
    it("draws a final barline only on the actual last source measure without changing parsed style", async (): Promise<void> => {
        const osmd: OpenSheetMusicDisplay = TestUtils.createOpenSheetMusicDisplay(
            TestUtils.getDivElement(document),
        );
        await osmd.load(score("", true));
        expect(osmd.Sheet.SourceMeasures[1].endingBarStyleXml).to.equal("");
        expect(osmd.Sheet.SourceMeasures[1].endingBarStyleEnum).to.equal(SystemLinesEnum.SingleThin);

        osmd.render();
        expect(endBarType(osmd, 0)).to.equal(VF.Barline.type.SINGLE);
        expect(endBarType(osmd, 1)).to.equal(VF.Barline.type.END);
        expect(osmd.Sheet.SourceMeasures[1].endingBarStyleEnum).to.equal(SystemLinesEnum.SingleThin);
    });

    it("preserves authored regular and absent final barline styles", async (): Promise<void> => {
        for (const [style, expected] of [
            ["regular", VF.Barline.type.SINGLE],
            ["none", VF.Barline.type.NONE],
        ] as const) {
            const osmd: OpenSheetMusicDisplay = TestUtils.createOpenSheetMusicDisplay(
                TestUtils.getDivElement(document),
            );
            await osmd.load(score(`<barline location="right"><bar-style>${style}</bar-style></barline>`));
            osmd.render();
            expect(endBarType(osmd, 0)).to.equal(expected);
        }
    });

    it("does not turn the end of an extracted range into the end of the piece", async (): Promise<void> => {
        const osmd: OpenSheetMusicDisplay = TestUtils.createOpenSheetMusicDisplay(
            TestUtils.getDivElement(document),
        );
        await osmd.load(score("", true));
        osmd.setOptions({ drawUpToMeasureNumber: 1 });
        osmd.render();
        expect(endBarType(osmd, 0)).to.equal(VF.Barline.type.SINGLE);
    });

    it("keeps a backward repeat as the last barline", async (): Promise<void> => {
        const osmd: OpenSheetMusicDisplay = TestUtils.createOpenSheetMusicDisplay(
            TestUtils.getDivElement(document),
        );
        await osmd.load(score('<barline location="right"><repeat direction="backward"/></barline>'));
        osmd.render();
        expect(endBarType(osmd, 0)).to.equal(VF.Barline.type.REPEAT_END);
    });
});

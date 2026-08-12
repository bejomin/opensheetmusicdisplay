import { expect } from "chai";
import { resolveFingeringPlacement } from "../../../src/MusicalScore/Graphical/FingeringPlacement";
import { PlacementEnum } from "../../../src/MusicalScore/VoiceData/Expressions/AbstractExpression";

describe("Fingering placement", (): void => {
    it("uses a left notehead column for automatic chord and multi-voice fingerings", (): void => {
        expect(resolveFingeringPlacement(
            PlacementEnum.NotYetDefined,
            PlacementEnum.NotYetDefined,
            PlacementEnum.Above,
            true,
        )).to.equal(PlacementEnum.Left);
    });

    it("keeps automatic single-note fingerings on their normal staff side", (): void => {
        expect(resolveFingeringPlacement(
            PlacementEnum.NotYetDefined,
            PlacementEnum.NotYetDefined,
            PlacementEnum.Below,
            false,
        )).to.equal(PlacementEnum.Below);
    });

    it("preserves explicit MusicXML placement in automatic mode", (): void => {
        expect(resolveFingeringPlacement(
            PlacementEnum.Above,
            PlacementEnum.NotYetDefined,
            PlacementEnum.Below,
            true,
        )).to.equal(PlacementEnum.Above);
        expect(resolveFingeringPlacement(
            PlacementEnum.Below,
            PlacementEnum.NotYetDefined,
            PlacementEnum.Above,
            true,
        )).to.equal(PlacementEnum.Below);
    });

    it("retains the legacy above-or-below policy unless automatic mode is requested", (): void => {
        expect(resolveFingeringPlacement(
            PlacementEnum.NotYetDefined,
            PlacementEnum.AboveOrBelow,
            PlacementEnum.Above,
            true,
        )).to.equal(PlacementEnum.Above);
    });
});

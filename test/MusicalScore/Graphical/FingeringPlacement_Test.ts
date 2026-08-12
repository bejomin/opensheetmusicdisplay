import { expect } from "chai";
import {
    FingeringInstructionGroup,
    groupFingeringSubstitutions,
    resolveFingeringPlacement,
} from "../../../src/MusicalScore/Graphical/FingeringPlacement";
import { PlacementEnum } from "../../../src/MusicalScore/VoiceData/Expressions/AbstractExpression";
import { TechnicalInstruction } from "../../../src/MusicalScore/VoiceData/Instructions/TechnicalInstruction";
import { Note } from "../../../src/MusicalScore/VoiceData/Note";

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

    it("groups authored fingering substitutions without reversing their XML order", (): void => {
        const firstNote: Note = {} as Note;
        const secondNote: Note = {} as Note;
        const fingering: (value: string, sourceNote: Note, substitution?: boolean) => TechnicalInstruction =
            (value: string, sourceNote: Note, substitution: boolean = false): TechnicalInstruction => ({
                value,
                sourceNote,
                substitution,
            } as TechnicalInstruction);
        const groups: FingeringInstructionGroup[] = groupFingeringSubstitutions([
            fingering("2", firstNote),
            fingering("1", firstNote, true),
            fingering("3", firstNote, true),
            fingering("5", secondNote),
        ]);

        expect(groups).to.have.length(2);
        expect(groups[0].instructions.map((entry: TechnicalInstruction): string => entry.value))
            .to.deep.equal(["2", "1", "3"]);
        expect(groups[0].isSubstitution).to.equal(true);
        expect(groups[1].isSubstitution).to.equal(false);
    });

    it("does not attach a malformed leading substitution to another note", (): void => {
        const firstNote: Note = {} as Note;
        const secondNote: Note = {} as Note;
        const groups: FingeringInstructionGroup[] = groupFingeringSubstitutions([
            { value: "4", sourceNote: firstNote, substitution: false } as TechnicalInstruction,
            { value: "2", sourceNote: secondNote, substitution: true } as TechnicalInstruction,
        ]);

        expect(groups).to.have.length(2);
        expect(groups[1].instructions.map((entry: TechnicalInstruction): string => entry.value))
            .to.deep.equal(["2"]);
        expect(groups[1].isSubstitution).to.equal(false);
    });
});

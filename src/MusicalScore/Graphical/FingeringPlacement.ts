import { PlacementEnum } from "../VoiceData/Expressions/AbstractExpression";
import { TechnicalInstruction } from "../VoiceData/Instructions/TechnicalInstruction";
import { Note } from "../VoiceData/Note";

export type FingeringInstructionGroup = {
    instructions: TechnicalInstruction[];
    sourceNote: Note;
    isSubstitution: boolean;
};

/** Group each `substitution="yes"` instruction with the preceding fingering
 * on the same note, retaining the authored left-to-right XML order. */
export function groupFingeringSubstitutions(
    fingerings: TechnicalInstruction[],
): FingeringInstructionGroup[] {
    const groups: FingeringInstructionGroup[] = [];
    for (const fingering of fingerings) {
        const previous: FingeringInstructionGroup = groups[groups.length - 1];
        if (fingering.substitution && previous?.sourceNote === fingering.sourceNote) {
            previous.instructions.push(fingering);
            previous.isSubstitution = true;
            continue;
        }
        groups.push({
            instructions: [fingering],
            sourceNote: fingering.sourceNote,
            isSubstitution: false,
        });
    }
    return groups;
}

function isSpecificPlacement(placement: PlacementEnum | undefined): boolean {
    return placement === PlacementEnum.Above ||
        placement === PlacementEnum.Below ||
        placement === PlacementEnum.Left ||
        placement === PlacementEnum.Right;
}

/**
 * Resolve a fingering's rendered position without losing MusicXML's distinction
 * between explicit above/below placement and application-defined placement.
 *
 * `Auto` (`NotYetDefined`) keeps a single melodic fingering above/below its
 * staff, while chords and simultaneous voices use the conventional column to
 * the left of their noteheads. `AboveOrBelow` deliberately retains OSMD's
 * legacy staff-side behaviour.
 */
export function resolveFingeringPlacement(
    sourcePlacement: PlacementEnum | undefined,
    configuredPlacement: PlacementEnum,
    staffSidePlacement: PlacementEnum,
    hasChordOrMultipleVoices: boolean,
): PlacementEnum {
    if (isSpecificPlacement(sourcePlacement)) {
        return sourcePlacement;
    }
    if (isSpecificPlacement(configuredPlacement)) {
        return configuredPlacement;
    }
    if (configuredPlacement === PlacementEnum.NotYetDefined && hasChordOrMultipleVoices) {
        return PlacementEnum.Left;
    }
    return staffSidePlacement;
}

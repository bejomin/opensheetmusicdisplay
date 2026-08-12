import { PlacementEnum } from "../VoiceData/Expressions/AbstractExpression";
import { Note } from "../VoiceData/Note";
import { Label } from "../Label";
import { TextAlignmentEnum } from "../../Common/Enums/TextAlignment";
import { BoundingBox } from "./BoundingBox";
import { EngravingRules } from "./EngravingRules";
import { GraphicalLabel } from "./GraphicalLabel";

/**
 * A skyline-aware fingering label anchored to one source note. Substitution
 * groups are represented by one horizontal label plus a shallow arc on the
 * placement side, so their complete geometry can participate in collision
 * layout as one object.
 */
export class GraphicalFingeringEntry extends GraphicalLabel {
    public static readonly SubstitutionArcGap: number = 0.08;
    public static readonly SubstitutionArcHeight: number = 0.28;
    public static readonly SubstitutionArcThickness: number = 0.07;
    public SubstitutionArcSVGNode: Node;
    public readonly SourceNote: Note;
    public readonly Placement: PlacementEnum;
    public readonly IsSubstitution: boolean;

    constructor(
        label: Label,
        textHeight: number,
        alignment: TextAlignmentEnum,
        rules: EngravingRules,
        parent: BoundingBox,
        sourceNote: Note,
        placement: PlacementEnum,
        isSubstitution: boolean,
    ) {
        super(label, textHeight, alignment, rules, parent);
        this.SourceNote = sourceNote;
        this.Placement = placement;
        this.IsSubstitution = isSubstitution;
    }

    /** Reserve the substitution arc in the same skyline/bottomline bounds as
     * its digit group. Call after GraphicalLabel has measured the text. */
    public includeSubstitutionArcInBounds(): void {
        if (!this.IsSubstitution) {
            return;
        }
        const arcExtent: number = GraphicalFingeringEntry.SubstitutionArcGap +
            GraphicalFingeringEntry.SubstitutionArcHeight +
            GraphicalFingeringEntry.SubstitutionArcThickness;
        if (this.Placement === PlacementEnum.Above) {
            this.PositionAndShape.BorderTop -= arcExtent;
            this.PositionAndShape.BorderMarginTop -= arcExtent;
        } else if (this.Placement === PlacementEnum.Below) {
            this.PositionAndShape.BorderBottom += arcExtent;
            this.PositionAndShape.BorderMarginBottom += arcExtent;
        }
    }
}

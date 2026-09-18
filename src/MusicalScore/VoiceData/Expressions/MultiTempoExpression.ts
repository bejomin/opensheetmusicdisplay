import {Fraction} from "../../../Common/DataObjects/Fraction";
import {SourceMeasure} from "../SourceMeasure";
import {InstantaneousTempoExpression} from "./InstantaneousTempoExpression";
import {PlacementEnum} from "./AbstractExpression";
import {FontStyles} from "../../../Common/Enums/FontStyles";
import {AbstractTempoExpression} from "./AbstractTempoExpression";
import {ContinuousTempoExpression} from "./ContinuousExpressions/ContinuousTempoExpression";

export class MultiTempoExpression {

    /** Identify engraving text that may anchor an adjacent numeric tempo curve.
     * This classification must never create or calculate a playback tempo.
     */
    public static isGradualTempoText(input: string): boolean {
        const text: string = input?.toLowerCase().replace(/\s+/g, " ").trim();
        if (!text) {
            return false;
        }
        const terms: string[] = [
            "accelerando", "accel", "piu mosso", "poco piu", "stretto",
            "poco meno", "meno mosso", "piu lento", "calando", "allargando", "allarg",
            "rallentando", "rall", "ritardando", "ritard", "ritenuto", "riten", "rit",
        ];
        return terms.some(term => {
            const pattern: string = term.replace(/\s+/g, "\\s+");
            return new RegExp(`(?:^|\\s)${pattern}(?:\\.|\\s|$)`).test(text);
        });
    }

    constructor(sourceMeasure: SourceMeasure, timestamp: Fraction) {
        this.sourceMeasure = sourceMeasure;
        this.timestamp = timestamp;
    }

    private timestamp: Fraction;
    private sourceMeasure: SourceMeasure;
    private instantaneousTempo: InstantaneousTempoExpression;
    private continuousTempo: ContinuousTempoExpression;
    private expressions: TempoExpressionEntry[] = [];
    private combinedExpressionsText: string;
    private standaloneSoundTempo: StandaloneSoundTempo;

    public get Timestamp(): Fraction {
        return this.timestamp;
    }
    public set Timestamp(value: Fraction) {
        this.timestamp = value;
    }
    public get AbsoluteTimestamp(): Fraction {
        return Fraction.plus(this.sourceMeasure.AbsoluteTimestamp, this.timestamp);
    }
    public get SourceMeasureParent(): SourceMeasure {
        return this.sourceMeasure;
    }
    public set SourceMeasureParent(value: SourceMeasure) {
        this.sourceMeasure = value;
    }
    public get InstantaneousTempo(): InstantaneousTempoExpression {
        return this.instantaneousTempo;
    }
    public get ContinuousTempo(): ContinuousTempoExpression {
        return this.continuousTempo;
    }
    public get EntriesList(): TempoExpressionEntry[] {
        return this.expressions;
    }
    public get CombinedExpressionsText(): string {
        return this.combinedExpressionsText;
    }
    public set CombinedExpressionsText(value: string) {
        this.combinedExpressionsText = value;
    }
    public get StandaloneSoundTempo(): StandaloneSoundTempo {
        return this.standaloneSoundTempo;
    }
    public set StandaloneSoundTempo(value: StandaloneSoundTempo) {
        this.standaloneSoundTempo = value;
    }
    public getPlacementOfFirstEntry(): PlacementEnum {
        let placement: PlacementEnum = PlacementEnum.Above;
        if (this.expressions.length > 0) {
            if (this.expressions[0].Expression instanceof InstantaneousTempoExpression) {
                placement = (<InstantaneousTempoExpression>(this.expressions[0].Expression)).Placement;
            } else if (this.expressions[0].Expression instanceof ContinuousTempoExpression) {
                placement = (<ContinuousTempoExpression>(this.expressions[0].Expression)).Placement;
            }
        }
        return placement;
    }
    public getFontstyleOfFirstEntry(): FontStyles {
        let fontStyle: FontStyles = FontStyles.Regular;
        if (this.expressions[0].Expression instanceof InstantaneousTempoExpression) {
            fontStyle = FontStyles.Bold;
        } else if (this.expressions[0].Expression instanceof ContinuousTempoExpression) {
            fontStyle = FontStyles.Italic;
        }
        return fontStyle;
    }
    //public getFirstEntry(graphicalLabel: GraphicalLabel): AbstractGraphicalExpression {
    //    let indexOfFirstNotInstDynExpr: number = 0;
    //    if (this.expressions.length > 0) {
    //        if (this.expressions[indexOfFirstNotInstDynExpr].Expression instanceof InstantaneousTempoExpression)
    //            return new GraphicalInstantaneousTempoExpression(
    // <InstantaneousTempoExpression>(this.expressions[indexOfFirstNotInstDynExpr].Expression), graphicalLabel);
    //        else if (this.expressions[indexOfFirstNotInstDynExpr].Expression instanceof ContinuousTempoExpression)
    //            return new GraphicalContinuousTempoExpression(
    // <ContinuousTempoExpression>(this.expressions[indexOfFirstNotInstDynExpr].Expression), graphicalLabel);
    //        else return undefined;
    //    }
    //    return undefined;
    //}
    public addExpression(abstractTempoExpression: AbstractTempoExpression, prefix: string): void {
        if (this.checkIfAlreadyExists(abstractTempoExpression)) {
            return;
        }

        if (abstractTempoExpression instanceof InstantaneousTempoExpression) {
            this.instantaneousTempo = <InstantaneousTempoExpression>abstractTempoExpression;
        } else if (abstractTempoExpression instanceof ContinuousTempoExpression) {
            this.continuousTempo = <ContinuousTempoExpression>abstractTempoExpression;
        }
        const tempoExpressionEntry: TempoExpressionEntry = new TempoExpressionEntry();
        tempoExpressionEntry.prefix = prefix;
        tempoExpressionEntry.Expression = abstractTempoExpression;
        tempoExpressionEntry.label = abstractTempoExpression.Label;
        this.expressions.push(tempoExpressionEntry);
    }
    public CompareTo(other: MultiTempoExpression): number {
        if (this.Timestamp.RealValue > other.Timestamp.RealValue) {
            return 1;
        }
        if (this.Timestamp.RealValue < other.Timestamp.RealValue) {
            return -1;
        } else {
            return 0;
        }
    }

    private checkIfAlreadyExists(abstractTempoExpression: AbstractTempoExpression ): boolean {
        for (const entry of this.expressions) {
            if (entry.label === abstractTempoExpression.Label) {
                return true;
            }
        }

        return false;
    }

    public clearInstantaneousTempo(): void {
        this.instantaneousTempo = undefined;
    }

    public clearContinuousTempo(): void {
        this.continuousTempo = undefined;
    }
}

/** Source metadata needed to distinguish ordinary MusicXML offsets from
 * Dorico's unfolded-playback offsets for hidden gradual-tempo steps.
 */
export interface StandaloneSoundTempo {
    cursorTimestamp: Fraction;
    divisions: number;
    offsetDivisions: number;
    sourceOrder: number;
}

export class TempoExpressionEntry {
    public prefix: string;
    protected expression: AbstractTempoExpression;
    public label: string;

    public get Expression(): AbstractTempoExpression {
        return this.expression;
    }

    public set Expression(value: AbstractTempoExpression) {
        this.expression = value;
    }
}

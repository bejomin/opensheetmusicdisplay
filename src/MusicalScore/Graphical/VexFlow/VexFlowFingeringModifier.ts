import * as VF from "./VexFlowAdapter";

interface LeftFingeringPlacement {
    modifier: VexFlowFingeringModifier;
    desiredBaseline: number;
    baseline: number;
    ascent: number;
    descent: number;
}

/**
 * VexFlow-backed fingering used by side fingerings and by grace notes.
 *
 * Ordinary above/below fingerings use OSMD graphical labels so they can take
 * part in skyline layout. Grace notes remain VexFlow modifiers because every
 * grace voice owns an independently scaled and horizontally positioned note.
 */
export class VexFlowFingeringModifier extends VF.FretHandFinger {
    private static readonly StaffKnockoutColor: string = "#FFFFFF";
    private static readonly StaffKnockoutRadiusPx: number = 3;
    private static readonly LeftColumnMinimumVerticalGapPx: number = 1.25;
    private readonly substitution: boolean;
    private noteheadClearancePx: number = 0;

    constructor(fingeringText: string, substitution: boolean = false) {
        super(fingeringText);
        this.substitution = substitution;
    }

    public get IsSubstitution(): boolean {
        return this.substitution;
    }

    /** Reserve and draw a fixed gap between a side fingering and its notehead.
     * Keep this separate from VexFlow's measured glyph width: text metrics can
     * be recalculated after font changes, but the engraving clearance must not
     * disappear with them. */
    public setNoteheadClearance(clearancePx: number): this {
        this.noteheadClearancePx = Math.max(0, clearancePx);
        return this;
    }

    public override getWidth(): number {
        return super.getWidth() + this.noteheadClearancePx;
    }

    public override draw(): void {
        const ctx: VF.RenderContext = this.checkContext();
        const note: VF.Note = this.checkAttachedNote();
        const index: number = this.checkIndex();
        this.setRendered();

        const start: {x: number, y: number} = note.getModifierStartXY(this.position, index);
        const textMetrics: TextMetrics = this.measureText();
        const textWidth: number = textMetrics.width;
        let textX: number = start.x + this.xOffset;
        let textY: number = start.y + this.yOffset + 5;

        switch (this.position) {
            case VF.Modifier.Position.ABOVE:
            case VF.Modifier.Position.BELOW: {
                const staveNote: VF.StaveNote = note as VF.StaveNote;
                const bounds: VF.BoundingBox = staveNote.getNoteHeadBoundingBox?.(index);
                const centerX: number = bounds
                    ? bounds.getX() + bounds.getW() / 2
                    : start.x;
                textX = centerX - textWidth / 2 + this.xOffset;
                const ys: number[] = note.getYs();
                const above: boolean = this.position === VF.Modifier.Position.ABOVE;
                let notationEdgeY: number = above ? Math.min(...ys) : Math.max(...ys);
                const stemmableNote: VF.StemmableNote = note as VF.StemmableNote;
                if (stemmableNote.hasStem?.()) {
                    const stemDirection: number = stemmableNote.getStemDirection();
                    const stemExtents: {topY: number, baseY: number} = stemmableNote.checkStem().getExtents();
                    if (above && stemDirection === VF.Stem.UP) {
                        notationEdgeY = Math.min(notationEdgeY, stemExtents.topY);
                    } else if (!above && stemDirection === VF.Stem.DOWN) {
                        notationEdgeY = Math.max(notationEdgeY, stemExtents.baseY);
                    }
                }
                const ascent: number = textMetrics.actualBoundingBoxAscent ?? this.getHeight() * 0.8;
                const descent: number = textMetrics.actualBoundingBoxDescent ?? this.getHeight() * 0.2;
                textY = above
                    ? notationEdgeY - 3 - descent + this.yOffset
                    : notationEdgeY + 3 + ascent + this.yOffset;
                break;
            }
            case VF.Modifier.Position.LEFT:
                textX -= this.width + this.noteheadClearancePx;
                textY = this.getLeftColumnTextY(note);
                break;
            case VF.Modifier.Position.RIGHT:
                textX += 1;
                break;
            default:
                return;
        }

        if (this.position === VF.Modifier.Position.LEFT && this.overlapsStaff(note, textY, textMetrics)) {
            this.drawStaffLineKnockout(ctx, textX, textY);
        }
        this.renderText(ctx, textX, textY);
        if (this.substitution &&
            (this.position === VF.Modifier.Position.ABOVE || this.position === VF.Modifier.Position.BELOW)) {
            this.drawSubstitutionArc(ctx, textX, textY, textWidth, textMetrics);
        }
    }

    /** Resolve only actual vertical glyph collisions after VexFlow has placed
     * each left fingering against its selected notehead. The whole column is
     * then recentered, so the correction is shared rather than accumulating at
     * its lower end. */
    private getLeftColumnTextY(note: VF.Note): number {
        const siblings: VexFlowFingeringModifier[] = note.getModifiers()
            .filter((modifier: VF.Modifier): modifier is VexFlowFingeringModifier =>
                modifier instanceof VexFlowFingeringModifier &&
                modifier.getPosition() === VF.Modifier.Position.LEFT,
            );
        if (siblings.length < 2) {
            return note.getModifierStartXY(this.position, this.checkIndex()).y + this.yOffset + 5;
        }

        const placements: LeftFingeringPlacement[] = siblings.map((modifier: VexFlowFingeringModifier) => {
            const metrics: TextMetrics = modifier.measureText();
            const desiredBaseline: number = note.getModifierStartXY(
                modifier.getPosition(),
                modifier.checkIndex(),
            ).y + modifier.yOffset + 5;
            return {
                modifier,
                desiredBaseline,
                baseline: desiredBaseline,
                ascent: metrics.actualBoundingBoxAscent ?? modifier.getHeight() * 0.8,
                descent: metrics.actualBoundingBoxDescent ?? modifier.getHeight() * 0.2,
            };
        }).sort((left, right): number => left.desiredBaseline - right.desiredBaseline);

        for (let index: number = 1; index < placements.length; index++) {
            const previous: LeftFingeringPlacement = placements[index - 1];
            const current: LeftFingeringPlacement = placements[index];
            const minimumBaseline: number = previous.baseline + previous.descent +
                VexFlowFingeringModifier.LeftColumnMinimumVerticalGapPx + current.ascent;
            current.baseline = Math.max(current.baseline, minimumBaseline);
        }

        const desiredTop: number = Math.min(...placements.map((placement): number =>
            placement.desiredBaseline - placement.ascent));
        const desiredBottom: number = Math.max(...placements.map((placement): number =>
            placement.desiredBaseline + placement.descent));
        const adjustedTop: number = Math.min(...placements.map((placement): number =>
            placement.baseline - placement.ascent));
        const adjustedBottom: number = Math.max(...placements.map((placement): number =>
            placement.baseline + placement.descent));
        const recenter: number = (adjustedTop + adjustedBottom - desiredTop - desiredBottom) / 2;
        const ownPlacement: LeftFingeringPlacement = placements.find(
            (placement: LeftFingeringPlacement): boolean => placement.modifier === this,
        );
        return ownPlacement.baseline - recenter;
    }

    private overlapsStaff(note: VF.Note, baselineY: number, metrics: TextMetrics): boolean {
        const stave: VF.Stave = note.getStave?.();
        if (!stave) {
            return false;
        }
        const firstLineY: number = stave.getYForLine(0);
        const lastLineY: number = stave.getYForLine(stave.getNumLines() - 1);
        const top: number = Math.min(firstLineY, lastLineY);
        const bottom: number = Math.max(firstLineY, lastLineY);
        const glyphTop: number = baselineY - (metrics.actualBoundingBoxAscent ?? this.getHeight() * 0.8);
        const glyphBottom: number = baselineY + (metrics.actualBoundingBoxDescent ?? this.getHeight() * 0.2);
        return glyphBottom >= top && glyphTop <= bottom;
    }

    /** Paint the glyph a fraction of a pixel in every direction before the
     * foreground pass. This erases staff lines around the digit's outline
     * without introducing a visible rectangular patch. */
    private drawStaffLineKnockout(ctx: VF.RenderContext, x: number, y: number): void {
        const radius: number = VexFlowFingeringModifier.StaffKnockoutRadiusPx;
        const offsets: [number, number][] = [
            [-radius, 0], [radius, 0], [0, -radius], [0, radius],
            [-radius, -radius], [-radius, radius], [radius, -radius], [radius, radius],
        ];
        ctx.save();
        ctx.setFillStyle(VexFlowFingeringModifier.StaffKnockoutColor);
        for (const [dx, dy] of offsets) {
            this.renderText(ctx, x + dx, y + dy);
        }
        ctx.restore();
    }

    private drawSubstitutionArc(
        ctx: VF.RenderContext,
        x: number,
        baselineY: number,
        width: number,
        metrics: TextMetrics,
    ): void {
        const inset: number = Math.min(1, width * 0.08);
        const left: number = x + inset;
        const right: number = x + width - inset;
        if (right <= left) {
            return;
        }
        const above: boolean = this.position === VF.Modifier.Position.ABOVE;
        const ascent: number = metrics.actualBoundingBoxAscent ?? this.getHeight() * 0.8;
        const descent: number = metrics.actualBoundingBoxDescent ?? this.getHeight() * 0.2;
        const endY: number = above
            ? baselineY - ascent - 1
            : baselineY + descent + 1;
        const apexY: number = endY + (above ? -2.6 : 2.6);

        ctx.save();
        ctx.strokeStyle = ctx.fillStyle;
        ctx.setLineWidth(0.75);
        ctx.beginPath();
        ctx.moveTo(left, endY);
        ctx.bezierCurveTo(
            left + (right - left) * 0.22,
            apexY,
            right - (right - left) * 0.22,
            apexY,
            right,
            endY,
        );
        ctx.stroke();
        ctx.restore();
    }
}

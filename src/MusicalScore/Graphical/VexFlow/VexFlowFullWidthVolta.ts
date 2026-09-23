import * as VF from "./VexFlowAdapter";

/**
 * VexFlow starts a volta after the stave's leading modifiers. On a continued
 * system this leaves a visible break whenever the first-ending measure also
 * changes time signature (Sea-fever, bar 14). A volta spans measure boundaries,
 * so its horizontal rule must cover the complete stave width instead.
 */
export class VexFlowFullWidthVolta extends VF.Volta {
    public override draw(): void {
        const stave: VF.Stave = this.checkStave();
        const ctx: VF.RenderContext = stave.checkContext();
        this.setRendered();

        const x: number = stave.getX();
        let width: number = stave.getWidth();
        const topY: number = stave.getYForTopText(stave.getNumLines()) + this.yShift;
        const vertHeight: number = 1.5 * stave.getSpacingBetweenLines();
        switch (this.type) {
            case VF.Volta.type.BEGIN:
                ctx.fillRect(x, topY, 1, vertHeight);
                break;
            case VF.Volta.type.END:
                width -= 5;
                ctx.fillRect(x + width, topY, 1, vertHeight);
                break;
            case VF.Volta.type.BEGIN_END:
                width -= 3;
                ctx.fillRect(x, topY, 1, vertHeight);
                ctx.fillRect(x + width, topY, 1, vertHeight);
                break;
            default:
                break;
        }
        if (this.type === VF.Volta.type.BEGIN || this.type === VF.Volta.type.BEGIN_END) {
            this.renderText(ctx, x + 5, topY - this.yShift + 15);
        }
        ctx.fillRect(x, topY, width, 1);
    }
}

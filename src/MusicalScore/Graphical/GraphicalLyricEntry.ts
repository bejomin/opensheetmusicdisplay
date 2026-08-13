import {
    LyricAlignmentMode,
    LyricRole,
    LyricsEntry,
} from "../VoiceData/Lyrics/LyricsEntry";
import {GraphicalLyricWord} from "./GraphicalLyricWord";
import {GraphicalLabel} from "./GraphicalLabel";
import {GraphicalStaffEntry} from "./GraphicalStaffEntry";
import {Label} from "../Label";
import {PointF2D} from "../../Common/DataObjects/PointF2D";
import {TextAlignmentEnum} from "../../Common/Enums/TextAlignment";
import { EngravingRules } from "./EngravingRules";
import { BoundingBox } from "./BoundingBox";

export interface LyricFootprint {
    anchorX: number;
    labelWidth: number;
    leftEdgeX: number;
    leftExtent: number;
    rightEdgeX: number;
    rightExtent: number;
}

/**
 * The graphical counterpart of a [[LyricsEntry]]
 */
export class GraphicalLyricEntry {
    private lyricsEntry: LyricsEntry;
    private graphicalLyricWord: GraphicalLyricWord;
    private graphicalLabel: GraphicalLabel;
    private graphicalStanzaNumberLabel: GraphicalLabel;
    private displayStanzaNumberPrefix: string = "";
    private graphicalStaffEntry: GraphicalStaffEntry;
    private rules: EngravingRules;

    constructor(lyricsEntry: LyricsEntry, graphicalStaffEntry: GraphicalStaffEntry, lyricsHeight: number, staffHeight: number) {
        this.lyricsEntry = lyricsEntry;
        this.graphicalStaffEntry = graphicalStaffEntry;
        this.rules = this.graphicalStaffEntry.parentMeasure.parentSourceMeasure.Rules;
        const rules: EngravingRules = this.rules;
        const lyricsTextAlignment: TextAlignmentEnum =
            lyricsEntry.AlignmentMode === LyricAlignmentMode.MelismaLeft
                ? TextAlignmentEnum.LeftBottom
                : rules.LyricsAlignmentStandard;
        const label: Label = new Label(lyricsEntry.LyricText);
        label.fontStyle = lyricsEntry.FontStyle;
        this.graphicalLabel = new GraphicalLabel(
            label,
            lyricsHeight,
            lyricsTextAlignment,
            rules,
            graphicalStaffEntry.PositionAndShape,
        );
        this.graphicalLabel.Label.colorDefault = rules.DefaultColorLyrics; // if undefined, no change. saves an if check
        this.graphicalLabel.PositionAndShape.RelativePosition = new PointF2D(0, staffHeight);
        if (lyricsTextAlignment === TextAlignmentEnum.CenterBottom) {
            this.graphicalLabel.SvgTextAnchor = "middle";
        } else if (lyricsTextAlignment === TextAlignmentEnum.LeftBottom) {
            this.graphicalLabel.SvgTextAnchor = "start";
        }
        this.copyLyricMetadata(this.graphicalLabel);
        this.graphicalLabel.setLabelPositionAndShapeBorders(); // needed to have Size.width
    }

    /**
     * Apply a renderer-derived stanza number without changing the MusicXML lyric.
     * The number hangs left of the body, whose note-relative anchor remains stable.
     */
    public setDisplayStanzaNumberPrefix(stanzaNumberPrefix: string): void {
        const prefix: string = stanzaNumberPrefix || "";
        this.displayStanzaNumberPrefix = prefix;
        if (!prefix) {
            this.graphicalStanzaNumberLabel = undefined;
            return;
        }
        const label: Label = new Label(prefix.trimEnd(), TextAlignmentEnum.RightBottom);
        label.font = this.graphicalLabel.Label.font;
        label.fontFamily = this.graphicalLabel.Label.fontFamily;
        label.fontStyle = this.graphicalLabel.Label.fontStyle;
        label.colorDefault = this.graphicalLabel.Label.colorDefault;
        this.graphicalStanzaNumberLabel = new GraphicalLabel(
            label,
            this.graphicalLabel.Label.fontHeight,
            TextAlignmentEnum.RightBottom,
            this.rules,
            this.graphicalStaffEntry.PositionAndShape,
        );
        this.graphicalStanzaNumberLabel.SvgTextAnchor = "end";
        this.copyLyricMetadata(this.graphicalStanzaNumberLabel);
        this.graphicalStanzaNumberLabel.setLabelPositionAndShapeBorders();
        this.positionStanzaNumberImmediatelyBeforeBody();
    }

    /** Align this entry's generated number to a staff-line-relative column. */
    public setStanzaNumberColumnRight(columnRight: number, staffEntryXPosition: number): void {
        if (!this.graphicalStanzaNumberLabel) {
            return;
        }
        this.graphicalStanzaNumberLabel.PositionAndShape.RelativePosition = new PointF2D(
            columnRight - staffEntryXPosition,
            this.graphicalLabel.PositionAndShape.RelativePosition.y,
        );
    }

    private positionStanzaNumberImmediatelyBeforeBody(): void {
        if (!this.graphicalStanzaNumberLabel) {
            return;
        }
        const bodyBox: BoundingBox = this.graphicalLabel.PositionAndShape;
        this.graphicalStanzaNumberLabel.PositionAndShape.RelativePosition = new PointF2D(
            bodyBox.RelativePosition.x + bodyBox.BorderLeft - this.rules.LyricsStanzaNumberGap,
            bodyBox.RelativePosition.y,
        );
    }

    private copyLyricMetadata(label: GraphicalLabel): void {
        label.LyricLineIdentity = this.getLineIdentity();
        label.LyricFamilyIdentity = this.getFamilyIdentity();
        label.LyricRole = this.getLyricRole();
    }

    public hasDashFromLyricWord(): boolean {
        if (!this.ParentLyricWord) {
            return false;
        }
        const lyricWordIndex: number = this.ParentLyricWord.GraphicalLyricsEntries.indexOf(this);
        return this.ParentLyricWord.GraphicalLyricsEntries.length > 1 && lyricWordIndex < this.ParentLyricWord.GraphicalLyricsEntries.length - 1;
    }

    public get LyricsEntry(): LyricsEntry {
        return this.lyricsEntry;
    }
    public get ParentLyricWord(): GraphicalLyricWord {
        return this.graphicalLyricWord;
    }
    public set ParentLyricWord(value: GraphicalLyricWord) {
        this.graphicalLyricWord = value;
    }
    public get GraphicalLabel(): GraphicalLabel {
        return this.graphicalLabel;
    }
    public set GraphicalLabel(value: GraphicalLabel) {
        this.graphicalLabel = value;
    }
    public get GraphicalStanzaNumberLabel(): GraphicalLabel {
        return this.graphicalStanzaNumberLabel;
    }
    public get DisplayStanzaNumberPrefix(): string {
        return this.displayStanzaNumberPrefix;
    }
    public get StaffEntryParent(): GraphicalStaffEntry {
        return this.graphicalStaffEntry;
    }
    public set StaffEntryParent(value: GraphicalStaffEntry) {
        this.graphicalStaffEntry = value;
    }

    public getAnchorX(staffEntryXPosition: number = 0): number {
        return staffEntryXPosition + this.graphicalLabel.PositionAndShape.RelativePosition.x;
    }

    public getFootprint(staffEntryXPosition: number = 0): LyricFootprint {
        const body: LyricFootprint = this.getBodyFootprint(staffEntryXPosition);
        const stanzaBox: BoundingBox = this.graphicalStanzaNumberLabel?.PositionAndShape;
        const stanzaAnchorX: number = staffEntryXPosition + (stanzaBox?.RelativePosition.x ?? 0);
        const leftEdgeX: number = stanzaBox
            ? Math.min(body.leftEdgeX, stanzaAnchorX + stanzaBox.BorderLeft)
            : body.leftEdgeX;
        const rightEdgeX: number = stanzaBox
            ? Math.max(body.rightEdgeX, stanzaAnchorX + stanzaBox.BorderRight)
            : body.rightEdgeX;
        return {
            anchorX: body.anchorX,
            labelWidth: rightEdgeX - leftEdgeX,
            leftEdgeX,
            leftExtent: body.anchorX - leftEdgeX,
            rightEdgeX,
            rightExtent: rightEdgeX - body.anchorX,
        };
    }

    /** The lyric body's footprint, excluding a hanging literal stanza prefix. */
    public getBodyFootprint(staffEntryXPosition: number = 0): LyricFootprint {
        const anchorX: number = this.getAnchorX(staffEntryXPosition);
        const boundingBox: BoundingBox = this.graphicalLabel.PositionAndShape;
        const leftEdgeX: number = anchorX + boundingBox.BorderLeft;
        const rightEdgeX: number = anchorX + boundingBox.BorderRight;
        return {
            anchorX,
            labelWidth: rightEdgeX - leftEdgeX,
            leftEdgeX,
            leftExtent: anchorX - leftEdgeX,
            rightEdgeX,
            rightExtent: rightEdgeX - anchorX,
        };
    }

    /**
     * Stable identity for the lyric line this entry belongs to.
     *
     * A positional array index is not stable when a timestamp omits one or more
     * verses, and a chorus may share a numeric MusicXML verse identifier with a
     * regular verse. Keep both concerns explicit in the key.
     */
    public getLineIdentity(): string {
        return this.lyricsEntry.LyricLineIdentity;
    }

    public getFamilyIdentity(): string {
        return this.lyricsEntry.LyricFamilyIdentity;
    }

    public getLyricRole(): LyricRole {
        return this.lyricsEntry.LyricRole;
    }

    /** Measure a rendered lyric dash using this entry's actual lyric font. */
    public getDashWidth(): number {
        const sourceLabel: Label = this.graphicalLabel.Label;
        const dashLabel: Label = new Label(
            "-",
            TextAlignmentEnum.CenterBottom,
            sourceLabel.font,
        );
        dashLabel.fontFamily = sourceLabel.fontFamily;
        dashLabel.fontStyle = sourceLabel.fontStyle;
        dashLabel.colorDefault = sourceLabel.colorDefault;
        const dash: GraphicalLabel = new GraphicalLabel(
            dashLabel,
            sourceLabel.fontHeight,
            TextAlignmentEnum.CenterBottom,
            this.rules,
        );
        dash.setLabelPositionAndShapeBorders();
        return Math.max(0, dash.PositionAndShape.Size.width);
    }
}

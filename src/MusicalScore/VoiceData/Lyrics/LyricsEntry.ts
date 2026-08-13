import {LyricWord} from "./LyricsWord";
import {VoiceEntry} from "../VoiceEntry";
import { FontStyles } from "../../../Common/Enums/FontStyles";

/** MusicXML's syllabic position for one lyric entry. */
export enum LyricSyllabic {
    Single = "single",
    Begin = "begin",
    Middle = "middle",
    End = "end",
}

/** MusicXML's typed lyric extender state. */
export enum LyricExtendType {
    None = "none",
    Start = "start",
    Continue = "continue",
    Stop = "stop",
}

/** Horizontal anchoring used by the graphical lyric body. */
export enum LyricAlignmentMode {
    Center = "center",
    MelismaLeft = "melisma-left",
}

export type LyricFamilyKind = "verse" | "chorus";
export type LyricRole = "source" | "translation";

function stripTranslationSuffix(value: string): string {
    return value
        .replace(/(?:[-_:]?translation)$/iu, "")
        .replace(/(?:^verse[-_:]?)/iu, "")
        .trim();
}

type LyricVerseSortKey = {
    familyKind: LyricFamilyKind;
    familyNumber: number;
    familyText: string;
    role: LyricRole;
};

function lyricVerseSortKey(value: string): LyricVerseSortKey {
    const normalized: string = String(value || "1").trim().toLowerCase();
    const role: LyricRole = normalized.includes("translation") ? "translation" : "source";
    const familyKind: LyricFamilyKind = normalized.startsWith("chorus") ? "chorus" : "verse";
    const numericMatch: RegExpMatchArray = normalized.match(/(?:^|:)(\d+)(?:translation)?$/u) ||
        normalized.match(/^(\d+)(?:translation)?$/u);
    const familyNumber: number = numericMatch ? Number(numericMatch[1]) : Number.POSITIVE_INFINITY;
    return {
        familyKind,
        familyNumber,
        familyText: familyKind === "chorus"
            ? "chorus"
            : stripTranslationSuffix(normalized) || normalized,
        role,
    };
}

/** Sort source rows immediately before their translations, using numeric verse order. */
export function compareLyricVerseIdentifiers(left: string, right: string): number {
    const a: LyricVerseSortKey = lyricVerseSortKey(left);
    const b: LyricVerseSortKey = lyricVerseSortKey(right);
    if (a.familyKind !== b.familyKind) {
        return a.familyKind === "verse" ? -1 : 1;
    }
    if (a.familyNumber !== b.familyNumber) {
        return a.familyNumber - b.familyNumber;
    }
    const familyComparison: number = a.familyText.localeCompare(b.familyText, undefined, { numeric: true });
    if (familyComparison !== 0) {
        return familyComparison;
    }
    if (a.role !== b.role) {
        return a.role === "source" ? -1 : 1;
    }
    return String(left).localeCompare(String(right), undefined, { numeric: true });
}

export class LyricsEntry {
    constructor(
        text: string,
        verseNumber: string,
        word: LyricWord,
        parent: VoiceEntry,
        syllableNumber: number = -1,
        verseName?: string,
        syllabic: LyricSyllabic = LyricSyllabic.Single,
        extendType: LyricExtendType = LyricExtendType.None,
    ) {
        this.setTextAndStanzaPrefix(text);
        this.word = word;
        this.parent = parent;
        this.verseNumber = verseNumber;
        this.verseName = verseName?.trim().toLowerCase() || "";
        this.syllabic = syllabic;
        this.extendType = extendType;
        if (syllableNumber >= 0) {
            this.syllableIndex = syllableNumber;
        }
    }
    private text: string;
    private lyricText: string;
    private stanzaNumberPrefix: string;
    private word: LyricWord;
    private parent: VoiceEntry;
    private verseNumber: string;
    private verseName: string;
    private syllableIndex: number;
    private syllabic: LyricSyllabic;
    private extendType: LyricExtendType;
    private inferredMelisma: boolean = false;

    public get Text(): string {
        return this.text;
    }
    public set Text(value: string) {
        this.setTextAndStanzaPrefix(value);
    }
    /** The singable text, excluding a literal leading stanza number such as `1. `. */
    public get LyricText(): string {
        return this.lyricText;
    }
    /** A literal leading stanza number, including its original following whitespace. */
    public get StanzaNumberPrefix(): string {
        return this.stanzaNumberPrefix;
    }
    public get Word(): LyricWord {
        return this.word;
    }
    public get Parent(): VoiceEntry {
        return this.parent;
    }
    public set Parent(value: VoiceEntry) {
        this.parent = value;
    }

    public get VerseNumber(): string {
        return this.verseNumber;
    }

    public get SyllableIndex(): number {
        return this.syllableIndex;
    }

    public get VerseName(): string {
        return this.verseName;
    }

    public get Syllabic(): LyricSyllabic {
        return this.syllabic;
    }

    public get ExtendType(): LyricExtendType {
        return this.extendType;
    }

    public set ExtendType(value: LyricExtendType) {
        this.extendType = value;
    }

    /**
     * Compatibility surface for callers that predate typed MusicXML extenders.
     * A stop closes an existing extender but does not begin another segment.
     */
    public get extend(): boolean {
        return this.extendType === LyricExtendType.Start || this.extendType === LyricExtendType.Continue;
    }

    public set extend(value: boolean) {
        this.extendType = value ? LyricExtendType.Start : LyricExtendType.None;
    }

    public get IsMelismatic(): boolean {
        return this.extendType === LyricExtendType.Start || this.inferredMelisma;
    }

    public get AlignmentMode(): LyricAlignmentMode {
        return this.IsMelismatic ? LyricAlignmentMode.MelismaLeft : LyricAlignmentMode.Center;
    }

    public markAsInferredMelisma(): void {
        this.inferredMelisma = true;
    }

    public get IsTranslation(): boolean {
        return /translation$/iu.test(this.VerseName) || /translation$/iu.test(this.VerseNumber);
    }

    public get IsChorus(): boolean {
        return /^chorus(?:$|[-_:])/iu.test(this.VerseName) || /^chorus/iu.test(this.VerseNumber);
    }

    public get LyricFamilyKind(): LyricFamilyKind {
        return this.IsChorus ? "chorus" : "verse";
    }

    public get LyricRole(): LyricRole {
        return this.IsTranslation ? "translation" : "source";
    }

    /** Stable identity shared by a source lyric and any translated rows beneath it. */
    public get LyricFamilyIdentity(): string {
        if (this.IsChorus) {
            return "chorus:chorus";
        }
        const sourceVerseNumber: string = stripTranslationSuffix(this.VerseNumber) || "1";
        return `verse:${sourceVerseNumber}`;
    }

    /** Stable identity for one rendered lyric row, distinct from its family identity. */
    public get LyricLineIdentity(): string {
        const kind: string = this.IsTranslation ? "translation" : this.LyricFamilyKind;
        return `${kind}:${this.VerseNumber || "1"}`;
    }

    public get FontStyle(): FontStyles {
        return this.IsChorus || this.IsTranslation ? FontStyles.Italic : FontStyles.Regular;
    }

    private setTextAndStanzaPrefix(value: string): void {
        this.text = value ?? "";
        const stanzaMatch: RegExpMatchArray = this.text.match(/^(\d+[.)][\s\u00a0]+)(.*)$/u);
        this.stanzaNumberPrefix = stanzaMatch?.[1] ?? "";
        this.lyricText = stanzaMatch?.[2] ?? this.text;
    }
}

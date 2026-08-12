import { LabelTextLine, LabelTextRun } from "../Label";
import { AccidentalEnum } from "../../Common/DataObjects/Pitch";
import { EngravingRules } from "./EngravingRules";
import {
    SMUFL_CHORD_ACCIDENTAL_DOUBLE_FLAT_GLYPH,
    SMUFL_CHORD_ACCIDENTAL_DOUBLE_SHARP_GLYPH,
    SMUFL_CHORD_ACCIDENTAL_FLAT_GLYPH,
    SMUFL_CHORD_ACCIDENTAL_NATURAL_GLYPH,
    SMUFL_CHORD_ACCIDENTAL_SHARP_GLYPH,
    SMUFL_CHORD_ALTERED_BASS_SLASH_GLYPH,
    SMUFL_CHORD_DIAGONAL_ARRANGEMENT_SLASH_GLYPH,
} from "../../Common/DataObjects/ChordSymbolGlyphs";

type DeferredTextFontAudit = {
    tempo: string;
};

type ScoreTextFontAudit = {
    defaultScoreText: string;
    musicText: string;
    dynamics: string;
    literalDynamics: string;
    chordText: string;
    chordMusicText: string;
    measureNumbers: string;
    voltaText: string;
    repetitionText: string;
    rehearsalText: string;
    sectionText: string;
    octaveShiftText: string;
    pedalText: string;
    deferred: DeferredTextFontAudit;
};

type ChordMusicTextToken = {
    source: string;
    display: string;
};

export const OSMD_DEFAULT_TEXT_FONT_FAMILY: string = "Academico";
export const OSMD_NOTATION_FONT_FAMILY: string = "Bravura";
export const OSMD_MUSIC_TEXT_FONT_FAMILY: string = "Bravura Text";
export const OSMD_CHORD_DIMINISHED_SYMBOL: string = "o";
export const OSMD_CHORD_HALFDIMINISHED_SYMBOL: string = "ø";
export const OSMD_CHORD_AUGMENTED_SYMBOL: string = "+";
export const OSMD_CHORD_MAJOR_SEVENTH_SYMBOL: string = "△";

const CHORD_SUPERSCRIPT_FONT_SCALE: number = 0.72;
const CHORD_SUPERSCRIPT_BASELINE_SHIFT: number = -0.35;
const CHORD_DIAGONAL_UPPER_FONT_SCALE: number = 0.62;
const CHORD_DIAGONAL_UPPER_BASELINE_SHIFT: number = -0.52;
const CHORD_DIAGONAL_SLASH_FONT_SCALE: number = 0.66;
const CHORD_DIAGONAL_SLASH_BASELINE_SHIFT: number = -0.25;
const CHORD_DIAGONAL_LOWER_FONT_SCALE: number = 0.62;
const CHORD_DIAGONAL_LOWER_BASELINE_SHIFT: number = 0.02;

export const SCORE_TEXT_FONT_AUDIT: ScoreTextFontAudit = Object.freeze({
    defaultScoreText: OSMD_DEFAULT_TEXT_FONT_FAMILY,
    musicText: OSMD_MUSIC_TEXT_FONT_FAMILY,
    dynamics: OSMD_NOTATION_FONT_FAMILY,
    literalDynamics: OSMD_DEFAULT_TEXT_FONT_FAMILY,
    chordText: OSMD_DEFAULT_TEXT_FONT_FAMILY,
    chordMusicText: OSMD_MUSIC_TEXT_FONT_FAMILY,
    measureNumbers: OSMD_DEFAULT_TEXT_FONT_FAMILY,
    voltaText: OSMD_DEFAULT_TEXT_FONT_FAMILY,
    repetitionText: OSMD_DEFAULT_TEXT_FONT_FAMILY,
    rehearsalText: OSMD_DEFAULT_TEXT_FONT_FAMILY,
    sectionText: OSMD_DEFAULT_TEXT_FONT_FAMILY,
    octaveShiftText: OSMD_DEFAULT_TEXT_FONT_FAMILY,
    pedalText: OSMD_DEFAULT_TEXT_FONT_FAMILY,
    deferred: Object.freeze({
        tempo: "times",
    }),
});

export function getDefaultTextFontFamily(rules?: EngravingRules): string {
    return rules?.DefaultFontFamily || OSMD_DEFAULT_TEXT_FONT_FAMILY;
}

export function getNotationFontFamily(rules?: EngravingRules): string {
    return rules?.DefaultNotationFontFamily || OSMD_NOTATION_FONT_FAMILY;
}

export function getMusicTextFontFamily(rules?: EngravingRules): string {
    return rules?.DefaultMusicTextFontFamily || OSMD_MUSIC_TEXT_FONT_FAMILY;
}

export function buildChordSymbolTextLines(text: string, rules?: EngravingRules): LabelTextLine[] {
    const musicTextTokens: ChordMusicTextToken[] = collectChordMusicTextTokens(rules);
    return [
        {
            runs: splitChordSymbolRuns(
                splitChordSymbolSegments(text),
                musicTextTokens,
                getDefaultTextFontFamily(rules),
                getMusicTextFontFamily(rules),
            ),
        },
    ];
}

function collectChordMusicTextTokens(rules?: EngravingRules): ChordMusicTextToken[] {
    const tokenMap: Map<string, string> = new Map<string, string>();
    addChordMusicTextToken(tokenMap, "♭", "♭");
    addChordMusicTextToken(tokenMap, "♮", "♮");
    addChordMusicTextToken(tokenMap, "♯", "♯");
    addChordMusicTextToken(tokenMap, "𝄪", "𝄪");
    addChordMusicTextToken(tokenMap, "𝄫", "𝄫");
    addChordMusicTextToken(tokenMap, "△", "△");
    addChordMusicTextToken(tokenMap, "ø", "ø");
    addChordMusicTextToken(tokenMap, OSMD_CHORD_MAJOR_SEVENTH_SYMBOL, OSMD_CHORD_MAJOR_SEVENTH_SYMBOL);
    addChordMusicTextToken(tokenMap, OSMD_CHORD_HALFDIMINISHED_SYMBOL, OSMD_CHORD_HALFDIMINISHED_SYMBOL);
    addChordMusicTextToken(tokenMap, "\uE870", "\uE870");
    addChordMusicTextToken(tokenMap, "\uE871", "\uE871");
    addChordMusicTextToken(tokenMap, "\uE872", "\uE872");
    addChordMusicTextToken(tokenMap, "\uE873", "\uE873");
    addChordMusicTextToken(tokenMap, "\uE874", "\uE874");
    addChordMusicTextToken(
        tokenMap,
        SMUFL_CHORD_ALTERED_BASS_SLASH_GLYPH,
        SMUFL_CHORD_ALTERED_BASS_SLASH_GLYPH,
    );
    addChordMusicTextToken(
        tokenMap,
        SMUFL_CHORD_DIAGONAL_ARRANGEMENT_SLASH_GLYPH,
        SMUFL_CHORD_DIAGONAL_ARRANGEMENT_SLASH_GLYPH,
    );

    addRuleAccidentalToken(
        tokenMap, rules, AccidentalEnum.FLAT, "b", SMUFL_CHORD_ACCIDENTAL_FLAT_GLYPH,
    );
    addRuleAccidentalToken(
        tokenMap, rules, AccidentalEnum.NATURAL, "n", SMUFL_CHORD_ACCIDENTAL_NATURAL_GLYPH,
    );
    addRuleAccidentalToken(
        tokenMap, rules, AccidentalEnum.SHARP, "#", SMUFL_CHORD_ACCIDENTAL_SHARP_GLYPH,
    );
    addRuleAccidentalToken(
        tokenMap, rules, AccidentalEnum.DOUBLESHARP, "x", SMUFL_CHORD_ACCIDENTAL_DOUBLE_SHARP_GLYPH,
    );
    addRuleAccidentalToken(
        tokenMap, rules, AccidentalEnum.DOUBLEFLAT, "bb", SMUFL_CHORD_ACCIDENTAL_DOUBLE_FLAT_GLYPH,
    );

    return Array.from(tokenMap.entries())
        .map(([source, display]) => ({ source, display }))
        .sort((left, right) => right.source.length - left.source.length || right.source.localeCompare(left.source));
}

type ChordLayoutSegment = {
    text: string;
    fontScale?: number;
    baselineShift?: number;
};

function splitChordSymbolRuns(
    segments: ChordLayoutSegment[],
    musicTextTokens: ChordMusicTextToken[],
    textFontFamily: string,
    musicTextFontFamily: string,
): LabelTextRun[] {
    const runs: LabelTextRun[] = [];

    for (const segment of segments) {
        let index: number = 0;
        while (index < segment.text.length) {
            const token: ChordMusicTextToken = musicTextTokens.find((candidate) =>
                segment.text.startsWith(candidate.source, index) &&
                isChordMusicTextContext(segment.text, index, candidate.source.length),
            );
            if (token) {
                appendRun(
                    runs,
                    token.display,
                    musicTextFontFamily,
                    segment.fontScale ?? 1,
                    segment.baselineShift ?? 0,
                );
                index += token.source.length;
                continue;
            }

            const nextSymbol: string = Array.from(segment.text.slice(index))[0] || "";
            if (!nextSymbol) {
                break;
            }
            appendRun(
                runs,
                nextSymbol,
                textFontFamily,
                segment.fontScale ?? 1,
                segment.baselineShift ?? 0,
            );
            index += nextSymbol.length;
        }
    }

    return runs;
}

function appendRun(
    runs: LabelTextRun[],
    text: string,
    fontFamily: string,
    fontScale: number,
    baselineShift: number,
): void {
    if (!text) {
        return;
    }
    const previousRun: LabelTextRun = runs[runs.length - 1];
    if (
        previousRun?.fontFamily === fontFamily &&
        (previousRun.fontScale ?? 1) === fontScale &&
        (previousRun.baselineShift ?? 0) === baselineShift
    ) {
        previousRun.text += text;
        return;
    }
    runs.push({ text, fontFamily, fontScale, baselineShift });
}

function containsNonAscii(text: string): boolean {
    for (const character of Array.from(text)) {
        if (character.charCodeAt(0) > 0x7F) {
            return true;
        }
    }
    return false;
}

function addRuleAccidentalToken(
    tokenMap: Map<string, string>,
    rules: EngravingRules | undefined,
    accidental: AccidentalEnum,
    fallbackSource: string,
    display: string,
): void {
    const configuredToken: string = rules?.ChordAccidentalTexts?.getValue(accidental);
    addChordMusicTextToken(tokenMap, configuredToken || fallbackSource, display);
}

function addChordMusicTextToken(tokenMap: Map<string, string>, source: string, display: string): void {
    if (!source || !display) {
        return;
    }
    tokenMap.set(source, display);
}

function isChordMusicTextContext(text: string, index: number, tokenLength: number): boolean {
    const previousCharacter: string = index > 0 ? text.charAt(index - 1) : "";
    const nextCharacter: string = text.charAt(index + tokenLength);

    if (containsNonAscii(text.slice(index, index + tokenLength))) {
        return true;
    }
    if (isChordNoteLetter(previousCharacter)) {
        return true;
    }
    if (isDigit(nextCharacter)) {
        return true;
    }
    if (previousCharacter === "(" || previousCharacter === "/" || previousCharacter === ",") {
        return isChordNoteLetter(nextCharacter) || isDigit(nextCharacter);
    }
    return false;
}

function splitChordSymbolSegments(text: string): ChordLayoutSegment[] {
    if (!text) {
        return [];
    }

    const bassIndex: number = findChordBassIndex(text);
    const mainText: string = bassIndex >= 0 ? text.slice(0, bassIndex) : text;
    const bassText: string = bassIndex >= 0 ? text.slice(bassIndex) : "";
    const rootText: string = matchChordRoot(mainText);
    if (!rootText) {
        return [{ text }];
    }

    const segments: ChordLayoutSegment[] = [{ text: rootText }];
    const suffixText: string = mainText.slice(rootText.length);
    if (suffixText) {
        const baselinePrefix: string = matchChordBaselineQualityPrefix(suffixText);
        if (baselinePrefix) {
            segments.push({ text: baselinePrefix });
        }
        const superscriptText: string = suffixText.slice(baselinePrefix.length);
        if (superscriptText) {
            appendChordSuperscriptSegments(segments, superscriptText);
        }
    }
    if (bassText) {
        segments.push({ text: bassText });
    }
    return segments;
}

function appendChordSuperscriptSegments(segments: ChordLayoutSegment[], text: string): void {
    const suspendedMatch: RegExpMatchArray = text.match(/^(.*?)sus2\/4(.*)$/i);
    if (suspendedMatch) {
        appendSuperscriptSegment(segments, suspendedMatch[1]);
        appendSuperscriptSegment(segments, text.slice(suspendedMatch[1].length, suspendedMatch[1].length + 3));

        // Centre the complete diagonal 2/4 group on the adjacent "sus" run.
        // This offset is derived from the actual scaled-run bounds, rather than
        // tuning each numeral independently.
        const superscriptCenter: number =
            CHORD_SUPERSCRIPT_BASELINE_SHIFT + CHORD_SUPERSCRIPT_FONT_SCALE / 2;
        const diagonalCenter: number = (
            CHORD_DIAGONAL_UPPER_BASELINE_SHIFT +
            CHORD_DIAGONAL_LOWER_BASELINE_SHIFT + CHORD_DIAGONAL_LOWER_FONT_SCALE
        ) / 2;
        appendDiagonalNumeralSegments(segments, "2", "4", superscriptCenter - diagonalCenter);
        appendSuperscriptSegment(segments, suspendedMatch[2]);
        return;
    }

    const sixNineMatch: RegExpMatchArray = text.match(/^(.*?)6\/9(.*)$/);
    if (sixNineMatch) {
        appendSuperscriptSegment(segments, sixNineMatch[1]);
        appendDiagonalNumeralSegments(segments, "6", "9");
        appendSuperscriptSegment(segments, sixNineMatch[2]);
        return;
    }

    appendSuperscriptSegment(segments, text);
}

function appendSuperscriptSegment(segments: ChordLayoutSegment[], text: string): void {
    if (!text) {
        return;
    }
    segments.push({
        text,
        fontScale: CHORD_SUPERSCRIPT_FONT_SCALE,
        baselineShift: CHORD_SUPERSCRIPT_BASELINE_SHIFT,
    });
}

function appendDiagonalNumeralSegments(
    segments: ChordLayoutSegment[],
    upper: string,
    lower: string,
    baselineOffset: number = 0,
): void {
    // These are compact diagonal extensions, not stacked fractions or
    // altered-bass separators. Academico has no dedicated SMuFL construction,
    // so use its typographic fraction slash between independently placed runs.
    segments.push({
        text: upper,
        fontScale: CHORD_DIAGONAL_UPPER_FONT_SCALE,
        baselineShift: CHORD_DIAGONAL_UPPER_BASELINE_SHIFT + baselineOffset,
    });
    segments.push({
        text: "\u2044",
        fontScale: CHORD_DIAGONAL_SLASH_FONT_SCALE,
        baselineShift: CHORD_DIAGONAL_SLASH_BASELINE_SHIFT + baselineOffset,
    });
    segments.push({
        text: lower,
        fontScale: CHORD_DIAGONAL_LOWER_FONT_SCALE,
        baselineShift: CHORD_DIAGONAL_LOWER_BASELINE_SHIFT + baselineOffset,
    });
}

function matchChordBaselineQualityPrefix(text: string): string {
    const lowered: string = text.toLowerCase();
    if (lowered.startsWith("minor")) {
        return text.slice(0, "minor".length);
    }
    if (lowered.startsWith("min")) {
        return text.slice(0, "min".length);
    }
    if (lowered.startsWith("mi")) {
        return text.slice(0, "mi".length);
    }
    if (lowered.startsWith("m") && !lowered.startsWith("maj")) {
        return text.slice(0, "m".length);
    }
    return "";
}

function findChordBassIndex(text: string): number {
    for (let index: number = 1; index < text.length - 1; index++) {
        if (text.charAt(index) === "/" && isChordNoteLetter(text.charAt(index + 1))) {
            return index;
        }
    }
    return -1;
}

function matchChordRoot(text: string): string {
    const match: RegExpMatchArray = text.match(
        /^[A-Ga-g](?:(?:bb|##|x|b|#|n|♭|♮|♯|𝄪|𝄫)+)?/u,
    );
    return match?.[0] ?? "";
}

function isChordNoteLetter(character: string): boolean {
    return /^[A-Ga-g]$/.test(character);
}

function isDigit(character: string): boolean {
    return /^[0-9]$/.test(character);
}

import { expect } from "chai";
import { applyAutomaticLyricNumbering } from "../../../src/MusicalScore/Graphical/AutomaticLyricNumbering";
import { GraphicalLyricEntry } from "../../../src/MusicalScore/Graphical/GraphicalLyricEntry";
import { MusicSystem } from "../../../src/MusicalScore/Graphical/MusicSystem";

type TestLyric = GraphicalLyricEntry & { prefixes: string[] };

function lyric(
    verseNumber: string,
    options: { chorus?: boolean, text?: string, translation?: boolean } = {},
): TestLyric {
    const prefixes: string[] = [];
    return {
        LyricsEntry: {
            IsChorus: options.chorus || false,
            IsTranslation: options.translation || false,
            LyricText: options.text ?? "word",
            StanzaNumberPrefix: "9. ",
            VerseNumber: verseNumber,
        },
        prefixes,
        setDisplayStanzaNumberPrefix(prefix: string): void {
            prefixes.push(prefix);
        },
    } as TestLyric;
}

function system(...staffs: Array<{ entries: TestLyric[], instrument: object }>): MusicSystem {
    return {
        StaffLines: staffs.map(({ entries, instrument }) => ({
            Measures: [{ staffEntries: [{ LyricsEntries: entries }] }],
            ParentStaff: { ParentInstrument: instrument },
        })),
    } as unknown as MusicSystem;
}

describe("automatic lyric numbering", () => {
    it("numbers each numeric verse once per system for multi-verse instruments", (): void => {
        const voiceInstrument: object = {};
        const pianoInstrument: object = {};
        const firstVerse: TestLyric = lyric("01");
        const repeatedFirstVerse: TestLyric = lyric("1");
        const secondVerse: TestLyric = lyric("2");
        const chorus: TestLyric = lyric("3", { chorus: true });
        const translation: TestLyric = lyric("4", { translation: true });
        const nextSystemFirstVerse: TestLyric = lyric("1");
        const nextSystemSecondVerse: TestLyric = lyric("2");
        const pianoOnlyVerse: TestLyric = lyric("1");
        const nextPianoOnlyVerse: TestLyric = lyric("1");

        applyAutomaticLyricNumbering([
            system(
                {
                    entries: [firstVerse, repeatedFirstVerse, secondVerse, chorus, translation],
                    instrument: voiceInstrument,
                },
                { entries: [pianoOnlyVerse], instrument: pianoInstrument },
            ),
            system(
                {
                    entries: [nextSystemFirstVerse, nextSystemSecondVerse],
                    instrument: voiceInstrument,
                },
                { entries: [nextPianoOnlyVerse], instrument: pianoInstrument },
            ),
        ]);

        expect(firstVerse.prefixes).to.deep.equal(["", "1. "]);
        expect(repeatedFirstVerse.prefixes).to.deep.equal([""]);
        expect(secondVerse.prefixes).to.deep.equal(["", "2. "]);
        expect(nextSystemFirstVerse.prefixes).to.deep.equal(["", "1. "]);
        expect(nextSystemSecondVerse.prefixes).to.deep.equal(["", "2. "]);
        expect(chorus.prefixes).to.deep.equal([""]);
        expect(translation.prefixes).to.deep.equal([""]);
        expect(pianoOnlyVerse.prefixes).to.deep.equal([""]);
        expect(nextPianoOnlyVerse.prefixes).to.deep.equal([""]);
    });

    it("ignores nonnumeric metadata and empty lyric bodies", (): void => {
        const instrument: object = {};
        const namedVerse: TestLyric = lyric("verse-one");
        const emptyVerse: TestLyric = lyric("2", { text: "" });

        applyAutomaticLyricNumbering([
            system({ entries: [namedVerse, emptyVerse], instrument }),
        ]);

        expect(namedVerse.prefixes).to.deep.equal([""]);
        expect(emptyVerse.prefixes).to.deep.equal([""]);
    });
});

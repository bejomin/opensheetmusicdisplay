import { Instrument } from "../Instrument";
import { LyricsEntry } from "../VoiceData/Lyrics/LyricsEntry";
import { GraphicalLyricEntry } from "./GraphicalLyricEntry";
import { MusicSystem } from "./MusicSystem";

type InstrumentLyric = {
    entry: GraphicalLyricEntry;
    instrument: Instrument;
    verseNumber: string;
};

function numericVerseNumber(entry: GraphicalLyricEntry): string | undefined {
    const lyricsEntry: LyricsEntry = entry.LyricsEntry;
    const verseNumber: string = lyricsEntry.VerseNumber?.trim() || "";
    if (
        !lyricsEntry.LyricText?.trim() ||
        lyricsEntry.IsChorus ||
        lyricsEntry.IsTranslation ||
        !/^\d+$/u.test(verseNumber)
    ) {
        return undefined;
    }
    return verseNumber.replace(/^0+(?=\d)/u, "");
}

function lyricsInSystem(system: MusicSystem): InstrumentLyric[] {
    const result: InstrumentLyric[] = [];
    for (const staffLine of system.StaffLines) {
        const instrument: Instrument = staffLine.ParentStaff.ParentInstrument;
        for (const measure of staffLine.Measures) {
            for (const staffEntry of measure.staffEntries) {
                for (const entry of staffEntry.LyricsEntries) {
                    entry.setDisplayStanzaNumberPrefix("");
                    const verseNumber: string = numericVerseNumber(entry);
                    if (verseNumber !== undefined) {
                        result.push({ entry, instrument, verseNumber });
                    }
                }
            }
        }
    }
    return result;
}

/**
 * Number the first non-empty occurrence of every numeric verse in each system.
 * Literal prefixes in lyric text are stripped by LyricsEntry but deliberately do
 * not influence numbering; MusicXML's `lyric number` metadata is authoritative.
 */
export function applyAutomaticLyricNumbering(musicSystems: MusicSystem[]): void {
    const lyricsBySystem: InstrumentLyric[][] = musicSystems.map(lyricsInSystem);
    const versesByInstrument: Map<Instrument, Set<string>> = new Map();

    for (const systemLyrics of lyricsBySystem) {
        for (const { instrument, verseNumber } of systemLyrics) {
            const verses: Set<string> = versesByInstrument.get(instrument) || new Set<string>();
            verses.add(verseNumber);
            versesByInstrument.set(instrument, verses);
        }
    }

    for (const systemLyrics of lyricsBySystem) {
        const numberedVersesByInstrument: Map<Instrument, Set<string>> = new Map();
        for (const { entry, instrument, verseNumber } of systemLyrics) {
            if ((versesByInstrument.get(instrument)?.size || 0) <= 1) {
                continue;
            }
            const numberedVerses: Set<string> = numberedVersesByInstrument.get(instrument) || new Set<string>();
            if (!numberedVerses.has(verseNumber)) {
                entry.setDisplayStanzaNumberPrefix(`${verseNumber}. `);
                numberedVerses.add(verseNumber);
                numberedVersesByInstrument.set(instrument, numberedVerses);
            }
        }
    }
}

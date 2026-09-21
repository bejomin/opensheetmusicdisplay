import { expect } from "chai";
import { IXmlElement } from "../../../src/Common/FileIO/Xml";
import { MusicPartManagerIterator } from "../../../src/MusicalScore/MusicParts/MusicPartManagerIterator";
import { Repetition } from "../../../src/MusicalScore/MusicSource/Repetition";
import { MusicSheet } from "../../../src/MusicalScore/MusicSheet";
import { MusicSheetReader } from "../../../src/MusicalScore/ScoreIO/MusicSheetReader";
import {
    AlignmentType,
    RepetitionInstruction,
    RepetitionInstructionEnum,
} from "../../../src/MusicalScore/VoiceData/Instructions/RepetitionInstruction";
import { TestUtils } from "../../Util/TestUtils";

function readSheet(scoreName: string): MusicSheet {
    const doc: Document = TestUtils.getScore(scoreName);
    expect(doc, "sample file is loaded").to.not.equal(undefined);
    const score: IXmlElement = new IXmlElement(doc.getElementsByTagName("score-partwise")[0]);
    return new MusicSheetReader().createMusicSheet(score, scoreName);
}

function collectMeasureTraversal(sheet: MusicSheet): number[] {
    const traversal: number[] = [];
    const iterator: MusicPartManagerIterator = sheet.MusicPartManager.getIterator();

    while (!iterator.EndReached && iterator.CurrentVoiceEntries) {
        const hasAudibleNotes: boolean = iterator.CurrentAudibleVoiceEntries().some((voiceEntry): boolean =>
            (voiceEntry?.Notes || []).some((note): boolean => !note.isRest?.()));

        if (hasAudibleNotes) {
            traversal.push(iterator.CurrentMeasureIndex + 1);
        }
        iterator.moveToNext();
    }

    return traversal;
}

function collectMeasureTraversalWithIterations(
    sheet: MusicSheet,
): Array<{ iteration: number, measureIndex: number }> {
    const traversal: Array<{ iteration: number, measureIndex: number }> = [];
    const iterator: MusicPartManagerIterator = sheet.MusicPartManager.getIterator();

    while (!iterator.EndReached && iterator.CurrentVoiceEntries) {
        const hasAudibleNotes: boolean = iterator.CurrentAudibleVoiceEntries().some((voiceEntry): boolean =>
            (voiceEntry?.Notes || []).some((note): boolean => !note.isRest?.()));

        if (hasAudibleNotes) {
            traversal.push({
                iteration: iterator.CurrentRepetitionIteration,
                measureIndex: iterator.CurrentMeasureIndex,
            });
        }
        iterator.moveToNext();
    }

    return traversal;
}

describe("Music Sheet Repetition playback", () => {
    it("uses MusicXML repeat times for plain backward repeats", () => {
        const sheet: MusicSheet = readSheet("test_repeat_times_4.musicxml");

        expect(sheet.Repetitions.length).to.equal(1);
        expect(sheet.Repetitions[0].BackwardJumpInstructions[0].Times).to.equal(4);
        expect(sheet.Repetitions[0].UserNumberOfRepetitions).to.equal(4);
        expect(collectMeasureTraversal(sheet)).to.deep.equal([1, 2, 1, 2, 1, 2, 1, 2]);
    });

    it("plays first, second, and third endings on successive passes", () => {
        const sheet: MusicSheet = readSheet("test_repeat_volta_1_2_3.musicxml");

        expect(sheet.Repetitions.length).to.equal(1);
        expect(sheet.Repetitions[0].NumberOfEndings).to.equal(3);
        expect(sheet.Repetitions[0].UserNumberOfRepetitions).to.equal(3);
        expect(collectMeasureTraversal(sheet)).to.deep.equal([1, 2, 1, 3, 1, 4]);
    });

    it("plays a shared first-through-fourth ending before the fifth ending", () => {
        const sheet: MusicSheet = readSheet("test_repeat_volta_display_range_1_4_5.musicxml");
        const terminalEndingInstructions: RepetitionInstruction[] = sheet.SourceMeasures[1].LastRepetitionInstructions.filter(
            (instruction): boolean => instruction.type === RepetitionInstructionEnum.Ending,
        );

        expect(sheet.Repetitions.length).to.equal(1);
        expect(sheet.Repetitions[0].NumberOfEndings).to.equal(5);
        expect(sheet.Repetitions[0].UserNumberOfRepetitions).to.equal(5);
        expect(terminalEndingInstructions).to.have.length(1);
        expect(collectMeasureTraversal(sheet)).to.deep.equal([
            1, 2,
            1, 2,
            1, 2,
            1, 2,
            1, 3,
        ]);
    });

    it("retains the real pass iteration when a repeat from the beginning has an outro", () => {
        const sheet: MusicSheet = readSheet("test_repeat_volta_1_2_3_outro.musicxml");
        const repeatedSection: Repetition = sheet.Repetitions.find((repetition): boolean =>
            repetition.UserNumberOfRepetitions === 3);
        const firstInstructions: RepetitionInstruction[] = sheet.SourceMeasures[0].FirstRepetitionInstructions;

        expect(sheet.Repetitions).to.have.length(2);
        expect(repeatedSection).not.to.equal(undefined);
        expect(firstInstructions.map((instruction): AlignmentType => instruction.alignment)).to.deep.equal([
            AlignmentType.Begin,
            AlignmentType.Begin,
        ]);
        expect(firstInstructions.map((instruction): number => instruction.parentRepetition.EndIndex)).to.deep.equal([
            4,
            3,
        ]);
        expect(firstInstructions[firstInstructions.length - 1].parentRepetition).to.equal(repeatedSection);
        expect(collectMeasureTraversalWithIterations(sheet)).to.deep.equal([
            { iteration: 1, measureIndex: 0 },
            { iteration: 1, measureIndex: 1 },
            { iteration: 1, measureIndex: 2 },
            { iteration: 2, measureIndex: 0 },
            { iteration: 2, measureIndex: 1 },
            { iteration: 2, measureIndex: 2 },
            { iteration: 3, measureIndex: 0 },
            { iteration: 3, measureIndex: 1 },
            { iteration: 3, measureIndex: 3 },
            { iteration: 3, measureIndex: 4 },
        ]);
    });
});

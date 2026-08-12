import { VoiceEntry } from "./VoiceEntry";
import { Note } from "./Note";

export class Arpeggio {
    constructor(parentVoiceEntry: VoiceEntry, type: ArpeggioType = ArpeggioType.ARPEGGIO_DIRECTIONLESS,
                number: number = 1) {
        this.parentVoiceEntry = parentVoiceEntry;
        this.type = type;
        this.number = number;
        this.notes = [];
    }

    public parentVoiceEntry: VoiceEntry;
    public notes: Note[];
    public type: ArpeggioType;
    /** MusicXML arpeggiate@number. Equal numbers at one timestamp belong to one arpeggio, including across staves. */
    public number: number;
    /** MusicXML 4 arpeggiate@unbroken hint. Equal numbers are sufficient to identify a cross-staff arpeggio. */
    public unbroken: boolean = false;

    public addNote(note: Note): void {
        this.notes.push(note);
        note.Arpeggio = this;
    }
}

/** Corresponds to VF.Stroke.Type for now. But we don't want VexFlow as a dependency here. */
export enum ArpeggioType {
    BRUSH_DOWN = 1,
    BRUSH_UP,
    ROLL_DOWN,
    ROLL_UP,
    RASQUEDO_DOWN,
    RASQUEDO_UP,
    ARPEGGIO_DIRECTIONLESS
}

// The two table tours: what a player needs to know to take a turn, and
// what the person in the DM seat needs to know to run one. Anchors are the
// data-tour values set in the session components; prepare names are the
// side effects SessionView performs before a step (which tab to open,
// which column a phone shows). Steps whose anchor is not on screen are
// skipped, so one list serves every table: a tab that is off (maps,
// voice, narration) simply never gets a step.
import type { TourStep } from "@/lib/tours/logic";

export const PLAYER_TOUR_ID = "table-player";
export const DM_TOUR_ID = "table-dm";

export const PLAYER_TOUR: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to the table",
    body: "This is where the adventure is played. The story runs down the middle; your character, the party and the world sit in the side panel. A short tour shows the controls. Replay it any time from Help.",
    anchors: [],
  },
  {
    id: "modes",
    title: "How you speak",
    body: "Do describes what your character does. Say speaks in character. OOC is table talk the Dungeon Master ignores. Pick one, then write in the box below.",
    anchors: ["composer-modes"],
    prepare: "show-chat",
  },
  {
    id: "compose",
    title: "Take your turn",
    body: "Type your action here and press Enter. The Dungeon Master reads everything sent up to that moment and answers the whole table at once, whether that is the AI or a person in the DM seat, so agree on a plan before you send.",
    anchors: ["composer-input"],
    prepare: "show-chat",
  },
  {
    id: "talk",
    title: "Hold to talk",
    body: "Hold the microphone and dictate instead of typing; the words land in the box for you to check before sending.",
    anchors: ["composer-talk"],
    prepare: "show-chat",
  },
  {
    id: "ask",
    title: "Ask the DM",
    body: "Questions about the story, the rules or your sheet go here, not in the message box. Asking never moves the story on, so it works even while the floor is locked.",
    anchors: ["ask-dm"],
    prepare: "show-chat",
  },
  {
    id: "party",
    title: "The party",
    body: "Your sheet, everyone's hit points and conditions, and the fight order during combat. The room code lives in the lead's tab.",
    anchors: ["tab-party"],
    prepare: "open-party",
  },
  {
    id: "story",
    title: "The story so far",
    body: "Chapters, the facts the table has pinned, and the log of every roll and stat change the Dungeon Master made.",
    anchors: ["tab-story"],
    prepare: "open-story",
  },
  {
    id: "map",
    title: "Maps",
    body: "The scene map, the overworld and the places the party has found. A battle map opens in its own tab while a fight with a map is running.",
    anchors: ["tab-map", "tab-battle"],
    prepare: "open-map",
  },
  {
    id: "chat",
    title: "Whispers and side chat",
    body: "Private words with the Dungeon Master, and side chat between players that never reaches the transcript.",
    anchors: ["tab-chat"],
    prepare: "open-chat",
  },
  {
    id: "dice",
    title: "Dice",
    body: "Every roll is made by the server, never invented. This menu turns the tumbling 3D dice on or off, opens the editor for your own dice colours, and on a phone lets you shake to roll.",
    anchors: ["header-dice"],
  },
  {
    id: "voice",
    title: "Voice chat",
    body: "Join the call from here and talk to the table without another app. It stays up whichever panel you switch to.",
    anchors: ["header-voice"],
  },
  {
    id: "help",
    title: "Help, settings and the way home",
    body: "Help explains every button. The account menu beside it holds your characters, settings, log out, and, inside the app, the way back to its home screen.",
    anchors: ["header-help"],
  },
];

export const DM_TOUR: TourStep[] = [
  {
    id: "welcome",
    title: "You run the table",
    body: "You narrate in your own words; the app keeps the sheets, the dice, the maps and the record straight underneath you. This tour shows your console. Replay it any time from Help.",
    anchors: [],
  },
  {
    id: "modes",
    title: "Narrate and OOC",
    body: "Narrate writes into the story as the Dungeon Master. OOC is table talk. Player actions arrive as intents for you to answer.",
    anchors: ["composer-modes"],
    prepare: "show-chat",
  },
  {
    id: "console",
    title: "Your console",
    body: "Only the DM seats have this tab. It holds the floor, the story beats, the hand-over switches when an assistant is on, the queue of intents waiting on you, and every tool underneath.",
    anchors: ["tab-dm"],
    prepare: "open-dm",
  },
  {
    id: "floor",
    title: "Who may act",
    body: "Open the floor to everyone or hold it while you set a scene. During a fight the initiative order holds it for you.",
    anchors: ["dm-floor"],
    prepare: "open-dm",
  },
  {
    id: "beats",
    title: "Write down what happened",
    body: "Because you narrate out loud, jot a line or two here every so often. Beats are what chapter summaries, recaps and the exported story are built from. Draft it for me writes one from the recent play.",
    anchors: ["dm-beats"],
    prepare: "open-dm",
  },
  {
    id: "delegation",
    title: "Hand it over",
    body: "Let the assistant take the monsters' turn, or cover the table for a counted stretch of answers while you step away.",
    anchors: ["dm-delegation"],
    prepare: "open-dm",
  },
  {
    id: "queue",
    title: "Waiting on you",
    body: "Player actions that need a ruling gather here. What should I press? suggests the tool and fills it in.",
    anchors: ["dm-queue"],
    prepare: "open-dm",
  },
  {
    id: "tools",
    title: "Your tools",
    body: "Assist for stat blocks, DCs and odds. Combat, Party, World, Social, Story and Table for every ruling the engine can apply. Maps, Cast, Bestiary, Storyboard and Tables for prep.",
    anchors: ["dm-console-tabs"],
    prepare: "open-dm",
  },
  {
    id: "party",
    title: "The party",
    body: "Sheets, hit points and conditions for everyone, and during combat the initiative order you can reorder.",
    anchors: ["tab-party"],
    prepare: "open-party",
  },
  {
    id: "chat",
    title: "Whispers",
    body: "Private lines to and from each player: a secret only one of them learns, or a question they did not want to ask aloud.",
    anchors: ["tab-chat"],
    prepare: "open-chat",
  },
  {
    id: "help",
    title: "Help and the way home",
    body: "Help explains every button and replays this tour. The account menu beside it holds settings, log out and, inside the app, the way back to its home screen.",
    anchors: ["header-help"],
  },
];

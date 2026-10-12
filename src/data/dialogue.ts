import { STUDIO } from "./studio";

/**
 * Every line of in-world dialogue and class-skill flavour text on the site.
 *
 * Kept apart from the components so the copy can be edited without touching
 * any animation code. Rules for anything added here: short, dry, in the voice
 * of the character bios — and never a studio fact, number or claim that is not
 * already stated elsewhere on the site.
 */

/* ------------------------------------------------------- partner quest NPC */

export type QuestPath = "publishing" | "project" | "hi";

export interface QuestChoice {
  id: QuestPath;
  /** What the visitor says. Shown in the RPG choice menu. */
  label: string;
  /** What the NPC types back. */
  reply: string;
  /** Inbox the "accept quest" mail goes to. */
  email: string;
  subject: string;
  /** Pre-filled mail body. Lines are joined with CRLF when the link is built. */
  body: string[];
}

export interface QuestDialogue {
  /** Character id of the NPC (portrait + name tag come from characters.ts). */
  npc: string;
  /** Accessible name for the whole dialogue box. */
  boxLabel: string;
  /** First line, typed when the box scrolls into view. */
  greeting: string;
  /** Typed again when the visitor backs out of a choice. */
  back: string;
  /** Accessible name of the choice menu. */
  choicesLabel: string;
  choices: QuestChoice[];
  /** Primary action after a reply — opens a pre-filled email. */
  accept: string;
  /** Small print under the accept action. */
  acceptHint: string;
  /** Returns to the choices. */
  backLabel: string;
  /** Skips the typewriter to the end of the line. */
  skip: string;
  /** Accessible name of the skip button. Must start with `skip`'s text. */
  skipLabel: string;
}

const SIGN_OFF = "— Sent from the quest board on the GlitchTech site";

export const QUEST: QuestDialogue = {
  npc: "firefighter",
  boxLabel: "Quest dialogue",
  greeting:
    "End of the level. Before the credits roll — what brings you all the way down here?",
  back: "Take your time. Quests don't expire. What brings you here?",
  choicesLabel: "Your reply",
  choices: [
    {
      id: "publishing",
      label: "Publishing partnership",
      reply:
        "A publisher. Good. Prototypes, metrics and the full deck are available on request — just say the word.",
      email: STUDIO.emails.partner,
      subject: "Publishing partnership — GlitchTech Games",
      body: [
        "Hi GlitchTech team,",
        "",
        "We'd like to talk about a publishing partnership.",
        "",
        "Who we are:",
        "What we're looking for:",
        "Best way to reach us:",
        "",
        SIGN_OFF,
      ],
    },
    {
      id: "project",
      label: "A project for your team",
      reply:
        "A new quest for the party. Tell us what you want built and roughly when. More detail, better first reply.",
      email: STUDIO.emails.studio,
      subject: "A project for the GlitchTech team",
      body: [
        "Hi GlitchTech team,",
        "",
        "We have a project we'd like to talk about.",
        "",
        "What we want built:",
        "Rough timeline:",
        "Anything else you should know:",
        "",
        SIGN_OFF,
      ],
    },
    {
      id: "hi",
      label: "Just saying hi",
      reply: "Hi back. Not every quest needs a dragon. The studio inbox is open.",
      email: STUDIO.emails.studio,
      subject: "Just saying hi",
      body: ["Hi GlitchTech team,", "", "", SIGN_OFF],
    },
  ],
  accept: "ACCEPT QUEST",
  acceptHint: "Opens your mail app",
  backLabel: "back",
  skip: "Skip",
  skipLabel: "Skip to the full line",
};

/** `mailto:` link for a quest path, with the subject and body pre-filled. */
export function questMailto(choice: QuestChoice) {
  // encodeURIComponent rather than URLSearchParams: the latter turns spaces
  // into "+", which several mail clients then show literally.
  const enc = (s: string) => encodeURIComponent(s);
  return `mailto:${choice.email}?subject=${enc(choice.subject)}&body=${enc(
    choice.body.join("\r\n"),
  )}`;
}

/* ------------------------------------------------------ team class skills */

/**
 * Flavour text that pops over a team card's sprite when its "class skill" is
 * triggered. Keyed by the discipline's role in `DISCIPLINES` (data/studio.ts);
 * each one is lifted from that card's own description.
 */
export const TEAM_SKILLS: Record<string, string> = {
  "Game design": "Core loop +1",
  "Art direction": "Style pass",
  "Unity dev": "Build green",
  "UA & ASO": "CPI hunt",
  "Live ops": "Event drop",
};

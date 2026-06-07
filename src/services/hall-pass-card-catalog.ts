import type {
  RubyHighHallPassCard,
  RubyHighHallPassCardRarity,
  RubyHighHallPassCardRole,
} from "../types.js";

export interface HallPassCardCatalogEntry {
  characterId: string;
  characterName: string;
  role: RubyHighHallPassCardRole;
  rarity: RubyHighHallPassCardRarity;
  title: string;
  blurb: string;
  color: string;
  artSheet?: RubyHighHallPassCard["artSheet"];
  artPosition?: string;
  nftDescription?: string;
}

export interface FirstBellSetProfile {
  setNumber: string;
  profileId: string;
  cardName: string;
  role: RubyHighHallPassCardRole;
  rarity: RubyHighHallPassCardRarity;
  subject: string;
  art: string;
  mintable: boolean;
  characterId?: string;
  imageId?: string;
  sourceCharacterId?: string;
  variantOf?: string;
  variant?: string;
}

export const FIRST_BELL_SET_NAME = "Ruby High: First Bell";
export const FIRST_BELL_SET_FAMILY = "Ruby High";
export const FIRST_BELL_SET_CODE = "FB";
export const FIRST_BELL_SET_TOTAL_PROFILES = 36;
export const FIRST_BELL_SET_LIVE_PROFILE_COUNT = 24;
export const FIRST_BELL_SET_EXPANSION_PROFILE_COUNT = 12;

export const HALL_PASS_CARD_TEACHERS: HallPassCardCatalogEntry[] = [
  {
    characterId: "ruby",
    characterName: "Ruby",
    role: "teacher",
    rarity: "common",
    title: "Homeroom Card",
    blurb: "Ruby stamped this one before the late bell could object.",
    color: "#d22a2a",
    artSheet: "teachers",
    artPosition: "0% 0%",
  },
  {
    characterId: "sally-science",
    characterName: "Sally Science",
    role: "teacher",
    rarity: "common",
    title: "Lab Sink Shortcut",
    blurb: "Good for one escape from sloppy variables.",
    color: "#35b978",
    artSheet: "teachers",
    artPosition: "50% 0%",
  },
  {
    characterId: "professor-edward",
    characterName: "Professor Edward",
    role: "teacher",
    rarity: "common",
    title: "Library Corridor Pass",
    blurb: "Please return before the footnotes start breeding.",
    color: "#b79243",
    artSheet: "teachers",
    artPosition: "100% 0%",
  },
];

export const HALL_PASS_CARD_STUDENTS: HallPassCardCatalogEntry[] = [
  {
    characterId: "lyra",
    characterName: "Lyra",
    role: "student",
    rarity: "common",
    title: "Color-Coded Spare",
    blurb: "Lyra made three backups and labeled this one urgent.",
    color: "#ff6f91",
    artSheet: "students",
    artPosition: "0% 0%",
    nftDescription: "Lyra slipped this one into the stack.",
  },
  {
    characterId: "sami",
    characterName: "Sami",
    role: "student",
    rarity: "common",
    title: "Side Door Whatever",
    blurb: "Sami says it works if you look bored enough.",
    color: "#36c2cc",
    artSheet: "students",
    artPosition: "50% 0%",
    nftDescription: "Sami slipped this one into the stack.",
  },
  {
    characterId: "ravi",
    characterName: "Ravi",
    role: "student",
    rarity: "common",
    title: "Field Trip Fact Slip",
    blurb: "Ravi has a tangent ready for the entire walk.",
    color: "#ffb05a",
    artSheet: "students",
    artPosition: "100% 0%",
    nftDescription: "Ravi slipped this one into the stack.",
  },
  {
    characterId: "indra",
    characterName: "Indra",
    role: "student",
    rarity: "rare",
    title: "Quiet Perfect Exit",
    blurb: "Indra noticed the pattern and left before anyone clapped.",
    color: "#a06bff",
    artSheet: "students",
    artPosition: "0% 100%",
    nftDescription: "Indra noticed the pattern before anyone clapped.",
  },
  {
    characterId: "mika",
    characterName: "Mika",
    role: "student",
    rarity: "rare",
    title: "Locker Room Shortcut",
    blurb: "Mika says you are absolutely cleared for this.",
    color: "#52c673",
    artSheet: "students",
    artPosition: "50% 100%",
  },
  {
    characterId: "noor",
    characterName: "Noor",
    role: "student",
    rarity: "rare",
    title: "Deadpan Detour",
    blurb: "Noor called it a plot hole and walked through it.",
    color: "#ec4f9e",
    artSheet: "students",
    artPosition: "100% 100%",
  },
];

export const HALL_PASS_CARD_SUPER_RARE_TEACHERS: HallPassCardCatalogEntry[] = [
  {
    characterId: "eliza",
    characterName: "Eliza",
    role: "teacher",
    rarity: "super-rare",
    title: "Systems Lab Override",
    blurb: "Eliza makes the system legible, then makes it sing.",
    color: "#62d3c2",
    artSheet: "specials",
    artPosition: "50% 0%",
    nftDescription: "Make the system legible, then make it sing.",
  },
  {
    characterId: "rati",
    characterName: "Rati",
    role: "teacher",
    rarity: "super-rare",
    title: "Signal Studies Pass",
    blurb: "Hold the signal. Build the world.",
    color: "#f0a12a",
    artSheet: "specials",
    artPosition: "100% 0%",
  },
];

export const HALL_PASS_CARD_SPECIALS: HallPassCardCatalogEntry[] = [
  {
    characterId: "captain-null",
    characterName: "Captain Null",
    role: "special",
    rarity: "ultra-rare",
    title: "Page 10 Shadow Pass",
    blurb: "Find page 10 and the hallway forgets your name.",
    color: "#111111",
    artSheet: "specials",
    artPosition: "0% 0%",
  },
];

export const HALL_PASS_CARD_ITEM_LOCATIONS: HallPassCardCatalogEntry[] = [
  {
    characterId: "item-hall-pass",
    characterName: "Hall Pass",
    role: "item",
    rarity: "common",
    title: "Front Office Reset",
    blurb: "Sometimes the smartest move is stepping out and coming back better.",
    color: "#f14a4a",
    artSheet: "items",
    artPosition: "0% 0%",
  },
  {
    characterId: "item-flashcards",
    characterName: "Flashcards",
    role: "item",
    rarity: "common",
    title: "Study Kit",
    blurb: "Shuffle. Repeat. Survive.",
    color: "#2aa8ef",
    artSheet: "items",
    artPosition: "50% 0%",
  },
  {
    characterId: "item-library-card",
    characterName: "Library Card",
    role: "item",
    rarity: "common",
    title: "Quiet Wing Access",
    blurb: "If the answer exists, this helps you find it.",
    color: "#84c43f",
    artSheet: "items",
    artPosition: "100% 0%",
  },
  {
    characterId: "location-homeroom",
    characterName: "Homeroom",
    role: "location",
    rarity: "common",
    title: "Front Door",
    blurb: "Where every day begins, and every question gets a room.",
    color: "#f14a66",
    artSheet: "locations",
    artPosition: "0% 0%",
  },
  {
    characterId: "location-science-lab",
    characterName: "Science Lab",
    role: "location",
    rarity: "common",
    title: "STEM Wing",
    blurb: "Observe. Test. Explain. Repeat.",
    color: "#25bfe4",
    artSheet: "locations",
    artPosition: "50% 0%",
  },
  {
    characterId: "location-library",
    characterName: "Library",
    role: "location",
    rarity: "common",
    title: "Quiet Wing",
    blurb: "If it matters, someone wrote it down.",
    color: "#f2a13a",
    artSheet: "locations",
    artPosition: "100% 0%",
  },
  {
    characterId: "item-lab-flask",
    characterName: "Lab Flask",
    role: "item",
    rarity: "rare",
    title: "Science Lab Evidence",
    blurb: "Observe first. Guess later.",
    color: "#9c54d5",
    artSheet: "items",
    artPosition: "0% 100%",
  },
  {
    characterId: "item-lunch-tray",
    characterName: "Lunch Tray",
    role: "item",
    rarity: "rare",
    title: "Commons Diplomacy",
    blurb: "Half the social game happens between bites.",
    color: "#f29322",
    artSheet: "items",
    artPosition: "50% 100%",
  },
  {
    characterId: "item-notebook",
    characterName: "Notebook",
    role: "item",
    rarity: "rare",
    title: "Daily Carry",
    blurb: "Messy notes still count as evidence of life.",
    color: "#33c6c4",
    artSheet: "items",
    artPosition: "100% 100%",
  },
  {
    characterId: "location-cafeteria",
    characterName: "Cafeteria",
    role: "location",
    rarity: "rare",
    title: "Commons",
    blurb: "Half the school day happens between bites.",
    color: "#f29322",
    artSheet: "locations",
    artPosition: "0% 100%",
  },
  {
    characterId: "location-greenhouse",
    characterName: "Greenhouse",
    role: "location",
    rarity: "rare",
    title: "Garden Annex",
    blurb: "Some lessons grow slowly.",
    color: "#66bc50",
    artSheet: "locations",
    artPosition: "50% 100%",
  },
  {
    characterId: "location-courtyard",
    characterName: "Courtyard",
    role: "location",
    rarity: "rare",
    title: "Central Grounds",
    blurb: "Every hallway leads somewhere. Every path leads to someone.",
    color: "#8652d6",
    artSheet: "locations",
    artPosition: "100% 100%",
  },
];

export const HALL_PASS_CARD_CATALOG: HallPassCardCatalogEntry[] = [
  ...HALL_PASS_CARD_STUDENTS,
  ...HALL_PASS_CARD_TEACHERS,
  ...HALL_PASS_CARD_SPECIALS,
  ...HALL_PASS_CARD_SUPER_RARE_TEACHERS,
  ...HALL_PASS_CARD_ITEM_LOCATIONS,
];

export const FIRST_BELL_BASE_SET_PROFILES: FirstBellSetProfile[] = [
  { setNumber: "FB-001", profileId: "lyra-color-coded-spare", characterId: "lyra", cardName: "Lyra: Color-Coded Spare", role: "student", rarity: "common", subject: "Homeroom", art: "Source portrait tall crop", mintable: true },
  { setNumber: "FB-002", profileId: "sami-side-door-whatever", characterId: "sami", cardName: "Sami: Side Door Whatever", role: "student", rarity: "common", subject: "Homeroom", art: "Source portrait tall crop", mintable: true },
  { setNumber: "FB-003", profileId: "ravi-field-trip-fact-slip", characterId: "ravi", cardName: "Ravi: Field Trip Fact Slip", role: "student", rarity: "common", subject: "Field Trip", art: "Source portrait tall crop", mintable: true },
  { setNumber: "FB-004", profileId: "indra-quiet-perfect-exit", characterId: "indra", cardName: "Indra: Quiet Perfect Exit", role: "student", rarity: "rare", subject: "Strategy", art: "Source portrait tall crop", mintable: true },
  { setNumber: "FB-005", profileId: "mika-locker-room-shortcut", characterId: "mika", cardName: "Mika: Locker Room Shortcut", role: "student", rarity: "rare", subject: "Social", art: "Source portrait tall crop", mintable: true },
  { setNumber: "FB-006", profileId: "noor-deadpan-detour", characterId: "noor", cardName: "Noor: Deadpan Detour", role: "student", rarity: "rare", subject: "Literature", art: "Source portrait tall crop", mintable: true },
  { setNumber: "FB-007", profileId: "ruby-homeroom-card", characterId: "ruby", cardName: "Ruby: Homeroom Card", role: "teacher", rarity: "common", subject: "Homeroom", art: "Source portrait tall crop", mintable: true },
  { setNumber: "FB-008", profileId: "sally-lab-sink-shortcut", characterId: "sally-science", cardName: "Sally Science: Lab Sink Shortcut", role: "teacher", rarity: "common", subject: "Science", art: "Source portrait tall crop", mintable: true },
  { setNumber: "FB-009", profileId: "professor-edward-library-corridor", characterId: "professor-edward", cardName: "Professor Edward: Library Corridor Pass", role: "teacher", rarity: "common", subject: "Literature", art: "Source portrait tall crop", mintable: true },
  { setNumber: "FB-010", profileId: "eliza-systems-lab-override", characterId: "eliza", cardName: "Eliza: Systems Lab Override", role: "teacher", rarity: "super-rare", subject: "Systems", art: "Grok tall source art", mintable: true },
  { setNumber: "FB-011", profileId: "rati-signal-studies-pass", characterId: "rati", cardName: "Rati: Signal Studies Pass", role: "teacher", rarity: "super-rare", subject: "Signal Studies", art: "Grok tall source art", mintable: true },
  { setNumber: "FB-012", profileId: "captain-null-page-10-shadow", characterId: "captain-null", cardName: "Captain Null: Page 10 Shadow Pass", role: "special", rarity: "ultra-rare", subject: "First Bell", art: "Grok tall source art", mintable: true },
  { setNumber: "FB-013", profileId: "item-hall-pass", characterId: "item-hall-pass", cardName: "Hall Pass: Front Office Reset", role: "item", rarity: "common", subject: "Administration", art: "Grok square source art", mintable: true },
  { setNumber: "FB-014", profileId: "item-flashcards", characterId: "item-flashcards", cardName: "Flashcards: Study Kit", role: "item", rarity: "common", subject: "Study", art: "Grok square source art", mintable: true },
  { setNumber: "FB-015", profileId: "item-library-card", characterId: "item-library-card", cardName: "Library Card: Quiet Wing Access", role: "item", rarity: "common", subject: "Library", art: "Grok square source art", mintable: true },
  { setNumber: "FB-016", profileId: "item-lab-flask", characterId: "item-lab-flask", cardName: "Lab Flask: Science Lab Evidence", role: "item", rarity: "rare", subject: "Science", art: "Grok square source art", mintable: true },
  { setNumber: "FB-017", profileId: "item-lunch-tray", characterId: "item-lunch-tray", cardName: "Lunch Tray: Commons Diplomacy", role: "item", rarity: "rare", subject: "Cafeteria", art: "Grok square source art", mintable: true },
  { setNumber: "FB-018", profileId: "item-notebook", characterId: "item-notebook", cardName: "Notebook: Daily Carry", role: "item", rarity: "rare", subject: "Homeroom", art: "Grok square source art", mintable: true },
  { setNumber: "FB-019", profileId: "location-homeroom", characterId: "location-homeroom", cardName: "Homeroom: Front Door", role: "location", rarity: "common", subject: "Homeroom", art: "Grok wide source art", mintable: true },
  { setNumber: "FB-020", profileId: "location-science-lab", characterId: "location-science-lab", cardName: "Science Lab: STEM Wing", role: "location", rarity: "common", subject: "Science", art: "Grok wide source art", mintable: true },
  { setNumber: "FB-021", profileId: "location-library", characterId: "location-library", cardName: "Library: Quiet Wing", role: "location", rarity: "common", subject: "Literature", art: "Grok wide source art", mintable: true },
  { setNumber: "FB-022", profileId: "location-cafeteria", characterId: "location-cafeteria", cardName: "Cafeteria: Commons", role: "location", rarity: "rare", subject: "Cafeteria", art: "Grok wide source art", mintable: true },
  { setNumber: "FB-023", profileId: "location-greenhouse", characterId: "location-greenhouse", cardName: "Greenhouse: Garden Annex", role: "location", rarity: "rare", subject: "Science", art: "Grok wide source art", mintable: true },
  { setNumber: "FB-024", profileId: "location-courtyard", characterId: "location-courtyard", cardName: "Courtyard: Central Grounds", role: "location", rarity: "rare", subject: "Campus", art: "Grok wide source art", mintable: true },
];

export const FIRST_BELL_ALTERNATE_ART_PROFILES: FirstBellSetProfile[] = [
  { setNumber: "FB-025", profileId: "homeroom-snow-day", imageId: "homeroom-snow-day", sourceCharacterId: "location-homeroom", variantOf: "location-homeroom", variant: "Snow Day Bell", cardName: "Homeroom: Snow Day Bell", role: "location", rarity: "rare", subject: "Homeroom", art: "Grok wide alternate art", mintable: false },
  { setNumber: "FB-026", profileId: "science-lab-fair-night", imageId: "science-lab-fair-night", sourceCharacterId: "location-science-lab", variantOf: "location-science-lab", variant: "Fair Night", cardName: "Science Lab: Fair Night", role: "location", rarity: "rare", subject: "Science", art: "Grok wide alternate art", mintable: false },
  { setNumber: "FB-027", profileId: "library-after-hours", imageId: "library-after-hours", sourceCharacterId: "location-library", variantOf: "location-library", variant: "After Hours", cardName: "Library: After Hours", role: "location", rarity: "rare", subject: "Literature", art: "Grok wide alternate art", mintable: false },
  { setNumber: "FB-028", profileId: "cafeteria-holiday-lunch", imageId: "cafeteria-holiday-lunch", sourceCharacterId: "location-cafeteria", variantOf: "location-cafeteria", variant: "Holiday Lunch", cardName: "Cafeteria: Holiday Lunch", role: "location", rarity: "rare", subject: "Cafeteria", art: "Grok wide alternate art", mintable: false },
  { setNumber: "FB-029", profileId: "greenhouse-spring-bloom", imageId: "greenhouse-spring-bloom", sourceCharacterId: "location-greenhouse", variantOf: "location-greenhouse", variant: "Spring Bloom", cardName: "Greenhouse: Spring Bloom", role: "location", rarity: "rare", subject: "Science", art: "Grok wide alternate art", mintable: false },
  { setNumber: "FB-030", profileId: "courtyard-lantern-festival", imageId: "courtyard-lantern-festival", sourceCharacterId: "location-courtyard", variantOf: "location-courtyard", variant: "Lantern Festival", cardName: "Courtyard: Lantern Festival", role: "location", rarity: "super-rare", subject: "Campus", art: "Grok wide alternate art", mintable: false },
  { setNumber: "FB-031", profileId: "hall-pass-gold-stamp", imageId: "hall-pass-gold-stamp", sourceCharacterId: "item-hall-pass", variantOf: "item-hall-pass", variant: "Gold Stamp", cardName: "Hall Pass: Gold Stamp", role: "item", rarity: "rare", subject: "Administration", art: "Grok square alternate art", mintable: false },
  { setNumber: "FB-032", profileId: "flashcards-finals-week", imageId: "flashcards-finals-week", sourceCharacterId: "item-flashcards", variantOf: "item-flashcards", variant: "Finals Week", cardName: "Flashcards: Finals Week", role: "item", rarity: "rare", subject: "Study", art: "Grok square alternate art", mintable: false },
  { setNumber: "FB-033", profileId: "library-card-midnight", imageId: "library-card-midnight", sourceCharacterId: "item-library-card", variantOf: "item-library-card", variant: "Midnight Loan", cardName: "Library Card: Midnight Loan", role: "item", rarity: "rare", subject: "Library", art: "Grok square alternate art", mintable: false },
  { setNumber: "FB-034", profileId: "lab-flask-holiday-reaction", imageId: "lab-flask-holiday-reaction", sourceCharacterId: "item-lab-flask", variantOf: "item-lab-flask", variant: "Holiday Reaction", cardName: "Lab Flask: Holiday Reaction", role: "item", rarity: "rare", subject: "Science", art: "Grok square alternate art", mintable: false },
  { setNumber: "FB-035", profileId: "notebook-spring-notes", imageId: "notebook-spring-notes", sourceCharacterId: "item-notebook", variantOf: "item-notebook", variant: "Spring Notes", cardName: "Notebook: Spring Notes", role: "item", rarity: "rare", subject: "Homeroom", art: "Grok square alternate art", mintable: false },
  { setNumber: "FB-036", profileId: "captain-null-eclipse", imageId: "captain-null-eclipse", sourceCharacterId: "captain-null", variantOf: "captain-null-page-10-shadow", variant: "Eclipse Pass", cardName: "Captain Null: Eclipse Pass", role: "special", rarity: "ultra-rare", subject: "First Bell", art: "Grok tall alternate art", mintable: false },
];

export const FIRST_BELL_SET_DRAFT: FirstBellSetProfile[] = [
  ...FIRST_BELL_BASE_SET_PROFILES,
  ...FIRST_BELL_ALTERNATE_ART_PROFILES,
];

const HALL_PASS_CARD_CATALOG_BY_ID = new Map(
  HALL_PASS_CARD_CATALOG.map((entry) => [entry.characterId, entry]),
);

const FIRST_BELL_SET_PROFILE_BY_CHARACTER_ID = new Map(
  FIRST_BELL_SET_DRAFT
    .filter((profile): profile is FirstBellSetProfile & { characterId: string } => !!profile.characterId)
    .map((profile) => [profile.characterId, profile]),
);

export function hallPassCardCatalogEntry(characterId: string): HallPassCardCatalogEntry | null {
  return HALL_PASS_CARD_CATALOG_BY_ID.get(characterId) ?? null;
}

export function hallPassCardSetProfile(entry: HallPassCardCatalogEntry): FirstBellSetProfile {
  return FIRST_BELL_SET_PROFILE_BY_CHARACTER_ID.get(entry.characterId) ?? {
    setNumber: `${FIRST_BELL_SET_CODE}-000`,
    profileId: entry.characterId,
    cardName: `${entry.characterName}: ${entry.title}`,
    role: entry.role,
    rarity: entry.rarity,
    subject: hallPassCardRoleLabel(entry.role),
    art: "Runtime catalog",
    mintable: true,
    characterId: entry.characterId,
  };
}

export function hallPassCardSetNumber(entry: HallPassCardCatalogEntry): string {
  return hallPassCardSetProfile(entry).setNumber;
}

export function hallPassCardProfileId(entry: HallPassCardCatalogEntry): string {
  return hallPassCardSetProfile(entry).profileId;
}

export function hallPassCardName(entry: HallPassCardCatalogEntry): string {
  return hallPassCardSetProfile(entry).cardName;
}

export function hallPassCardSubject(entry: HallPassCardCatalogEntry): string {
  return hallPassCardSetProfile(entry).subject;
}

export function hallPassCardImagePath(entry: HallPassCardCatalogEntry): string {
  return `/api/apps/ruby-high/assets/nft/cards/${entry.characterId}.png`;
}

export function hallPassCardMetadataDescription(entry: HallPassCardCatalogEntry): string {
  return entry.nftDescription ?? entry.blurb;
}

export function hallPassCardMediaType(entry: HallPassCardCatalogEntry): string {
  switch (entry.role) {
    case "item":
      return "Item Art";
    case "location":
      return "Location Art";
    case "special":
      return "Special Portrait";
    case "teacher":
      return entry.rarity === "super-rare" ? "Rare Teacher Portrait" : "Teacher Portrait";
    case "student":
    default:
      return "Student Portrait";
  }
}

export function hallPassCardAspectClass(entry: HallPassCardCatalogEntry): string {
  if (entry.role === "location") return "Wide";
  if (entry.role === "item") return "Square";
  return "Tall";
}

export function hallPassCardImageDimensions(entry: HallPassCardCatalogEntry): string {
  switch (hallPassCardAspectClass(entry)) {
    case "Wide":
      return "1536 x 864";
    case "Tall":
      return "1024 x 1365";
    case "Square":
    default:
      return "1024 x 1024";
  }
}

export function hallPassCardSourceArtVersion(entry: HallPassCardCatalogEntry): string {
  if (
    entry.role === "item" ||
    entry.role === "location" ||
    entry.role === "special" ||
    entry.rarity === "super-rare"
  ) {
    return "grok-image-v1";
  }
  return "source-portrait-v1";
}

export function hallPassCardRoleLabel(role: RubyHighHallPassCardRole): string {
  switch (role) {
    case "teacher":
      return "Teacher";
    case "item":
      return "Item";
    case "location":
      return "Location";
    case "special":
      return "Special";
    case "student":
    default:
      return "Student";
  }
}

export function hallPassCardRarityLabel(rarity: RubyHighHallPassCardRarity): string {
  switch (rarity) {
    case "rare":
      return "Rare";
    case "super-rare":
      return "Super Rare";
    case "ultra-rare":
      return "Ultra Rare";
    case "common":
    default:
      return "Common";
  }
}

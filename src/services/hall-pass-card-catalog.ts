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

const HALL_PASS_CARD_CATALOG_BY_ID = new Map(
  HALL_PASS_CARD_CATALOG.map((entry) => [entry.characterId, entry]),
);

export function hallPassCardCatalogEntry(characterId: string): HallPassCardCatalogEntry | null {
  return HALL_PASS_CARD_CATALOG_BY_ID.get(characterId) ?? null;
}

export function hallPassCardImagePath(entry: HallPassCardCatalogEntry): string {
  return `/api/apps/ruby-high/assets/nft/market-cards/${entry.characterId}.png`;
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
  if (entry.role === "special" || entry.rarity === "super-rare") return "Tall";
  return "Square";
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

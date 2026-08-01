export interface RubyHighPhotoScene {
  id: string;
  roomName: string;
  setting: string;
  action: string;
  camera: string;
  props: string;
}

export const RUBY_HIGH_PHOTO_PROMPT_VERSION = "ruby-high-dynamic-campus-photo-v2";

const TEACHER_LOUNGE_SCENE: RubyHighPhotoScene = {
  id: "teacher-lounge",
  roomName: "Ruby High teacher's lounge",
  setting: "a lived-in staff room with mismatched armchairs, a low coffee table, faculty cubbies, a humming kettle, classroom notes, and warm window light",
  action: "The faculty are caught between classes: one teacher sets down a stack of marked papers, another gestures through an animated idea, and the third reacts with dry amusement over a mug.",
  camera: "wide candid corner angle with foreground furniture, layered depth, clear faces, and natural conversational body language",
  props: "ceramic mugs, marked papers without readable text, a kettle, satchels, pens, a small plant, and a crowded noticeboard with abstract shapes only",
};

const SCHOOL_PHOTO_SCENES: RubyHighPhotoScene[] = [
  {
    id: "courtyard",
    roomName: "Ruby High courtyard",
    setting: "an open-air brick courtyard with benches, planters, red school banners, bright windows, and the school doors in the distance",
    action: "The group is caught mid-celebration: one student steps off a low bench or stair, the classmate throws ribbon streamers or flashes a peace sign, and the teacher reacts warmly while keeping the scene grounded.",
    camera: "low three-quarter angle with diagonal depth across the courtyard, candid shutter timing, clear faces, and lively silhouettes",
    props: "satchels, loose papers, ribbon streamers, graduation keepsakes, sunlit tree shadows, and a few scuffed school tiles",
  },
  {
    id: "science-lab",
    roomName: "Ruby High science lab",
    setting: "a bright lab with black-top tables, safety goggles, glassware, models, colorful reagent bottles, and window light bouncing off clean tile",
    action: "The trio is celebrating around a safe tabletop experiment: one student pumps a fist, the classmate holds goggles up like a trophy, and the teacher gestures toward the harmless burst of color.",
    camera: "wide environmental angle across the lab benches with foreground props, asymmetric spacing, and expressive hands",
    props: "safety goggles, notebooks, a beaker with colored water, lab stools, posters, and tidy equipment trays",
  },
  {
    id: "library",
    roomName: "Ruby High library",
    setting: "a warm library corner with tall shelves, study tables, a rolling book cart, reading lamps, and late-afternoon window light",
    action: "The photo catches them between shelves: one student balances a stack of books with comic determination, the classmate leans into frame laughing, and the teacher gives a dry approving look.",
    camera: "over-the-table wide shot with shelf depth, warm lamp pools, readable faces, and a candid yearbook feel",
    props: "book stacks, library cards, a half-open notebook, bookmarks, a return cart, and paper slips tucked into shelves",
  },
  {
    id: "front-steps",
    roomName: "Ruby High front steps",
    setting: "the main school entrance with broad steps, brick columns, glass doors, red banners, and the campus walkway behind them",
    action: "The group bursts out onto the steps after the ceremony: one student is mid-leap, the classmate swings a backpack or diploma folder, and the teacher steadies the moment with proud restraint.",
    camera: "heroic wide shot from below the steps with strong diagonals, sky light, clear full-body staging, and natural motion",
    props: "graduation folders, backpacks, red banners, scattered confetti, worn stair edges, and afternoon sky",
  },
  {
    id: "cafeteria",
    roomName: "Ruby High cafeteria",
    setting: "a busy cafeteria after lunch with long tables, trays, vending machines, posters, and sunlight cutting across the floor",
    action: "The trio is building an improvised celebration at a lunch table: one student stands on the bench, the classmate raises a juice carton toast, and the teacher laughs despite trying not to.",
    camera: "wide candid cafeteria angle with table lines leading into the frame, distinct poses, and playful controlled chaos",
    props: "lunch trays, notebooks, juice cartons, napkins, chairs, wall posters, and a half-erased announcement board",
  },
  {
    id: "greenhouse",
    roomName: "Ruby High greenhouse",
    setting: "a glass greenhouse with potted plants, hanging vines, watering cans, work tables, and soft green filtered light",
    action: "The group celebrates among the plants: one student presents a tiny seedling like a medal, the classmate ducks under a vine, and the teacher points out the living proof of progress.",
    camera: "lush wide shot through leaves in the foreground, layered depth, soft backlight, and readable character shapes",
    props: "seedlings, watering cans, plant labels without readable text, work gloves, soil bags, and hanging vines",
  },
  {
    id: "hallway",
    roomName: "Ruby High hallway",
    setting: "a locker-lined hallway with polished floors, trophy cases, classroom doors, bulletin boards, and warm light from high windows",
    action: "The scene lands during a passing-period victory lap: one student skids to a stop, the classmate points toward the trophy case, and the teacher keeps stride beside them.",
    camera: "long hallway perspective with diagonal movement, motion in the feet and hands, and clear faces turned toward each other",
    props: "lockers, trophy case reflections, papers, backpacks, floor shine, and bulletin board shapes with no readable text",
  },
  {
    id: "auditorium",
    roomName: "Ruby High auditorium",
    setting: "a small school auditorium with wooden stage boards, curtains, aisle lights, folding chairs, and a soft spotlight glow",
    action: "The trio is caught just offstage after the ceremony: one student bows too dramatically, the classmate applauds, and the teacher offers a proud half-smile from the wing.",
    camera: "wide stage-side angle with curtain depth, strong gesture silhouettes, and a polished keepsake composition",
    props: "folding chairs, curtain ropes, stage tape, a diploma folder, soft spotlights, and backstage shadows",
  },
];

const GRADE_SCENE_IDS: Record<string, string> = {
  "9": "courtyard",
  "10": "science-lab",
  "11": "library",
  "12": "front-steps",
};

const SCENE_BY_ID = new Map(SCHOOL_PHOTO_SCENES.map((scene) => [scene.id, scene] as const));

function stableIndex(seed: string, count: number): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % count;
}

export function rubyHighPhotoSceneForGrade(
  grade: string | number | null | undefined,
  seed = "ruby-high",
): RubyHighPhotoScene {
  const gradeId = String(grade ?? "").match(/\d+/)?.[0] ?? "";
  const preferred = GRADE_SCENE_IDS[gradeId];
  if (preferred) return SCENE_BY_ID.get(preferred) ?? SCHOOL_PHOTO_SCENES[0]!;
  return SCHOOL_PHOTO_SCENES[stableIndex(seed || "ruby-high", SCHOOL_PHOTO_SCENES.length)]!;
}

export function rubyHighPhotoSceneForSchoolUpdate(
  area: "classroom" | "teacher-lounge",
  grade: string | number | null | undefined,
  seed = "ruby-high-update",
): RubyHighPhotoScene {
  if (area === "teacher-lounge") return TEACHER_LOUNGE_SCENE;
  return rubyHighPhotoSceneForGrade(grade, seed);
}

window.RUBY2_ENGINE_SNAPSHOTS = [
  {
    "schema": "ruby2.ui.snapshot.v1",
    "roomId": "homeroom",
    "room": "Homeroom",
    "timeBlockId": "arrival",
    "timeBlock": "Arrival",
    "clocks": {
      "Bell": 0,
      "Stress": 0,
      "Rumor": 0,
      "Null Signal": 0
    },
    "disciplines": {
      "Source": 0,
      "Sense": 0,
      "Sync": 0,
      "Signal": 0
    },
    "people": [
      {
        "id": "ruby",
        "name": "Ruby"
      },
      {
        "id": "lyra",
        "name": "Lyra"
      },
      {
        "id": "ravi",
        "name": "Ravi"
      }
    ],
    "objects": [
      {
        "id": "answer_card",
        "name": "answer card"
      },
      {
        "id": "wet_work_order",
        "name": "wet work order"
      },
      {
        "id": "notebook",
        "name": "Notebook"
      }
    ],
    "actions": [
      {
        "id": 8,
        "actionId": "approach_source",
        "kind": "approach",
        "label": "Compare the answer card with the wet work-order stamp.",
        "disciplineId": "source",
        "discipline": "Source",
        "virtueId": "honor",
        "virtue": "Honor",
        "rankScore": 1.61056
      },
      {
        "id": 9,
        "actionId": "approach_sense",
        "kind": "approach",
        "label": "Ask what original is supposed to mean.",
        "disciplineId": "sense",
        "discipline": "Sense",
        "virtueId": "head",
        "virtue": "Head",
        "rankScore": 1.53278
      },
      {
        "id": 10,
        "actionId": "approach_sync",
        "kind": "approach",
        "label": "Ask Ravi and Lyra what each of them can verify.",
        "disciplineId": "sync",
        "discipline": "Sync",
        "virtueId": "heart",
        "virtue": "Heart",
        "rankScore": 1.465
      },
      {
        "id": 11,
        "actionId": "approach_signal",
        "kind": "approach",
        "label": "Circle the footer Ruby says she did not print.",
        "disciplineId": "signal",
        "discipline": "Signal",
        "virtueId": "honor",
        "virtue": "Honor",
        "rankScore": 1.25722
      },
      {
        "id": 0,
        "actionId": "go_hallway",
        "kind": "go",
        "label": "Go to Hallway",
        "disciplineId": "sync",
        "discipline": "Sync",
        "virtueId": "hustle",
        "virtue": "Hustle",
        "rankScore": 1.07833
      },
      {
        "id": 3,
        "actionId": "talk_ruby",
        "kind": "talk",
        "label": "Talk to Ruby",
        "disciplineId": "sync",
        "discipline": "Sync",
        "virtueId": "heart",
        "virtue": "Heart",
        "rankScore": 0.949444
      },
      {
        "id": 4,
        "actionId": "talk_lyra",
        "kind": "talk",
        "label": "Talk to Lyra",
        "disciplineId": "sync",
        "discipline": "Sync",
        "virtueId": "heart",
        "virtue": "Heart",
        "rankScore": 0.891667
      },
      {
        "id": 5,
        "actionId": "talk_ravi",
        "kind": "talk",
        "label": "Talk to Ravi",
        "disciplineId": "source",
        "discipline": "Source",
        "virtueId": "hustle",
        "virtue": "Hustle",
        "rankScore": 0.863889
      },
      {
        "id": 13,
        "actionId": "check_notebook",
        "kind": "check_notes",
        "label": "Check Notebook",
        "disciplineId": "sense",
        "discipline": "Sense",
        "virtueId": "head",
        "virtue": "Head",
        "rankScore": 0.546111
      },
      {
        "id": 14,
        "actionId": "wait_bell",
        "kind": "wait",
        "label": "Wait for the bell",
        "disciplineId": "sync",
        "discipline": "Sync",
        "virtueId": "hustle",
        "virtue": "Hustle",
        "rankScore": 0.258333
      }
    ],
    "events": [
      {
        "kind": "room_entered",
        "tick": 0,
        "roomId": "hallway",
        "characterId": null,
        "character": null,
        "objectId": "notebook",
        "object": "Notebook",
        "actionId": "go_hallway",
        "text": "You are in the Hallway. Homeroom is reachable before the bell makes it non-optional."
      },
      {
        "kind": "room_entered",
        "tick": 1,
        "roomId": "homeroom",
        "characterId": null,
        "character": null,
        "objectId": "notebook",
        "object": "Notebook",
        "actionId": "go_homeroom",
        "text": "Go to Homeroom"
      },
      {
        "kind": "class_started",
        "tick": 2,
        "roomId": "homeroom",
        "characterId": "ruby",
        "character": "Ruby",
        "objectId": "answer_card",
        "object": "answer card",
        "actionId": "attend_homeroom",
        "text": "Ruby starts the work-order problem."
      }
    ],
    "sceneId": "homeroom-problem",
    "sceneTitle": "Homeroom Problem"
  },
  {
    "schema": "ruby2.ui.snapshot.v1",
    "roomId": "cafeteria",
    "room": "Cafeteria",
    "timeBlockId": "lunch",
    "timeBlock": "Lunch",
    "clocks": {
      "Bell": 0,
      "Stress": 0,
      "Rumor": 0,
      "Null Signal": 0
    },
    "disciplines": {
      "Source": 1,
      "Sense": 0,
      "Sync": 0,
      "Signal": 0
    },
    "people": [
      {
        "id": "lyra",
        "name": "Lyra"
      },
      {
        "id": "noor",
        "name": "Noor"
      }
    ],
    "objects": [
      {
        "id": "zero_dollar_receipt",
        "name": "zero-dollar receipt"
      },
      {
        "id": "notebook",
        "name": "Notebook"
      }
    ],
    "actions": [
      {
        "id": 12,
        "actionId": "inspect_receipt",
        "kind": "inspect",
        "label": "Inspect the zero-dollar receipt.",
        "disciplineId": "signal",
        "discipline": "Signal",
        "virtueId": "head",
        "virtue": "Head",
        "rankScore": 1.691
      },
      {
        "id": 0,
        "actionId": "go_hallway",
        "kind": "go",
        "label": "Go to Hallway",
        "disciplineId": "sync",
        "discipline": "Sync",
        "virtueId": "hustle",
        "virtue": "Hustle",
        "rankScore": 1.165
      },
      {
        "id": 4,
        "actionId": "talk_lyra",
        "kind": "talk",
        "label": "Talk to Lyra",
        "disciplineId": "sync",
        "discipline": "Sync",
        "virtueId": "heart",
        "virtue": "Heart",
        "rankScore": 1.117
      },
      {
        "id": 6,
        "actionId": "talk_noor",
        "kind": "talk",
        "label": "Talk to Noor",
        "disciplineId": "signal",
        "discipline": "Signal",
        "virtueId": "head",
        "virtue": "Head",
        "rankScore": 1.063
      },
      {
        "id": 13,
        "actionId": "check_notebook",
        "kind": "check_notes",
        "label": "Check Notebook",
        "disciplineId": "sense",
        "discipline": "Sense",
        "virtueId": "head",
        "virtue": "Head",
        "rankScore": 0.679
      },
      {
        "id": 14,
        "actionId": "wait_bell",
        "kind": "wait",
        "label": "Wait for the bell",
        "disciplineId": "sync",
        "discipline": "Sync",
        "virtueId": "hustle",
        "virtue": "Hustle",
        "rankScore": 0.345
      }
    ],
    "events": [
      {
        "kind": "room_entered",
        "tick": 0,
        "roomId": "hallway",
        "characterId": null,
        "character": null,
        "objectId": "notebook",
        "object": "Notebook",
        "actionId": "go_hallway",
        "text": "You are in the Hallway. Homeroom is reachable before the bell makes it non-optional."
      },
      {
        "kind": "room_entered",
        "tick": 1,
        "roomId": "homeroom",
        "characterId": null,
        "character": null,
        "objectId": "notebook",
        "object": "Notebook",
        "actionId": "go_homeroom",
        "text": "Go to Homeroom"
      },
      {
        "kind": "class_started",
        "tick": 2,
        "roomId": "homeroom",
        "characterId": "ruby",
        "character": "Ruby",
        "objectId": "answer_card",
        "object": "answer card",
        "actionId": "attend_homeroom",
        "text": "Ruby starts the work-order problem."
      },
      {
        "kind": "approach_resolved",
        "tick": 3,
        "roomId": "homeroom",
        "characterId": "ruby",
        "character": "Ruby",
        "objectId": "wet_work_order",
        "object": "wet work order",
        "actionId": "approach_source",
        "text": "Compare the answer card with the wet work-order stamp.",
        "performance": {
          "speakerId": "ruby",
          "speaker": "Ruby",
          "line": "Good. Now the answer has to survive the room."
        }
      },
      {
        "kind": "time_advanced",
        "tick": 3,
        "roomId": "homeroom",
        "characterId": null,
        "character": null,
        "objectId": "notebook",
        "object": "Notebook",
        "actionId": "wait_bell",
        "text": "The bell moves the school into lunch."
      },
      {
        "kind": "npc_moved",
        "tick": 3,
        "roomId": "cafeteria",
        "characterId": "noor",
        "character": "Noor",
        "objectId": "notebook",
        "object": "Notebook",
        "actionId": "wait_bell",
        "text": "Noor drifts to the Cafeteria before the receipt does anything interesting."
      },
      {
        "kind": "object_appeared",
        "tick": 3,
        "roomId": "cafeteria",
        "characterId": null,
        "character": null,
        "objectId": "zero_dollar_receipt",
        "object": "zero-dollar receipt",
        "actionId": "wait_bell",
        "text": "A zero-dollar receipt waits on the Cafeteria tray rail."
      },
      {
        "kind": "room_entered",
        "tick": 4,
        "roomId": "hallway",
        "characterId": null,
        "character": null,
        "objectId": "notebook",
        "object": "Notebook",
        "actionId": "go_hallway",
        "text": "Go to Hallway"
      },
      {
        "kind": "room_entered",
        "tick": 5,
        "roomId": "cafeteria",
        "characterId": null,
        "character": null,
        "objectId": "notebook",
        "object": "Notebook",
        "actionId": "go_cafeteria",
        "text": "Go to Cafeteria"
      },
      {
        "kind": "social_triggered",
        "tick": 5,
        "roomId": "cafeteria",
        "characterId": "noor",
        "character": "Noor",
        "objectId": "zero_dollar_receipt",
        "object": "zero-dollar receipt",
        "actionId": "go_cafeteria",
        "text": "Noor notices the zero-dollar receipt before anyone can turn it into a normal lunch.",
        "performance": {
          "speakerId": "noor",
          "speaker": "Noor",
          "line": "The receipt is trying too hard to be normal."
        }
      },
      {
        "kind": "agent_spoke",
        "tick": 5,
        "roomId": "cafeteria",
        "characterId": "noor",
        "character": "Noor",
        "objectId": "notebook",
        "object": "Notebook",
        "actionId": "none",
        "text": "Noor: The receipt is trying too hard to be normal."
      }
    ],
    "sceneId": "cafeteria-receipt",
    "sceneTitle": "Cafeteria Receipt"
  },
  {
    "schema": "ruby2.ui.snapshot.v1",
    "roomId": "cafeteria",
    "room": "Cafeteria",
    "timeBlockId": "lunch",
    "timeBlock": "Lunch",
    "clocks": {
      "Bell": 0,
      "Stress": 0,
      "Rumor": 0,
      "Null Signal": 1
    },
    "disciplines": {
      "Source": 1,
      "Sense": 0,
      "Sync": 0,
      "Signal": 1
    },
    "people": [
      {
        "id": "lyra",
        "name": "Lyra"
      },
      {
        "id": "noor",
        "name": "Noor"
      }
    ],
    "objects": [
      {
        "id": "zero_dollar_receipt",
        "name": "zero-dollar receipt"
      },
      {
        "id": "notebook",
        "name": "Notebook"
      }
    ],
    "actions": [
      {
        "id": 4,
        "actionId": "talk_lyra",
        "kind": "talk",
        "label": "Talk to Lyra",
        "disciplineId": "sync",
        "discipline": "Sync",
        "virtueId": "heart",
        "virtue": "Heart",
        "rankScore": 1.05083
      },
      {
        "id": 0,
        "actionId": "go_hallway",
        "kind": "go",
        "label": "Go to Hallway",
        "disciplineId": "sync",
        "discipline": "Sync",
        "virtueId": "hustle",
        "virtue": "Hustle",
        "rankScore": 1.02083
      },
      {
        "id": 6,
        "actionId": "talk_noor",
        "kind": "talk",
        "label": "Talk to Noor",
        "disciplineId": "signal",
        "discipline": "Signal",
        "virtueId": "head",
        "virtue": "Head",
        "rankScore": 0.970833
      },
      {
        "id": 13,
        "actionId": "check_notebook",
        "kind": "check_notes",
        "label": "Check Notebook",
        "disciplineId": "sense",
        "discipline": "Sense",
        "virtueId": "head",
        "virtue": "Head",
        "rankScore": 0.560833
      },
      {
        "id": 14,
        "actionId": "wait_bell",
        "kind": "wait",
        "label": "Wait for the bell",
        "disciplineId": "sync",
        "discipline": "Sync",
        "virtueId": "hustle",
        "virtue": "Hustle",
        "rankScore": 0.200833
      }
    ],
    "events": [
      {
        "kind": "room_entered",
        "tick": 0,
        "roomId": "hallway",
        "characterId": null,
        "character": null,
        "objectId": "notebook",
        "object": "Notebook",
        "actionId": "go_hallway",
        "text": "You are in the Hallway. Homeroom is reachable before the bell makes it non-optional."
      },
      {
        "kind": "room_entered",
        "tick": 1,
        "roomId": "homeroom",
        "characterId": null,
        "character": null,
        "objectId": "notebook",
        "object": "Notebook",
        "actionId": "go_homeroom",
        "text": "Go to Homeroom"
      },
      {
        "kind": "class_started",
        "tick": 2,
        "roomId": "homeroom",
        "characterId": "ruby",
        "character": "Ruby",
        "objectId": "answer_card",
        "object": "answer card",
        "actionId": "attend_homeroom",
        "text": "Ruby starts the work-order problem."
      },
      {
        "kind": "approach_resolved",
        "tick": 3,
        "roomId": "homeroom",
        "characterId": "ruby",
        "character": "Ruby",
        "objectId": "wet_work_order",
        "object": "wet work order",
        "actionId": "approach_source",
        "text": "Compare the answer card with the wet work-order stamp.",
        "performance": {
          "speakerId": "ruby",
          "speaker": "Ruby",
          "line": "Good. Now the answer has to survive the room."
        }
      },
      {
        "kind": "time_advanced",
        "tick": 3,
        "roomId": "homeroom",
        "characterId": null,
        "character": null,
        "objectId": "notebook",
        "object": "Notebook",
        "actionId": "wait_bell",
        "text": "The bell moves the school into lunch."
      },
      {
        "kind": "npc_moved",
        "tick": 3,
        "roomId": "cafeteria",
        "characterId": "noor",
        "character": "Noor",
        "objectId": "notebook",
        "object": "Notebook",
        "actionId": "wait_bell",
        "text": "Noor drifts to the Cafeteria before the receipt does anything interesting."
      },
      {
        "kind": "object_appeared",
        "tick": 3,
        "roomId": "cafeteria",
        "characterId": null,
        "character": null,
        "objectId": "zero_dollar_receipt",
        "object": "zero-dollar receipt",
        "actionId": "wait_bell",
        "text": "A zero-dollar receipt waits on the Cafeteria tray rail."
      },
      {
        "kind": "room_entered",
        "tick": 4,
        "roomId": "hallway",
        "characterId": null,
        "character": null,
        "objectId": "notebook",
        "object": "Notebook",
        "actionId": "go_hallway",
        "text": "Go to Hallway"
      },
      {
        "kind": "room_entered",
        "tick": 5,
        "roomId": "cafeteria",
        "characterId": null,
        "character": null,
        "objectId": "notebook",
        "object": "Notebook",
        "actionId": "go_cafeteria",
        "text": "Go to Cafeteria"
      },
      {
        "kind": "social_triggered",
        "tick": 5,
        "roomId": "cafeteria",
        "characterId": "noor",
        "character": "Noor",
        "objectId": "zero_dollar_receipt",
        "object": "zero-dollar receipt",
        "actionId": "go_cafeteria",
        "text": "Noor notices the zero-dollar receipt before anyone can turn it into a normal lunch.",
        "performance": {
          "speakerId": "noor",
          "speaker": "Noor",
          "line": "The receipt is trying too hard to be normal."
        }
      },
      {
        "kind": "agent_spoke",
        "tick": 5,
        "roomId": "cafeteria",
        "characterId": "noor",
        "character": "Noor",
        "objectId": "notebook",
        "object": "Notebook",
        "actionId": "none",
        "text": "Noor: The receipt is trying too hard to be normal."
      },
      {
        "kind": "object_inspected",
        "tick": 6,
        "roomId": "cafeteria",
        "characterId": "noor",
        "character": "Noor",
        "objectId": "zero_dollar_receipt",
        "object": "zero-dollar receipt",
        "actionId": "inspect_receipt",
        "text": "The receipt repeats the footer from Homeroom.",
        "performance": {
          "speakerId": "noor",
          "speaker": "Noor",
          "line": "That footer has follow-through. Horrible quality in paper."
        }
      },
      {
        "kind": "notebook_updated",
        "tick": 6,
        "roomId": "cafeteria",
        "characterId": null,
        "character": null,
        "objectId": "notebook",
        "object": "Notebook",
        "actionId": "inspect_receipt",
        "text": "Notebook margin: receipt copied exactly; signal now has a place to sit."
      }
    ],
    "sceneId": "receipt-inspected",
    "sceneTitle": "Receipt Inspected"
  }
];

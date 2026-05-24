(function () {
  "use strict";

  // JS-loadable mirror of scene-layout.json so the prototype works from file://.
  const sceneLayout = {
    version: 2,
    composition: "dialogue-closeup",
    defaultScene: "homeroom",
    scenes: [
      {
        id: "homeroom",
        title: "Homeroom",
        kicker: "First Bell",
        status: ["Arrival", "Bell 0", "Signal quiet"],
        background: {
          src: "../../assets/nft/grok-sources/location-homeroom.jpg",
          alt: "Ruby High homeroom"
        },
        cast: {
          speaker: {
            id: "ruby",
            name: "Ruby",
            role: "teacher",
            src: "./generated/ruby-cutout.png",
            side: "left"
          },
          witnesses: [
            { id: "lyra", name: "Lyra", role: "student", src: "./generated/lyra-cutout.png", read: "checking the stamp twice" },
            { id: "ravi", name: "Ravi", role: "student", src: "./generated/ravi-cutout.png", read: "ready to prove something" }
          ]
        },
        itemSlots: [
          { id: "notebook", label: "Notebook", src: "../../assets/nft/cards/item-notebook.png", active: true },
          { id: "flashcards", label: "Flashcards", src: "../../assets/nft/cards/item-flashcards.png" }
        ],
        speech: {
          speaker: "Ruby",
          text: "The answer card says original. The wet stamp says revised. Before you answer, decide what you can actually trust."
        },
        notebookLine: "Room steady. Ruby present. Two objects disagree before the question starts.",
        actions: [
          "Compare the answer card with the wet work-order stamp.",
          "Ask what original is supposed to mean.",
          "Circle the footer Ruby says she did not print.",
          "Ask Ravi and Lyra what each can verify."
        ]
      },
      {
        id: "cafeteria",
        title: "Cafeteria",
        kicker: "Lunch Bell",
        status: ["Midday", "Table 3", "Rumor loud"],
        background: {
          src: "../../assets/nft/grok-sources/location-cafeteria.jpg",
          alt: "Ruby High cafeteria"
        },
        cast: {
          speaker: {
            id: "mika",
            name: "Mika",
            role: "student",
            src: "./generated/mika-cutout.png",
            side: "right"
          },
          witnesses: [
            { id: "sami", name: "Sami", role: "student", src: "./generated/sami-cutout.png", read: "watching the rumor spread" },
            { id: "noor", name: "Noor", role: "student", src: "./generated/noor-cutout.png", read: "already unimpressed" }
          ]
        },
        itemSlots: [
          { id: "lunch-tray", label: "Lunch Tray", src: "../../assets/nft/cards/item-lunch-tray.png", active: true },
          { id: "hall-pass", label: "Hall Pass", src: "../../assets/nft/cards/item-hall-pass.png" }
        ],
        speech: {
          speaker: "Mika",
          text: "Everyone heard the same announcement, but three tables copied three different versions."
        },
        notebookLine: "Cafeteria pressure: source order matters before popularity does.",
        actions: [
          "Ask who heard the announcement directly.",
          "Compare the tray note with the hallway copy.",
          "Separate repeats from first-hand details.",
          "Use the hall pass to check the posted notice."
        ]
      },
      {
        id: "library",
        title: "Library",
        kicker: "Quiet Period",
        status: ["After class", "Stack B", "Text unstable"],
        background: {
          src: "../../assets/nft/grok-sources/location-library.jpg",
          alt: "Ruby High library"
        },
        cast: {
          speaker: {
            id: "professor-edward",
            name: "Professor Edward",
            role: "teacher",
            src: "./generated/professor-edward-cutout.png",
            side: "left"
          },
          witnesses: [
            { id: "indra", name: "Indra", role: "student", src: "./generated/indra-cutout.png", read: "not touching the margin" },
            { id: "sally", name: "Sally Science", role: "teacher", src: "./generated/sally-science-cutout.png", read: "checking for a testable change" }
          ]
        },
        itemSlots: [
          { id: "library-card", label: "Library Card", src: "../../assets/nft/cards/item-library-card.png", active: true },
          { id: "notebook", label: "Notebook", src: "../../assets/nft/cards/item-notebook.png" }
        ],
        speech: {
          speaker: "Professor Edward",
          text: "The catalog agrees with the spine label. The margin note is the thing pretending to be older than it is."
        },
        notebookLine: "Library clue: stable sources agree, but the handwritten margin arrived late.",
        actions: [
          "Check the catalog card against the shelf label.",
          "Ask Indra which copy moved last.",
          "Mark the margin note as a later claim.",
          "Have Sally test whether the text changed."
        ]
      }
    ]
  };

  const roomBackgrounds = {
    hallway: "../../assets/nft/grok-sources/location-homeroom.jpg",
    homeroom: "../../assets/nft/grok-sources/location-homeroom.jpg",
    science_lab: "../../assets/nft/grok-sources/location-science-lab.jpg",
    library: "../../assets/nft/grok-sources/location-library.jpg",
    cafeteria: "../../assets/nft/grok-sources/location-cafeteria.jpg",
    greenhouse: "../../assets/nft/grok-sources/location-greenhouse.jpg",
    courtyard: "../../assets/nft/grok-sources/location-courtyard.jpg"
  };

  const characterAssets = {
    ruby: "./generated/ruby-cutout.png",
    lyra: "./generated/lyra-cutout.png",
    mika: "./generated/mika-cutout.png",
    ravi: "./generated/ravi-cutout.png",
    indra: "./generated/indra-cutout.png",
    noor: "./generated/noor-cutout.png",
    sami: "./generated/sami-cutout.png",
    "professor-edward": "./generated/professor-edward-cutout.png",
    sally: "./generated/sally-science-cutout.png"
  };

  const characterRoles = {
    ruby: "teacher",
    "professor-edward": "teacher",
    sally: "teacher"
  };

  const witnessReads = {
    lyra: "stamp's still wet.",
    ravi: "technically, evidence.",
    mika: "you cooked. for real.",
    noor: "trying too hard.",
    sami: "respectfully, weird.",
    indra: "it moved."
  };

  const objectCards = {
    answer_card: { title: "Answer", main: "original", sub: "class of 1998" },
    wet_work_order: { title: "Order", main: "revised", sub: "4:12 p.m." },
    zero_dollar_receipt: { title: "Receipt", main: "$0.00", sub: "same footer" },
    notebook: { title: "Notebook", main: "margin", sub: "open" }
  };

  const demoTransitions = {
    "cafeteria-receipt:inspect_receipt": "receipt-inspected"
  };

  function latestEvent(snapshot) {
    const events = snapshot.events || [];
    return events.length ? events[events.length - 1] : null;
  }

  function latestSpeakableEvent(snapshot) {
    const events = snapshot.events || [];
    for (let i = events.length - 1; i >= 0; i -= 1) {
      if (events[i].performance || events[i].characterId) return events[i];
    }
    return latestEvent(snapshot);
  }

  function chooseSpeaker(snapshot) {
    const people = snapshot.people || [];
    const byPersonId = new Map(people.map((person) => [person.id, person]));
    const event = latestSpeakableEvent(snapshot);
    const performanceSpeaker = event && event.performance && event.performance.speakerId;

    if (performanceSpeaker && byPersonId.has(performanceSpeaker)) return byPersonId.get(performanceSpeaker);
    if (event && event.characterId && byPersonId.has(event.characterId)) return byPersonId.get(event.characterId);
    if (byPersonId.has("ruby")) return byPersonId.get("ruby");
    return people[0] || { id: "ruby", name: "Ruby" };
  }

  function lineWithoutSpeakerPrefix(line, speakerName) {
    const prefix = `${speakerName}: `;
    return line && line.startsWith(prefix) ? line.slice(prefix.length) : line;
  }

  function mainLine(snapshot, speakerName) {
    const event = latestSpeakableEvent(snapshot);
    const objectIds = new Set((snapshot.objects || []).map((object) => object.id));

    if (event && event.performance && event.performance.line) {
      return lineWithoutSpeakerPrefix(event.performance.line, speakerName);
    }
    if (snapshot.roomId === "homeroom" && objectIds.has("answer_card") && objectIds.has("wet_work_order")) {
      return "The answer card says original. The wet stamp says revised. Before you answer, decide what can actually be trusted.";
    }
    if (event && event.text) return lineWithoutSpeakerPrefix(event.text, speakerName);
    return "The room waits for a real move.";
  }

  function notebookLine(snapshot) {
    const events = snapshot.events || [];
    for (let i = events.length - 1; i >= 0; i -= 1) {
      if (events[i].kind === "notebook_updated") return events[i].text;
    }

    const objectNames = (snapshot.objects || []).map((object) => object.name).filter(Boolean);
    if (objectNames.length) return `Room steady. Current evidence: ${objectNames.join(", ")}.`;
    const event = latestEvent(snapshot);
    return event && event.text ? event.text : "Notebook margin clear.";
  }

  function primaryActions(snapshot, sceneId) {
    const actions = snapshot.actions || [];
    const disciplineOrder = new Map([
      ["source", 0],
      ["sense", 1],
      ["signal", 2],
      ["sync", 3]
    ]);
    const approaches = actions
      .filter((action) => action.kind === "approach")
      .sort((left, right) => {
        const leftRank = disciplineOrder.get(String(left.disciplineId || "").toLowerCase()) ?? 99;
        const rightRank = disciplineOrder.get(String(right.disciplineId || "").toLowerCase()) ?? 99;
        return leftRank - rightRank;
      });
    const source = approaches.length ? approaches : [
      ...actions.filter((action) => action.kind === "inspect"),
      ...actions.filter((action) => action.kind === "talk"),
      ...actions.filter((action) => action.kind === "go"),
      ...actions.filter((action) => action.kind === "check_notes"),
      ...actions.filter((action) => action.kind === "wait")
    ];

    return source.slice(0, 4).map((action) => ({
      label: action.label,
      actionId: action.actionId,
      nextSceneId: demoTransitions[`${sceneId}:${action.actionId}`] || null
    }));
  }

  function blackboardLines(scene) {
    const snapshot = scene.snapshot || {};
    const objectIds = new Set((snapshot.objects || []).map((object) => object.id));
    const clocks = snapshot.clocks || {};

    if (snapshot.roomId === "homeroom" && objectIds.has("answer_card") && objectIds.has("wet_work_order")) {
      return [
        "ANSWER CARD: original",
        "WORK ORDER: revised, wet",
        "BOARD QUESTION:",
        "What can be trusted?"
      ];
    }
    if (objectIds.has("zero_dollar_receipt") && Number(clocks["Null Signal"] || 0) > 0) {
      return [
        "RECEIPT: $0.00",
        "FOOTER: copied exactly",
        "BOARD UPDATE:",
        "The pattern followed."
      ];
    }
    if (objectIds.has("zero_dollar_receipt")) {
      return [
        "RECEIPT: $0.00",
        "FOOTER: same footer",
        "BOARD QUESTION:",
        "Who can verify it?"
      ];
    }
    return [
      `${scene.title || "Room"}`,
      "BOARD QUESTION:",
      "What is the next Ruby High move?"
    ];
  }

  function shouldShowBlackboardFocus(scene) {
    const snapshot = scene.snapshot || {};
    return (snapshot.actions || []).some((action) => action.kind === "approach");
  }

  function sceneFromSnapshot(snapshot, index) {
    const sceneId = snapshot.sceneId || `${snapshot.roomId || "scene"}-${index + 1}`;
    const speaker = chooseSpeaker(snapshot);
    const speakerSide = speaker.id === "noor" || speaker.id === "mika" ? "left" : "left";
    const people = snapshot.people || [];
    const witnesses = people
      .filter((person) => person.id !== speaker.id)
      .map((person) => ({
        id: person.id,
        name: person.name,
        role: characterRoles[person.id] || "student",
        src: characterAssets[person.id],
        read: witnessReads[person.id] || "present"
      }))
      .filter((person) => person.src);

    const clockStatus = Object.entries(snapshot.clocks || {})
      .filter((entry) => Number(entry[1]) > 0)
      .map(([name, value]) => `${name} ${value}`);

    const itemSlots = (snapshot.objects || []).map((object) => ({
      id: object.id,
      label: object.name,
      objectCard: objectCards[object.id] || {
        title: object.name || object.id,
        main: "present",
        sub: "room object"
      },
      active: true
    }));

    return {
      id: sceneId,
      tabTitle: snapshot.sceneTitle || snapshot.room || "Scene",
      title: snapshot.room || "Room",
      kicker: snapshot.timeBlock || "Scene",
      status: [snapshot.timeBlock || "Scene", ...clockStatus],
      background: {
        src: roomBackgrounds[snapshot.roomId] || roomBackgrounds.homeroom,
        alt: `${snapshot.room || "Ruby High"} background`
      },
      cast: {
        speaker: {
          id: speaker.id,
          name: speaker.name,
          role: characterRoles[speaker.id] || "student",
          src: characterAssets[speaker.id] || characterAssets.ruby,
          side: speakerSide
        },
        witnesses
      },
      itemSlots,
      speech: {
        speaker: speaker.name,
        text: mainLine(snapshot, speaker.name)
      },
      notebookLine: notebookLine(snapshot),
      actions: primaryActions(snapshot, sceneId),
      snapshot
    };
  }

  const engineSnapshots = Array.isArray(window.RUBY2_ENGINE_SNAPSHOTS) ? window.RUBY2_ENGINE_SNAPSHOTS : [];
  if (engineSnapshots.length) {
    sceneLayout.scenes = engineSnapshots.map(sceneFromSnapshot);
    sceneLayout.defaultScene = sceneLayout.scenes[0].id;
  }

  const byId = new Map(sceneLayout.scenes.map((scene) => [scene.id, scene]));

  function el(tagName, options = {}, children = []) {
    const node = document.createElement(tagName);

    if (options.className) node.className = options.className;
    if (options.text) node.textContent = options.text;
    if (options.attrs) {
      Object.entries(options.attrs).forEach(([name, value]) => {
        node.setAttribute(name, value);
      });
    }

    children.forEach((child) => node.append(child));
    return node;
  }

  function renderScene(scene) {
    const stage = document.querySelector("[data-scene-stage]");
    if (!stage) return;

    stage.replaceChildren();
    stage.dataset.room = scene.id;
    stage.setAttribute("aria-label", `${scene.title} scene`);

    const background = el("img", {
      className: "room-bg",
      attrs: { src: scene.background.src, alt: scene.background.alt || "" }
    });

    const topbar = el("header", { className: "scene-topbar" }, [
      el("div", {}, [
        el("span", { className: "kicker", text: scene.kicker }),
        el("h1", { text: scene.title })
      ]),
      el("div", { className: "status-strip", attrs: { "aria-label": "Scene state" } }, scene.status.map((status) => (
        el("span", { text: status })
      )))
    ]);

    const speaker = scene.cast.speaker;
    const witnesses = scene.cast.witnesses || [];

    const speakerFigure = el("figure", {
      className: ["speaker-portrait", speaker.role, speaker.side === "right" ? "speaker-right" : "speaker-left", speaker.id].join(" "),
      attrs: { "aria-label": `${speaker.name}, active speaker` }
    }, [
      el("img", { attrs: { src: speaker.src, alt: speaker.name } }),
      el("figcaption", { text: speaker.name })
    ]);

    const canShowBoard = shouldShowBlackboardFocus(scene);
    const speech = el("aside", {
      className: "speech-bubble",
      attrs: {
        "aria-label": `${scene.speech.speaker} speaking`
      }
    }, [
      el("strong", { text: scene.speech.speaker }),
      el("p", { text: scene.speech.text }),
      ...(canShowBoard ? [el("button", { className: "focus-next", text: "Next", attrs: { type: "button" } })] : [])
    ]);

    const blackboard = el("section", {
      className: "blackboard-surface",
      attrs: {
        "aria-label": "Blackboard focus",
        hidden: "hidden"
      }
    }, [
      el("div", { className: "blackboard-copy" }, [
        el("span", { className: "blackboard-kicker", text: "Blackboard" }),
        ...blackboardLines(scene).map((line) => (
          el("p", {
            className: line.endsWith(":") ? "is-heading" : "",
            text: line
          })
        ))
      ]),
      ...(canShowBoard ? [el("button", { className: "focus-next", text: "Speech", attrs: { type: "button" } })] : [])
    ]);

    if (canShowBoard) {
      const [speechNext] = speech.querySelectorAll(".focus-next");
      const [boardNext] = blackboard.querySelectorAll(".focus-next");
      speechNext.addEventListener("click", () => {
        speech.hidden = true;
        blackboard.hidden = false;
      });
      boardNext.addEventListener("click", () => {
        blackboard.hidden = true;
        speech.hidden = false;
      });
    }

    const witnessRail = el("section", { className: "witness-rail", attrs: { "aria-label": "People present" } }, witnesses.map((avatar) => (
      el("figure", { className: ["witness", avatar.role, avatar.id].join(" ") }, [
        el("img", { attrs: { src: avatar.src, alt: avatar.name } })
      ])
    )));

    const witnessChat = el("section", { className: "witness-chat", attrs: { "aria-label": "Classmate reactions" } }, witnesses.map((avatar) => (
      el("p", { className: avatar.id, text: avatar.read || "present" })
    )));

    const dialogueLayer = el("section", {
      className: ["dialogue-layer", speaker.side === "right" ? "is-right" : "is-left"].join(" "),
      attrs: { "aria-label": "Dialogue composition" }
    }, [
      speakerFigure,
      speech,
      blackboard,
      witnessRail,
      witnessChat
    ]);

    const items = el("div", { className: "scene-items", attrs: { "aria-label": "Scene items" } }, scene.itemSlots.map((item) => {
      const itemChildren = item.objectCard ? [
        el("span", { className: "object-title", text: item.objectCard.title }),
        el("strong", { text: item.objectCard.main }),
        el("small", { text: item.objectCard.sub })
      ] : [
        el("img", { attrs: { src: item.src, alt: "" } }),
        el("span", { text: item.label })
      ];

      return el("button", {
        className: ["item-prop", item.objectCard ? "is-object-card" : "", item.active ? "is-active" : ""].filter(Boolean).join(" "),
        attrs: { type: "button", "aria-label": item.label }
      }, itemChildren);
    }));

    const notebook = el("section", { className: "notebook-strip", attrs: { "aria-label": "Notebook margin" } }, [
      el("span", { text: "Notebook margin" }),
      el("p", { text: scene.notebookLine })
    ]);

    const actions = el("section", { className: "action-tray", attrs: { "aria-label": "Available choices" } }, scene.actions.map((action, index) => {
      const label = typeof action === "string" ? action : action.label;
      const nextSceneId = typeof action === "string" ? null : action.nextSceneId;
      const button = el("button", { attrs: { type: "button", "aria-pressed": "false" } }, [
        el("span", { className: "choice-number", text: String(index + 1) }),
        el("span", { className: "choice-label", text: label })
      ]);

      button.addEventListener("click", () => {
        actions.querySelectorAll("button").forEach((choice) => {
          choice.classList.remove("is-selected");
          choice.setAttribute("aria-pressed", "false");
        });
        button.classList.add("is-selected");
        button.setAttribute("aria-pressed", "true");
        if (nextSceneId && byId.has(nextSceneId)) {
          setScene(nextSceneId);
          return;
        }
        const notebookText = notebook.querySelector("p");
        if (notebookText) notebookText.textContent = `Chosen: ${label}`;
      });

      return button;
    }));

    stage.append(
      background,
      el("div", { className: "room-wash" }),
      el("div", { className: "dialogue-vignette" }),
      topbar,
      dialogueLayer,
      items,
      notebook,
      actions
    );
  }

  function setScene(sceneId) {
    const scene = byId.get(sceneId) || byId.get(sceneLayout.defaultScene);
    renderScene(scene);

    document.querySelectorAll("[data-scene-tab]").forEach((tab) => {
      const isActive = tab.dataset.sceneTab === scene.id;
      tab.classList.toggle("is-active", isActive);
      tab.setAttribute("aria-pressed", String(isActive));
    });
  }

  function renderSceneTabs() {
    const tabs = document.querySelector("[data-scene-tabs]");
    if (!tabs) return;

    tabs.replaceChildren(...sceneLayout.scenes.map((scene) => {
      const tab = el("button", {
        text: scene.tabTitle || scene.title,
        attrs: { type: "button", "data-scene-tab": scene.id, "aria-pressed": "false" }
      });

      tab.addEventListener("click", () => setScene(scene.id));
      return tab;
    }));
  }

  window.RubyHighSceneLayout = sceneLayout;

  document.addEventListener("DOMContentLoaded", () => {
    renderSceneTabs();
    setScene(sceneLayout.defaultScene);
  });
})();

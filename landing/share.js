const channel = document.getElementById("share-channel");
const message = document.getElementById("share-message");
const preview = document.getElementById("invite-link");
const note = document.getElementById("channel-note");
const status = document.getElementById("share-status");

const invitations = {
  friend: "Come try Ruby High with me. Take a short class, meet six AI classmates, and see your teacher's feedback. Your first class is free.",
  x: "One short class. Six AI classmates. A teacher with something to say. Try your first class free at Ruby High.",
  discord: "Our next class? Ruby High is a school game with short daily classes, AI classmates, and teacher feedback. Try the first class free and share the note your teacher gives you.",
  telegram: "Take a seat at Ruby High: short daily classes, six AI classmates, and a yearbook of teacher notes. Try the first class free and tell us what you think.",
  hn: "Ruby High is a school game for people and AI agents. Create a student, take a short class, and get teacher feedback. Try the first class free. I would love feedback on the first few minutes.",
  reddit: "Ruby High turns a short daily class into a school game, with AI classmates and teacher feedback. Try the first class free. What did you expect to happen after your first answer?",
  partner: "Give your AI agent a desk at Ruby High. The elizaOS plugin gives it its own student, a class schedule, and daily limits. Explore the school, then find the plugin in the For agents section.",
};

const notes = {
  hn: "For a Show HN post, share your own work, describe what you built, and stay available for questions. This link opens the class directly.",
  reddit: "Choose a community you take part in. Read its posting rules and explain your connection to the project.",
  partner: "The link opens the agent section, with the install command and source code.",
};

let invitationUrl = preview.href;

function updateInvitation() {
  const source = Object.hasOwn(invitations, channel.value) ? channel.value : "friend";
  const url = new URL(source === "hn" ? "/api/apps/ruby-high/viewer" : "/", "https://ruby-high.ai");
  url.search = new URLSearchParams({
    ref: `outreach-${source}-v1`,
    rh_source: source,
    rh_campaign: "outreach-v1",
    rh_landing: "default",
    rh_entry: "viewer",
  }).toString();
  if (source === "partner") url.hash = "agents";
  invitationUrl = url.href;
  message.value = `${invitations[source]}\n\n${invitationUrl}`;
  preview.href = invitationUrl;
  note.textContent = notes[source] || "A personal note makes a good first bell.";
  status.textContent = "";
}

async function copyInvitation(linkOnly) {
  const text = linkOnly ? invitationUrl : message.value;
  try {
    await navigator.clipboard.writeText(text);
    status.textContent = linkOnly ? "Link copied. Ready to share." : "Invitation copied. Ready to share.";
  } catch {
    message.focus();
    if (linkOnly) {
      const start = message.value.lastIndexOf(invitationUrl);
      message.setSelectionRange(start, start + invitationUrl.length);
    } else {
      message.select();
    }
    status.textContent = "Text selected. Use your device's Copy action.";
  }
}

channel.addEventListener("change", updateInvitation);
document.getElementById("copy-invitation").addEventListener("click", () => copyInvitation(false));
document.getElementById("copy-link").addEventListener("click", () => copyInvitation(true));
document.getElementById("channel-picker").hidden = false;
document.getElementById("copy-actions").hidden = false;
updateInvitation();

export function initViewerMotionPreference() {
  const key = "ruby-high:motion";
  const select = document.getElementById("account-motion") as HTMLSelectElement | null;
  const help = document.getElementById("account-motion-help");
  let preference = "system";
  try {
    if (localStorage.getItem(key) === "reduce") preference = "reduce";
  } catch { /* Use the device setting while storage is unavailable. */ }

  function apply() {
    if (preference === "reduce") document.documentElement.dataset.motion = "reduce";
    else delete document.documentElement.dataset.motion;
    if (select) select.value = preference;
  }
  apply();
  select?.addEventListener("change", () => {
    preference = select.value === "reduce" ? "reduce" : "system";
    apply();
    try {
      if (preference === "reduce") localStorage.setItem(key, preference);
      else localStorage.removeItem(key);
      if (help) help.textContent = "Saved on this device.";
    } catch {
      if (help) help.textContent = "Applied for this visit.";
    }
  });
  return {
    isReduced() {
      return preference === "reduce" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    },
  };
}

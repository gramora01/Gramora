/* GRAMORA Instagram-style story creator controls */
(() => {
  const $ = id => document.getElementById(id);
  const dlg = $("storyCreateDialog"), form = $("storyForm"), ta = $("storyText");
  if (!dlg || !form || !ta || form.dataset.gseInitialized === "1") return;
  form.dataset.gseInitialized = "1";
  const stage = dlg.querySelector(".gramora-story-stage");
  const S = p => '<svg viewBox="0 0 24 24" aria-hidden="true">' + p + "</svg>";
  const ic = {
    back: S('<path d="M15 5l-7 7 7 7"/>'),
    aa: "<b>Aa</b>",
    music: S('<path d="M9 18V6l10-2v12"/><circle cx="7" cy="18" r="2.5"/><circle cx="17" cy="16" r="2.5"/>'),
    image: S('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/>'),
    bg: '<i class="gse-bgdot"></i>',
    color: '<i class="gse-wheel"></i>',
    align: S('<path d="M4 7h16M4 12h10M4 17h16"/>'),
    send: S('<path d="M5 12h14M13 6l6 6-6 6"/>')
  };
  const click = id => { const b = $(id); if (b) b.click(); };
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
  const tool = (label, icon, fn) => {
    const b = el("button", "gse-tool", "<span>" + label + "</span><em class=\"gse-c\">" + icon + "</em>");
    b.type = "button"; b.addEventListener("click", fn); return b;
  };

  const cancel = $("closeStoryCreate");
  if (cancel) { cancel.innerHTML = ic.back; cancel.setAttribute("aria-label", "Back"); }

  const cycleBg = () => {
    const list = [...($("storyBackgroundPicker") || document).querySelectorAll("[data-bg]")];
    if (!list.length) return;
    const cur = ($("storyBackground") || {}).value;
    const i = list.findIndex(b => b.dataset.bg === cur);
    list[(i + 1) % list.length].click();
  };
  const editorHost = $("storyEditorWorkspace") || form;
  const tools = el("div", "gse-tools");
  tools.append(
    tool("Text", ic.aa, () => ta.focus()),
    tool("Image", ic.image, () => click("storyImageFile")),
    tool("Music", ic.music, () => click("openStoryMusic")),
    tool("Background", ic.bg, cycleBg),
    tool("Colour", ic.color, () => click("storyTextColorToggle")),
    tool("Align", ic.align, () => click("storyTextAlignToggle"))
  );
  editorHost.appendChild(tools);

  const edit = el("div", "gse-edit-tools");
  [["Aa", ic.aa, () => ta.focus()], ["Colour", ic.color, () => click("storyTextColorToggle")], ["Align", ic.align, () => click("storyTextAlignToggle")]].forEach(([l, i, f]) => {
    const b = el("button", "gse-ebtn", i); b.type = "button"; b.setAttribute("aria-label", l); b.addEventListener("click", f); edit.append(b);
  });
  editorHost.appendChild(edit);

  const size = el("input", "gse-size"); size.type = "range"; size.min = 20; size.max = 64; size.value = 34; size.setAttribute("aria-label", "Text size");
  size.addEventListener("input", () => ta.style.setProperty("font-size", size.value + "px", "important"));
  editorHost.appendChild(size);

  const bottom = el("div", "gse-bottom");
  const pill = el("button", "gse-pill", '<i class="gse-av">' + ((($("authName") || {}).textContent || "Y").trim()[0] || "Y").toUpperCase() + "</i>Your stories");
  pill.type = "button";
  const send = el("button", "gse-send", ic.send); send.type = "button"; send.setAttribute("aria-label", "Share story");
  send.addEventListener("click", () => click("storyShareSubmit"));
  bottom.append(pill, el("span", "gse-sp"), send);
  editorHost.appendChild(bottom);

  [edit, dlg.querySelector(".gramora-story-style-strip")].forEach(n => n && n.addEventListener("pointerdown", e => e.preventDefault()));
  const done = $("storyEditorDone");
  if (done) done.addEventListener("click", () => ta.blur());

  ta.addEventListener("focus", () => dlg.classList.add("gse-editing"));
  ta.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== ta) dlg.classList.remove("gse-editing"); }, 120));

  const syncBg = () => { const v = ($("storyBackground") || {}).value; if (v && stage) stage.style.setProperty("background", v, "important"); };
  const picker = $("storyBackgroundPicker"); if (picker) picker.addEventListener("click", () => setTimeout(syncBg, 0));
  new MutationObserver(() => { if (dlg.open) { syncBg(); dlg.classList.remove("gse-editing"); } }).observe(dlg, { attributes: true, attributeFilter: ["open"] });
  syncBg();

  const vv = window.visualViewport;
  const upd = () => { dlg.style.setProperty("--vvh", (vv ? vv.height : innerHeight) + "px"); if (dlg.open) window.scrollTo(0, 0); };
  if (vv) { vv.addEventListener("resize", upd); vv.addEventListener("scroll", upd); }
  upd();
})();

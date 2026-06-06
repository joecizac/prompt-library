"use strict";

const CATALOG_URL = "./prompts.json";
const THEME_STORAGE_KEY = "prompt-writer-theme";
const state = {
  templates: [],
  filteredTemplates: [],
  selectedTemplate: null,
  placeholderValues: new Map(),
  collapsedPhaseIds: new Set()
};

const elements = {
  themeToggle: document.getElementById("themeToggle"),
  searchInput: document.getElementById("searchInput"),
  resultSummary: document.getElementById("resultSummary"),
  statusRegion: document.getElementById("statusRegion"),
  catalog: document.getElementById("catalog"),
  editorEmpty: document.getElementById("editorEmpty"),
  editorContent: document.getElementById("editorContent"),
  closeEditor: document.getElementById("closeEditor"),
  selectedTemplateTitle: document.getElementById("selectedTemplateTitle"),
  editorPhase: document.getElementById("editorPhase"),
  editorTags: document.getElementById("editorTags"),
  inlinePrompt: document.getElementById("inlinePrompt"),
  generatedPrompt: document.getElementById("generatedPrompt"),
  copyPrompt: document.getElementById("copyPrompt"),
  copyFeedback: document.getElementById("copyFeedback")
};

document.addEventListener("DOMContentLoaded", init);

function init() {
  syncThemeControl();
  elements.themeToggle.addEventListener("click", toggleTheme);
  elements.searchInput.addEventListener("input", handleSearch);
  elements.closeEditor.addEventListener("click", clearSelectedTemplate);
  elements.inlinePrompt.addEventListener("input", handleInlinePromptInput);
  elements.copyPrompt.addEventListener("click", copyGeneratedPrompt);
  loadCatalog();
}

async function loadCatalog() {
  showStatus("Loading prompt catalog...");

  try {
    const response = await fetch(CATALOG_URL);
    if (!response.ok) {
      throw new Error("Catalog fetch failed");
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error("Catalog root must be an array");
    }

    const validTemplates = data.map(normalizeTemplate).filter(Boolean);
    if (validTemplates.length === 0) {
      elements.searchInput.disabled = true;
      showStatus("No valid prompt templates are available.", "warning");
      updateSummary(0, 0);
      return;
    }

    state.templates = validTemplates;
    state.filteredTemplates = validTemplates;
    elements.searchInput.disabled = false;
    renderCatalog(validTemplates);
    updateSummary(validTemplates.length, validTemplates.length);
    hideStatus();
  } catch (error) {
    elements.searchInput.disabled = true;
    updateSummary(0, 0);
    showStatus("Prompt catalog could not be loaded. Check that prompts.json exists and contains a valid JSON array.", "error");
  }
}

function normalizeTemplate(template) {
  if (!template || typeof template !== "object") {
    return null;
  }

  const hasRequiredFields =
    typeof template.id === "string" &&
    typeof template.phase === "string" &&
    template.phase.trim() &&
    typeof template.phase_id !== "undefined" &&
    String(template.phase_id).trim() &&
    typeof template.title === "string" &&
    typeof template.prompt_template === "string" &&
    Array.isArray(template.tags) &&
    Array.isArray(template.placeholders);

  if (!hasRequiredFields) {
    return null;
  }

  return {
    id: template.id,
    phase: template.phase.trim(),
    phase_id: String(template.phase_id).trim(),
    title: template.title,
    prompt_template: template.prompt_template,
    tags: template.tags.filter((tag) => typeof tag === "string" && tag.trim()).map((tag) => tag.trim()),
    placeholders: template.placeholders.filter(isValidPlaceholder).map((placeholder) => ({
      raw: placeholder.raw,
      key: placeholder.key,
      description: placeholder.description
    }))
  };
}

function isValidPlaceholder(placeholder) {
  return (
    placeholder &&
    typeof placeholder.raw === "string" &&
    placeholder.raw &&
    typeof placeholder.key === "string" &&
    placeholder.key &&
    typeof placeholder.description === "string"
  );
}

function renderCatalog(templates) {
  elements.catalog.innerHTML = "";

  if (templates.length === 0) {
    elements.catalog.hidden = true;
    showStatus("No templates match the current tag search.", "warning");
    updateSummary(0, state.templates.length);
    return;
  }

  hideStatus();
  elements.catalog.hidden = false;
  const groupedTemplates = groupTemplatesByPhase(templates);

  groupedTemplates.forEach((group) => {
    const section = document.createElement("section");
    section.className = "phase-section";
    const phaseSlug = `phase-${slugify(group.phaseId)}-${slugify(group.phase)}`;
    const headingId = `${phaseSlug}-heading`;
    const listId = `${phaseSlug}-templates`;
    const isCollapsed = state.collapsedPhaseIds.has(group.phaseId);
    section.setAttribute("aria-labelledby", headingId);

    const header = document.createElement("div");
    header.className = "phase-section__header";

    const title = document.createElement("h2");
    title.id = headingId;
    title.className = "phase-heading";

    const toggle = document.createElement("button");
    toggle.className = "phase-toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(!isCollapsed));
    toggle.setAttribute("aria-controls", listId);
    toggle.dataset.phaseId = group.phaseId;

    const indicator = document.createElement("span");
    indicator.className = "phase-toggle__indicator";
    indicator.setAttribute("aria-hidden", "true");
    indicator.textContent = isCollapsed ? "+" : "-";

    const phaseName = document.createElement("span");
    phaseName.textContent = group.phase;

    toggle.append(indicator, phaseName);
    toggle.addEventListener("click", () => togglePhase(group.phaseId));
    title.append(toggle);

    const count = document.createElement("span");
    count.className = "phase-count";
    count.textContent = `${group.templates.length} ${group.templates.length === 1 ? "template" : "templates"}`;

    const list = document.createElement("ul");
    list.className = "template-list";
    list.id = listId;
    list.hidden = isCollapsed;

    group.templates.forEach((template) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.className = "template-button";
      button.type = "button";
      button.dataset.templateId = template.id;

      const titleText = document.createElement("span");
      titleText.className = "template-title";
      titleText.textContent = template.title;

      const tags = renderTagList(template.tags);

      button.append(titleText, tags);
      button.addEventListener("click", () => selectTemplate(template, button));
      item.append(button);
      list.append(item);
    });

    header.append(title, count);
    section.append(header, list);
    elements.catalog.append(section);
  });
}

function groupTemplatesByPhase(templates) {
  const groups = new Map();

  templates.forEach((template) => {
    const key = template.phase_id;
    if (!groups.has(key)) {
      groups.set(key, {
        phase: template.phase,
        phaseId: template.phase_id,
        templates: []
      });
    }
    groups.get(key).templates.push(template);
  });

  groups.forEach((group) => {
    group.templates.sort(compareTemplates);
  });

  return Array.from(groups.values()).sort((a, b) => {
    const phaseComparison = comparePhaseIds(a.phaseId, b.phaseId);
    if (phaseComparison !== 0) {
      return phaseComparison;
    }
    return a.phase.localeCompare(b.phase);
  });
}

function comparePhaseIds(a, b) {
  const aNumber = Number(a);
  const bNumber = Number(b);
  const aIsNumeric = Number.isFinite(aNumber);
  const bIsNumeric = Number.isFinite(bNumber);

  if (aIsNumeric && bIsNumeric) {
    return aNumber - bNumber;
  }

  if (aIsNumeric) {
    return -1;
  }

  if (bIsNumeric) {
    return 1;
  }

  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

function compareTemplates(a, b) {
  return String(a.id).localeCompare(String(b.id), undefined, { numeric: true, sensitivity: "base" });
}

function togglePhase(phaseId) {
  if (state.collapsedPhaseIds.has(phaseId)) {
    state.collapsedPhaseIds.delete(phaseId);
  } else {
    state.collapsedPhaseIds.add(phaseId);
  }

  renderCatalog(state.filteredTemplates);
}

function renderTagList(tags) {
  const list = document.createElement("ul");
  list.className = "tag-list";

  if (tags.length === 0) {
    const item = document.createElement("li");
    item.className = "tag";
    item.textContent = "untagged";
    list.append(item);
    return list;
  }

  tags.forEach((tag) => {
    const item = document.createElement("li");
    item.className = "tag";
    item.textContent = tag;
    list.append(item);
  });

  return list;
}

function handleSearch(event) {
  const query = event.target.value.trim();
  state.filteredTemplates = query ? state.templates.filter((template) => matchesTagQuery(template.tags, query)) : state.templates;
  renderCatalog(state.filteredTemplates);
  updateSummary(state.filteredTemplates.length, state.templates.length);
}

function matchesTagQuery(tags, query) {
  const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const normalizedTags = tags.map((tag) => tag.toLowerCase());

  return queryTerms.every((term) =>
    normalizedTags.some((tag) => tag.includes(term) || isSubsequence(term, tag))
  );
}

function isSubsequence(query, value) {
  let queryIndex = 0;
  for (let valueIndex = 0; valueIndex < value.length && queryIndex < query.length; valueIndex += 1) {
    if (query[queryIndex] === value[valueIndex]) {
      queryIndex += 1;
    }
  }
  return queryIndex === query.length;
}

function selectTemplate(template, triggerElement) {
  state.selectedTemplate = template;
  state.placeholderValues = new Map();
  markSelectedTemplate(triggerElement);
  elements.selectedTemplateTitle.textContent = template.title;
  elements.editorPhase.textContent = template.phase;
  elements.editorTags.innerHTML = "";
  elements.editorTags.append(...renderTagList(template.tags).children);
  elements.copyFeedback.textContent = "";
  elements.copyFeedback.removeAttribute("data-state");
  elements.editorEmpty.hidden = true;
  elements.editorContent.hidden = false;
  renderInlinePrompt();

  if (triggerElement && window.matchMedia("(max-width: 980px)").matches) {
    document.getElementById("templateEditor").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function markSelectedTemplate(triggerElement) {
  elements.catalog.querySelectorAll(".template-button.is-selected").forEach((button) => {
    button.classList.remove("is-selected");
    button.removeAttribute("aria-current");
  });

  if (triggerElement) {
    triggerElement.classList.add("is-selected");
    triggerElement.setAttribute("aria-current", "true");
  }
}

function renderInlinePrompt() {
  if (!state.selectedTemplate) {
    return;
  }

  elements.inlinePrompt.innerHTML = "";

  const placeholders = uniquePlaceholders(state.selectedTemplate.placeholders);
  if (placeholders.length === 0) {
    elements.inlinePrompt.textContent = state.selectedTemplate.prompt_template;
    updateGeneratedPromptText();
    return;
  }

  const tokenPattern = new RegExp(placeholders.map((placeholder) => escapeRegExp(placeholder.raw)).join("|"), "g");
  const promptTemplate = state.selectedTemplate.prompt_template;
  let cursor = 0;
  let match;

  while ((match = tokenPattern.exec(promptTemplate)) !== null) {
    if (match.index > cursor) {
      elements.inlinePrompt.append(document.createTextNode(promptTemplate.slice(cursor, match.index)));
    }

    const placeholder = placeholders.find((item) => item.raw === match[0]);
    elements.inlinePrompt.append(createInlinePlaceholderInput(placeholder));
    cursor = match.index + match[0].length;
  }

  if (cursor < promptTemplate.length) {
    elements.inlinePrompt.append(document.createTextNode(promptTemplate.slice(cursor)));
  }

  updateGeneratedPromptText();
}

function uniquePlaceholders(placeholders) {
  const byRaw = new Map();

  placeholders
    .slice()
    .sort((a, b) => b.raw.length - a.raw.length)
    .forEach((placeholder) => {
      if (!byRaw.has(placeholder.raw)) {
        byRaw.set(placeholder.raw, placeholder);
      }
    });

  return Array.from(byRaw.values());
}

function createInlinePlaceholderInput(placeholder) {
  const input = document.createElement("input");
  input.className = "inline-placeholder";
  input.type = "text";
  input.autocomplete = "off";
  input.dataset.raw = placeholder.raw;
  input.name = placeholder.key;
  input.placeholder = placeholder.raw;
  input.value = state.placeholderValues.get(placeholder.raw) || "";
  input.setAttribute("aria-label", placeholder.description ? `${placeholder.raw}: ${placeholder.description}` : placeholder.raw);
  input.style.width = `${Math.max(placeholder.raw.length + 2, 10)}ch`;

  if (placeholder.description.trim()) {
    input.title = placeholder.description;
  }

  return input;
}

function handleInlinePromptInput(event) {
  if (!event.target.matches(".inline-placeholder")) {
    return;
  }

  const raw = event.target.dataset.raw;
  const value = event.target.value;
  state.placeholderValues.set(raw, value);

  elements.inlinePrompt.querySelectorAll(".inline-placeholder").forEach((input) => {
    if (input.dataset.raw !== raw) {
      return;
    }

    if (input !== event.target) {
      input.value = value;
    }
  });

  event.target.style.width = `${Math.max(value.length + 2, raw.length + 2, 10)}ch`;
  updateGeneratedPromptText();
}

function updateGeneratedPromptText() {
  if (!state.selectedTemplate) {
    elements.generatedPrompt.value = "";
    return;
  }

  let generatedPrompt = state.selectedTemplate.prompt_template;
  uniquePlaceholders(state.selectedTemplate.placeholders).forEach((placeholder) => {
    const value = state.placeholderValues.get(placeholder.raw);
    const replacement = value && value.trim() ? value : placeholder.raw;
    generatedPrompt = generatedPrompt.split(placeholder.raw).join(replacement);
  });

  elements.generatedPrompt.value = generatedPrompt;
}

async function copyGeneratedPrompt() {
  const text = elements.generatedPrompt.value;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      elements.generatedPrompt.focus();
      elements.generatedPrompt.select();
      document.execCommand("copy");
      elements.generatedPrompt.setSelectionRange(0, 0);
    }
    showCopyFeedback("Generated prompt copied.", "success");
  } catch (error) {
    showCopyFeedback("Copy failed. Select the generated prompt and copy it manually.", "error");
  }
}

function showCopyFeedback(message, stateName) {
  elements.copyFeedback.textContent = message;
  elements.copyFeedback.dataset.state = stateName;
}

function clearSelectedTemplate() {
  state.selectedTemplate = null;
  state.placeholderValues = new Map();
  elements.editorContent.hidden = true;
  elements.editorEmpty.hidden = false;
  elements.inlinePrompt.innerHTML = "";
  elements.generatedPrompt.value = "";
  elements.copyFeedback.textContent = "";
  elements.copyFeedback.removeAttribute("data-state");
  markSelectedTemplate(null);
}

function toggleTheme() {
  const currentTheme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const nextTheme = currentTheme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = nextTheme;

  try {
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  } catch (error) {
    // Theme still changes for the active session if storage is unavailable.
  }

  syncThemeControl();
}

function syncThemeControl() {
  const isDark = document.documentElement.dataset.theme === "dark";
  elements.themeToggle.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
  elements.themeToggle.title = isDark ? "Switch to light mode" : "Switch to dark mode";
}

function showStatus(message, stateName) {
  elements.statusRegion.hidden = false;
  elements.catalog.hidden = true;
  elements.statusRegion.innerHTML = "";

  const status = document.createElement("p");
  status.className = "status-card";
  if (stateName) {
    status.dataset.state = stateName;
  }
  status.textContent = message;
  elements.statusRegion.append(status);
}

function hideStatus() {
  elements.statusRegion.hidden = true;
  elements.statusRegion.innerHTML = "";
}

function updateSummary(visibleCount, totalCount) {
  if (totalCount === 0) {
    elements.resultSummary.textContent = "No prompt templates loaded.";
    return;
  }

  elements.resultSummary.textContent = `${visibleCount} of ${totalCount} ${totalCount === 1 ? "template" : "templates"} shown.`;
}

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

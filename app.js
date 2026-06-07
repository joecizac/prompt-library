"use strict";

const CATALOG_URL = "./prompts.json";
const THEME_STORAGE_KEY = "prompt-writer-theme";
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

const PLACEHOLDER_PALETTE = [
  "#0c6b58",
  "#8a4b08",
  "#5d4ea3",
  "#a02222",
  "#086a9c",
  "#8a3d72",
  "#4b6f14",
  "#985b00",
  "#2361c9",
  "#7a4c00"
];

const state = {
  templates: [],
  filteredTemplates: [],
  selectedTemplate: null,
  selectedTrigger: null,
  placeholderValues: new Map(),
  placeholderMeta: [],
  collapsedPhaseIds: new Set()
};

const elements = {
  themeToggle: document.getElementById("themeToggle"),
  searchInput: document.getElementById("searchInput"),
  resultSummary: document.getElementById("resultSummary"),
  statusRegion: document.getElementById("statusRegion"),
  catalog: document.getElementById("catalog"),
  modalBackdrop: document.getElementById("modalBackdrop"),
  modal: document.getElementById("templateModal"),
  closeModal: document.getElementById("closeModal"),
  modalTitle: document.getElementById("modalTitle"),
  modalPhase: document.getElementById("modalPhase"),
  modalTags: document.getElementById("modalTags"),
  placeholderForm: document.getElementById("placeholderForm"),
  promptPreview: document.getElementById("promptPreview"),
  generatedPrompt: document.getElementById("generatedPrompt"),
  copyPrompt: document.getElementById("copyPrompt"),
  copyFeedback: document.getElementById("copyFeedback")
};

document.addEventListener("DOMContentLoaded", init);

function init() {
  syncThemeControl();
  elements.themeToggle.addEventListener("click", toggleTheme);
  elements.searchInput.addEventListener("input", handleSearch);
  elements.closeModal.addEventListener("click", closeModal);
  elements.placeholderForm.addEventListener("input", handlePlaceholderInput);
  elements.placeholderForm.addEventListener("click", handlePlaceholderInfoClick);
  elements.copyPrompt.addEventListener("click", copyGeneratedPrompt);
  document.addEventListener("keydown", handleGlobalKeydown);
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("focusin", handleDocumentFocusIn);
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
      description: placeholder.description,
      multiline: placeholder.multiline === true
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
    typeof placeholder.description === "string" &&
    typeof placeholder.multiline === "boolean"
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
      button.addEventListener("click", () => openModal(template, button));
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

function openModal(template, triggerElement) {
  state.selectedTemplate = template;
  state.selectedTrigger = triggerElement;
  state.placeholderValues = new Map();
  state.placeholderMeta = buildPlaceholderMeta(template.placeholders);

  markSelectedTemplate(triggerElement);
  elements.modalTitle.textContent = template.title;
  elements.modalPhase.textContent = template.phase;
  elements.modalTags.innerHTML = "";
  elements.modalTags.append(...renderTagList(template.tags).children);
  elements.placeholderForm.innerHTML = "";
  elements.copyFeedback.textContent = "";
  elements.copyFeedback.removeAttribute("data-state");

  state.placeholderMeta.forEach((placeholder, index) => {
    elements.placeholderForm.append(createPlaceholderField(placeholder, index));
  });

  if (state.placeholderMeta.length === 0) {
    const empty = document.createElement("p");
    empty.className = "placeholder-empty";
    empty.textContent = "This template has no placeholders.";
    elements.placeholderForm.append(empty);
  }

  updatePreview();
  document.body.classList.add("modal-open");
  elements.modalBackdrop.hidden = false;
  elements.modal.hidden = false;
  focusFirstModalControl();
}

function buildPlaceholderMeta(placeholders) {
  const byKey = new Map();

  placeholders.forEach((placeholder) => {
    if (!byKey.has(placeholder.key)) {
      const colorIndex = byKey.size % PLACEHOLDER_PALETTE.length;
      byKey.set(placeholder.key, {
        ...placeholder,
        raws: [placeholder.raw],
        color: PLACEHOLDER_PALETTE[colorIndex]
      });
      return;
    }

    const existing = byKey.get(placeholder.key);
    if (!existing.raws.includes(placeholder.raw)) {
      existing.raws.push(placeholder.raw);
    }
  });

  return Array.from(byKey.values());
}

function createPlaceholderField(placeholder, index) {
  const field = document.createElement("div");
  field.className = "placeholder-field";
  field.style.setProperty("--placeholder-color", placeholder.color);

  const inputId = `placeholder-${index}-${slugify(placeholder.key)}`;
  const helpId = `${inputId}-help`;

  const labelRow = document.createElement("div");
  labelRow.className = "placeholder-label-row";

  const label = document.createElement("label");
  label.className = "placeholder-label";
  label.setAttribute("for", inputId);
  label.textContent = placeholder.raw;

  labelRow.append(label);

  if (placeholder.description.trim()) {
    const infoButton = document.createElement("button");
    infoButton.className = "placeholder-info-button";
    infoButton.type = "button";
    infoButton.setAttribute("aria-label", `Show description for ${placeholder.raw}`);
    infoButton.setAttribute("aria-controls", helpId);
    infoButton.setAttribute("aria-expanded", "false");
    infoButton.dataset.tooltipId = helpId;
    infoButton.textContent = "i";
    labelRow.append(infoButton);
  }

  const control = placeholder.multiline ? document.createElement("textarea") : document.createElement("input");
  control.id = inputId;
  control.name = placeholder.key;
  control.className = "placeholder-control";
  control.dataset.key = placeholder.key;
  control.dataset.raws = JSON.stringify(placeholder.raws);
  control.autocomplete = "off";
  control.placeholder = placeholder.raw;
  control.setAttribute("aria-label", placeholder.raw);

  if (placeholder.description.trim()) {
    control.setAttribute("aria-describedby", helpId);
  }

  if (placeholder.multiline) {
    control.rows = 3;
  } else {
    control.type = "text";
  }

  field.append(labelRow, control);

  if (placeholder.description.trim()) {
    const tooltip = document.createElement("span");
    tooltip.id = helpId;
    tooltip.className = "placeholder-tooltip";
    tooltip.role = "tooltip";
    tooltip.hidden = true;
    tooltip.textContent = placeholder.description;
    field.append(tooltip);
  }

  if (placeholder.multiline) {
    autoGrow(control);
  }

  return field;
}

function handlePlaceholderInput(event) {
  if (!event.target.matches(".placeholder-control")) {
    return;
  }

  const control = event.target;
  state.placeholderValues.set(control.dataset.key, control.value);

  if (control.tagName === "TEXTAREA") {
    autoGrow(control);
  }

  updatePreview();
}

function handlePlaceholderInfoClick(event) {
  const infoButton = event.target.closest(".placeholder-info-button");
  if (!infoButton) {
    return;
  }

  event.stopPropagation();
  const tooltip = document.getElementById(infoButton.dataset.tooltipId);
  if (!tooltip) {
    return;
  }

  const shouldOpen = tooltip.hidden;
  closeAllTooltips();

  if (shouldOpen) {
    tooltip.hidden = false;
    infoButton.setAttribute("aria-expanded", "true");
  }
}

function handleDocumentClick(event) {
  if (isInsideOpenTooltipField(event.target)) {
    return;
  }

  closeAllTooltips();
}

function handleDocumentFocusIn(event) {
  if (isInsideOpenTooltipField(event.target)) {
    return;
  }

  closeAllTooltips();
}

function isInsideOpenTooltipField(target) {
  const openTooltip = elements.placeholderForm.querySelector(".placeholder-tooltip:not([hidden])");
  if (!openTooltip) {
    return false;
  }

  const openField = openTooltip.closest(".placeholder-field");
  return Boolean(openField && openField.contains(target));
}

function closeAllTooltips() {
  elements.placeholderForm.querySelectorAll(".placeholder-tooltip").forEach((tooltip) => {
    tooltip.hidden = true;
  });
  elements.placeholderForm.querySelectorAll(".placeholder-info-button").forEach((button) => {
    button.setAttribute("aria-expanded", "false");
  });
}

function updatePreview() {
  if (!state.selectedTemplate) {
    return;
  }

  elements.promptPreview.innerHTML = "";
  const rawToPlaceholder = new Map();

  state.placeholderMeta.forEach((placeholder) => {
    placeholder.raws.forEach((raw) => {
      rawToPlaceholder.set(raw, placeholder);
    });
  });

  const rawTokens = Array.from(rawToPlaceholder.keys()).sort((a, b) => b.length - a.length);
  if (rawTokens.length === 0) {
    elements.promptPreview.textContent = state.selectedTemplate.prompt_template;
    elements.generatedPrompt.value = state.selectedTemplate.prompt_template;
    return;
  }

  const tokenPattern = new RegExp(rawTokens.map(escapeRegExp).join("|"), "g");
  const promptTemplate = state.selectedTemplate.prompt_template;
  let generatedPrompt = "";
  let cursor = 0;
  let match;

  while ((match = tokenPattern.exec(promptTemplate)) !== null) {
    const before = promptTemplate.slice(cursor, match.index);
    appendPreviewText(before);
    generatedPrompt += before;

    const raw = match[0];
    const placeholder = rawToPlaceholder.get(raw);
    const value = state.placeholderValues.get(placeholder.key) || "";
    const displayValue = value.length > 0 ? value : raw;
    appendPreviewPlaceholder(displayValue, placeholder, value.length > 0);
    generatedPrompt += displayValue;
    cursor = match.index + raw.length;
  }

  const after = promptTemplate.slice(cursor);
  appendPreviewText(after);
  generatedPrompt += after;
  elements.generatedPrompt.value = generatedPrompt;
}

function appendPreviewText(text) {
  if (text) {
    elements.promptPreview.append(document.createTextNode(text));
  }
}

function appendPreviewPlaceholder(text, placeholder, isFilled) {
  const span = document.createElement("span");
  span.className = isFilled ? "preview-placeholder is-filled" : "preview-placeholder";
  span.style.setProperty("--placeholder-color", placeholder.color);
  span.textContent = text;
  elements.promptPreview.append(span);
}

function autoGrow(control) {
  control.style.height = "auto";
  control.style.height = `${Math.min(control.scrollHeight, 220)}px`;
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

function closeModal() {
  elements.modal.hidden = true;
  elements.modalBackdrop.hidden = true;
  document.body.classList.remove("modal-open");
  state.selectedTemplate = null;
  state.placeholderValues = new Map();
  state.placeholderMeta = [];
  elements.placeholderForm.innerHTML = "";
  elements.promptPreview.innerHTML = "";
  elements.generatedPrompt.value = "";
  elements.copyFeedback.textContent = "";
  elements.copyFeedback.removeAttribute("data-state");
  markSelectedTemplate(null);

  if (state.selectedTrigger && typeof state.selectedTrigger.focus === "function") {
    state.selectedTrigger.focus();
  }
  state.selectedTrigger = null;
}

function handleGlobalKeydown(event) {
  if (elements.modal.hidden) {
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    closeModal();
    return;
  }

  if (event.key === "Tab") {
    trapModalFocus(event);
  }
}

function trapModalFocus(event) {
  const focusableElements = Array.from(elements.modal.querySelectorAll(FOCUSABLE_SELECTOR))
    .filter((element) => element.offsetParent !== null);

  if (focusableElements.length === 0) {
    event.preventDefault();
    return;
  }

  const first = focusableElements[0];
  const last = focusableElements[focusableElements.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function focusFirstModalControl() {
  const firstControl = elements.modal.querySelector(".placeholder-control") || elements.closeModal;
  firstControl.focus();
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

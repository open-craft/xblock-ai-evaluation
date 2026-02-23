/* Javascript for lock-aware Studio editor behavior on API key fields. */
function AIEvalStudioEditor(runtime, element, data) {
    "use strict";

    StudioEditableXBlockMixin(runtime, element);

    var rootElement = (element && element[0]) ? element[0] : element;
    if (!rootElement || typeof rootElement.querySelector !== "function") {
        return;
    }

    var modelField = rootElement.querySelector("#xb-field-edit-model");
    var modelApiKeyField = rootElement.querySelector("#xb-field-edit-model_api_key");
    var judge0ApiKeyField = rootElement.querySelector("#xb-field-edit-judge0_api_key");
    var modelApiKeyLabel = rootElement.querySelector("label[for='xb-field-edit-model_api_key']");
    var judge0ApiKeyLabel = rootElement.querySelector("label[for='xb-field-edit-judge0_api_key']");

    var useCustomService = Boolean(data && data.use_custom_llm_service);
    var modelKeyPresence = (data && data.model_key_presence) || {};
    var lockBadgeClass = "ai-eval-lock-badge";
    var lockedEntryClass = "ai-eval-locked-entry";

    var setDisabled = function(field, disabled) {
        if (!field) {
            return;
        }

        field.disabled = Boolean(disabled);
        if (field.disabled) {
            field.setAttribute("aria-disabled", "true");
        } else {
            field.removeAttribute("aria-disabled");
        }

        var settingEntry = field.closest("li");
        if (!settingEntry) {
            return;
        }

        if (field.disabled) {
            settingEntry.classList.add(lockedEntryClass);
        } else {
            settingEntry.classList.remove(lockedEntryClass);
        }
    };

    var setLockBadge = function(label, locked) {
        if (!label) {
            return;
        }

        var badge = label.querySelector("." + lockBadgeClass);
        if (locked) {
            if (!badge) {
                badge = document.createElement("span");
                badge.className = lockBadgeClass;
                badge.textContent = " (Locked by admin)";
                label.appendChild(badge);
            }
            return;
        }

        if (badge) {
            badge.remove();
        }
    };

    var getSelectedModel = function() {
        if (modelField && typeof modelField.value === "string") {
            return modelField.value;
        }
        return (data && data.initial_model) || "";
    };

    var isModelApiKeyLocked = function(model) {
        if (useCustomService) {
            return true;
        }
        if (Object.prototype.hasOwnProperty.call(modelKeyPresence, model)) {
            return Boolean(modelKeyPresence[model]);
        }
        return Boolean(data && data.lock_model_api_key_initial);
    };

    var syncModelApiKeyLock = function() {
        var isLocked = isModelApiKeyLocked(getSelectedModel());
        setDisabled(modelApiKeyField, isLocked);
        setLockBadge(modelApiKeyLabel, isLocked);
    };

    var judge0Locked = Boolean(data && data.lock_judge0_api_key);
    setDisabled(judge0ApiKeyField, judge0Locked);
    setLockBadge(judge0ApiKeyLabel, judge0Locked);
    syncModelApiKeyLock();

    if (modelField) {
        modelField.addEventListener("change", syncModelApiKeyLock);
    }
}

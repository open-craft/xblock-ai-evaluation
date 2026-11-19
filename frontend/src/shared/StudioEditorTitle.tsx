import React, { useState } from "react";
import { useIntl } from "react-intl";
import { Form, Icon, IconButton } from "@openedx/paragon";
import { Edit } from "@openedx/paragon/icons";

interface StudioEditorTitleProps {
  displayName: string;
  onDisplayNameChange: (nextDisplayName: string) => void;
}

/**
 * The editor's heading: the component name, with a pencil button that turns it into a text input.
 * The name is saved with the rest of the form. Enter or leaving the input keeps the new name; Escape restores
 * the name it had before editing.
 */
export function StudioEditorTitle({ displayName, onDisplayNameChange }: StudioEditorTitleProps) {
  const intl = useIntl();
  const [nameBeforeEditing, setNameBeforeEditing] = useState<string | null>(null);
  const editLabel = intl.formatMessage({
    id: "studio.editorTitle.editName",
    defaultMessage: "Edit component name",
  });

  if (nameBeforeEditing === null) {
    return (
      <div className="ai-eval-studio-title">
        <h2 className="ai-eval-studio-title__name">{displayName}</h2>
        <IconButton
          src={Edit}
          iconAs={Icon}
          alt={editLabel}
          size="sm"
          variant="primary"
          onClick={() => setNameBeforeEditing(displayName)}
        />
      </div>
    );
  }

  return (
    <div className="ai-eval-studio-title">
      <Form.Control
        className="ai-eval-studio-title__input"
        aria-label={intl.formatMessage({
          id: "studio.editorTitle.componentName",
          defaultMessage: "Component name",
        })}
        autoFocus
        value={displayName}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => onDisplayNameChange(event.target.value)}
        onBlur={() => setNameBeforeEditing(null)}
        onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
          if (event.key === "Enter") {
            event.preventDefault();
            setNameBeforeEditing(null);
          } else if (event.key === "Escape") {
            onDisplayNameChange(nameBeforeEditing);
            setNameBeforeEditing(null);
          }
        }}
      />
    </div>
  );
}

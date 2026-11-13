import React, { useState } from "react";
import {
  Form, IconButton, ModalDialog, Nav,
} from "@openedx/paragon";
import { EditOutline } from "@openedx/paragon/icons";

import { ValidationErrors } from "./studio";

export interface StudioHeaderProps {
  activeTab: string;
  onTitleChange: (title: string) => void;
  showJsonTab: boolean;
  title: string;
  validationErrors?: ValidationErrors;
}

/**
 * Shared Studio modal header with an inline editable title and, when JSON
 * editing is enabled, the Settings/JSON tab switcher.
 */
export function StudioHeader({
  activeTab,
  onTitleChange,
  showJsonTab,
  title,
  validationErrors,
}: StudioHeaderProps) {
  const [isEditingName, setIsEditingName] = useState(false);

  return (
    <ModalDialog.Header className="shadow-sm studio-header">
      <div className="d-flex flex-row justify-content-between">
        {isEditingName ? (
          <Form.Group
            controlId="xb-field-edit-display_name"
            isInvalid={Boolean(validationErrors?.display_name)}
            className="title-edit-group"
          >
            <Form.Control
              type="text"
              name="studio-title"
              aria-label="Display name"
              autoFocus
              value={title}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => onTitleChange(event.target.value)}
              onBlur={() => setIsEditingName(false)}
              onKeyDown={(event: React.KeyboardEvent) => {
                if (event.key === "Enter" || event.key === "Escape") {
                  setIsEditingName(false);
                  event.preventDefault();
                }
              }}
            />
          </Form.Group>
        ) : (
          <h3 className="h3 col pl-0">
            <div className="d-flex flex-row align-items-center mt-1">
              Editing: {title}
              <IconButton
                alt="Edit display name"
                className="studio-header-title-edit"
                size="sm"
                src={EditOutline}
                onClick={() => setIsEditingName(true)}
              />
            </div>
          </h3>
        )}
        {showJsonTab && (
          // Both tabs stay in the Tab order so keyboard users can move from
          // Settings straight to JSON instead of landing in the panel content.
          <Nav
            role="tablist"
            variant="button-group"
            activeKey={activeTab}
            className="studio-header-tabs-nav pgn__tabs"
            aria-label="Editor Sections"
          >
            <Nav.Link
              as="button"
              type="button"
              eventKey="settings"
            >
              Settings
            </Nav.Link>
            <Nav.Link
              as="button"
              type="button"
              eventKey="json"
            >
              JSON
            </Nav.Link>
          </Nav>
        )}
      </div>
    </ModalDialog.Header>
  );
}

export default StudioHeader;

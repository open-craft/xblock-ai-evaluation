import React from "react";
import { ModalDialog, Nav } from "@openedx/paragon";

import { StudioEditorTitle } from "./StudioEditorTitle";
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
  return (
    <ModalDialog.Header className="shadow-sm studio-header">
      <div className="d-flex flex-row justify-content-between align-items-center w-100">
        <StudioEditorTitle
          displayName={title}
          onDisplayNameChange={onTitleChange}
          isInvalid={Boolean(validationErrors?.display_name)}
        />
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

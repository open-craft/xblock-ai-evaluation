import React from "react";
import { FormattedMessage } from "react-intl";

import { SharedPayload, UnknownRecord } from "./types";

interface StudioPlaceholderProps {
  blockKind: string;
  payload: SharedPayload<UnknownRecord, UnknownRecord, UnknownRecord>;
  title: React.ReactNode;
}

export default function StudioPlaceholder({
  blockKind,
  payload,
  title,
}: StudioPlaceholderProps) {
  const initialState = payload.initial_state || {};
  const meta = payload.meta || {};

  return (
    <section
      className="ai-eval-react-shell ai-eval-react-shell--studio"
      data-block-kind={blockKind}
      data-view={payload.view}
    >
      <h3>{title}</h3>
      <div className="ai-eval-react-shell__meta">
        <span>
          <FormattedMessage
            id="shared.studio.view"
            defaultMessage="View: {view}"
            values={{ view: String(payload.view || "studio") }}
          />
        </span>
        <span>
          <FormattedMessage
            id="shared.studio.editableFields"
            defaultMessage="Editable fields: {count}"
            values={{ count: Object.keys(initialState).length }}
          />
        </span>
        <span>
          <FormattedMessage
            id="shared.studio.metadataEntries"
            defaultMessage="Metadata entries: {count}"
            values={{ count: Object.keys(meta).length }}
          />
        </span>
      </div>
    </section>
  );
}

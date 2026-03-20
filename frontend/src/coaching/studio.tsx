import React from "react";
import { FormattedMessage } from "react-intl";

import { makeXBlockInitializer } from "../shared/mountApp";
import StudioPlaceholder from "../shared/StudioPlaceholder";
import { SharedPayload, UnknownRecord, XBlockRuntime } from "../shared/types";

interface StudioHandlerUrls extends UnknownRecord {
  studio_submit?: string;
}

type StudioPayload = SharedPayload<StudioHandlerUrls, UnknownRecord, UnknownRecord>;
type StudioPayloadInput = Partial<StudioPayload>;

function normalizePayload(
  runtime: XBlockRuntime,
  element: Element,
  data: unknown,
): StudioPayload {
  const payloadData = (data || {}) as StudioPayloadInput;

  return {
    view: payloadData.view || "studio",
    handler_urls: payloadData.handler_urls || {
      studio_submit: runtime.handlerUrl(element, "studio_submit"),
    },
    initial_state: payloadData.initial_state || {},
    meta: payloadData.meta || {},
  };
}

const initializer = makeXBlockInitializer(
  function CoachingStudioPlaceholder({ payload }: { payload: StudioPayload }) {
    return (
      <StudioPlaceholder
        blockKind="coaching"
        payload={payload}
        title={
          <FormattedMessage
            id="coaching.studio.title"
            defaultMessage="Coaching Studio Shell"
          />
        }
      />
    );
  },
  (runtime, element, data) => {
    return { payload: normalizePayload(runtime, element, data) };
  },
);

const globalWindow = window as Window & {
  CoachAIEvalXBlockStudio?: typeof initializer;
};

globalWindow.CoachAIEvalXBlockStudio = initializer;

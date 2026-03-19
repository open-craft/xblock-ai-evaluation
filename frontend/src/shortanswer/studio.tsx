import React from "react";
import { FormattedMessage } from "react-intl";

import { makeXBlockInitializer } from "../shared/mountApp";
import StudioPlaceholder from "../shared/StudioPlaceholder";
import { SharedPayload, UnknownRecord, XBlockRuntime } from "../shared/types";

interface StudioHandlerUrls extends UnknownRecord {
  studio_submit?: string;
}

type StudioPayload = SharedPayload<StudioHandlerUrls, UnknownRecord, UnknownRecord>;
type StudioLegacyData = Partial<StudioPayload>;

function normalizePayload(
  runtime: XBlockRuntime,
  element: Element,
  data: unknown,
): StudioPayload {
  const payloadData = (data || {}) as StudioLegacyData;

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
  function ShortAnswerStudioPlaceholder({ payload }: { payload: StudioPayload }) {
    return (
      <StudioPlaceholder
        blockKind="shortanswer"
        payload={payload}
        title={
          <FormattedMessage
            id="shortanswer.studio.title"
            defaultMessage="Short Answer Studio Shell"
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
  AIEvalReactXBlocks?: Record<string, typeof initializer>;
  ShortAnswerAIEvalXBlockStudio?: typeof initializer;
};

globalWindow.AIEvalReactXBlocks = globalWindow.AIEvalReactXBlocks || {};
globalWindow.AIEvalReactXBlocks.shortanswerStudio = initializer;
globalWindow.ShortAnswerAIEvalXBlockStudio = initializer;

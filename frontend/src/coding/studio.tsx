import React from "react";
import { FormattedMessage } from "react-intl";

import { makeXBlockInitializer } from "../shared/mountApp";
import StudioPlaceholder from "../shared/StudioPlaceholder";
import { SharedPayload, UnknownRecord, XBlockElementLike, XBlockRuntime } from "../shared/types";

interface StudioHandlerUrls extends UnknownRecord {
  studio_submit?: string;
}

type StudioPayload = SharedPayload<StudioHandlerUrls, UnknownRecord, UnknownRecord>;
type StudioPayloadInput = Partial<StudioPayload>;

function normalizePayload(
  runtime: XBlockRuntime,
  element: XBlockElementLike,
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
  function CodingStudioPlaceholder({ payload }: { payload: StudioPayload }) {
    return (
      <StudioPlaceholder
        blockKind="coding"
        payload={payload}
        title={<FormattedMessage id="coding.studio.title" defaultMessage="Coding Studio Shell" />}
      />
    );
  },
  (runtime, element, data) => {
    return { payload: normalizePayload(runtime, element, data) };
  },
);

const globalWindow = window as Window & {
  CodingAIEvalXBlockStudio?: typeof initializer;
};

globalWindow.CodingAIEvalXBlockStudio = initializer;

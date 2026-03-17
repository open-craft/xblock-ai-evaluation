import React from "react";

export default function StudioPlaceholder(props) {
  var payload = props.payload;
  var initialState = payload.initial_state || {};
  var meta = payload.meta || {};

  return React.createElement(
    "section",
    {
      className: "ai-eval-react-shell ai-eval-react-shell--studio",
      "data-block-kind": props.blockKind,
      "data-view": payload.view,
    },
    [
      React.createElement(
        "h3",
        { key: "title" },
        props.title,
      ),
      React.createElement(
        "div",
        {
          key: "meta",
          className: "ai-eval-react-shell__meta",
        },
        [
          React.createElement(
            "span",
            { key: "view" },
            "View: " + String(payload.view || "studio"),
          ),
          React.createElement(
            "span",
            { key: "fields" },
            "Editable fields: " + String(Object.keys(initialState).length),
          ),
          React.createElement(
            "span",
            { key: "choices" },
            "Metadata entries: " + String(Object.keys(meta).length),
          ),
        ],
      ),
    ],
  );
}

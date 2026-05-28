import { useIntl } from "react-intl";
import { Icon } from "@openedx/paragon";
import React from "react";
import { AutoAwesome } from "@openedx/paragon/icons";

// A small "Powered by AI" badge
export const PoweredByAI = () => {
  const intl = useIntl();

  return (
    <div className="d-flex ml-2 mt-3 text-gray-500">
      <Icon className="mr-1" src={AutoAwesome} size="sm" />
      <span>{intl.formatMessage({
        id: "shortanswer.student.poweredBy",
        defaultMessage: "Powered by AI",
      })}</span>
    </div>
  );
};

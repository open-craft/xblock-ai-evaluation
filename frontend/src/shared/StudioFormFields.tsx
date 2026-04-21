import React from "react";
import { Form } from "@openedx/paragon";
import { StudioFieldMetadata } from "./types";

export function FieldErrors({ errors }: { errors?: string[] }) {
  if (!errors || errors.length === 0) {
    return null;
  }

  return (
    <>
      {errors.map((error, index) => (
        <Form.Control.Feedback key={String(index)} type="invalid">
          {error}
        </Form.Control.Feedback>
      ))}
    </>
  );
}

export function FieldHelp({ metadata }: { metadata?: StudioFieldMetadata }) {
  if (!metadata?.help) {
    return null;
  }

  return <Form.Text>{metadata.help}</Form.Text>;
}

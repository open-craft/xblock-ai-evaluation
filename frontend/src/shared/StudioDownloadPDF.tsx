import React, { ChangeEvent } from "react";
import { Form } from "@openedx/paragon";
import { FieldErrors } from "./StudioFormFields";

interface Values {
    allowed: boolean;
    title: string;
    description: string;
}

interface Errors {
    allowed: string[];
    title: string[];
    description: string[];
}

interface StudioDownloadPDFFieldsProps {
    // a formik update wrapper
    onChange: (fieldName: string, nextValue: unknown) => void;
    values: Values,
    errors: Errors,
}

export const StudioDownloadPDFField = ({onChange, values, errors}: StudioDownloadPDFFieldsProps) => (
    <div>
        <Form.Group>
            <Form.Label>PDF Download</Form.Label>
            <Form.RadioSet isInline onChange={(e: ChangeEvent<HTMLInputElement>) => {
                onChange("pdf_download_allowed", e.target.value == "allow")
            }} value={values.allowed ? "allow" : "disallow"}>
                <Form.Radio value="allow">Allow</Form.Radio>
                <Form.Radio value="disallow">Disallow</Form.Radio>
            </Form.RadioSet>
            <FieldErrors errors={errors.allowed} />
            <Form.Text>Allow learners to download a PDF of their work</Form.Text>
        </Form.Group>

        {values.allowed &&
            <>
                <Form.Group>
                    <Form.Label>Download Section Title</Form.Label>
                    <Form.Control
                        value={values.title}
                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                            onChange("pdf_download_title", e.target.value)
                        }
                    />
                    <FieldErrors errors={errors.title} />
                </Form.Group>

                <Form.Group>
                    <Form.Label>Download Description (optional)</Form.Label>
                    <Form.Control
                        value={values.description}
                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                            onChange("pdf_download_description", e.target.value)
                        }
                    />
                    <FieldErrors errors={errors.description} />
                </Form.Group>
            </>
        }
    </div>
);

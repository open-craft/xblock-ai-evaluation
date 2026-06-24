import React from "react";
import { Button, Col, Icon, Row } from "@openedx/paragon";
import { Download } from "@openedx/paragon/icons";

interface DownloadPDFSectionProps {
    pdfUrl: string;
    title: string;
    description: string;
}

export const DownloadPDFSection = ({pdfUrl, title, description}: DownloadPDFSectionProps) => (
    <Row className='pdf-download-section p-3'>
        <Col>
            <h3>{title}</h3>
            {description && <p>{description}</p>}
            <Button target='_blank' href={pdfUrl}><Icon src={Download} /> Download</Button>
        </Col>
    </Row>
);

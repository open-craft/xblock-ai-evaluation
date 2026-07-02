import React from "react";
import { Button, Col, Icon, Row } from "@openedx/paragon";
import { Download } from "@openedx/paragon/icons";

interface DownloadPDFSectionProps {
    pdfUrl: string;
    title: string;
    description: string;
}

export const DownloadPDFSection = ({pdfUrl, title, description}: DownloadPDFSectionProps) => (
    <Row className='p-4.5 mx-0 rounded mt-4.5 border border-gray-400 bg-gray-200'>
        <Col>
            <h5>{title}</h5>
            {description && <p>{description}</p>}
            <Button variant="secondary" size="sm" target='_blank' href={pdfUrl}><Icon src={Download} className='mr-2' /> Download</Button>
        </Col>
    </Row>
);

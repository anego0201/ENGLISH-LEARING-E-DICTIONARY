#!/usr/bin/env node
/**
 * Generates a valid multi-page PDF in public/samples/sample.pdf
 * containing vocabulary from data/raw/dictionary.sample.csv
 * and hyphenated line breaks to verify offline rendering and highlighting.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public', 'samples');

const contentPage1 =
  'BT /F1 20 Tf 50 740 Td (E-Dic Reader - Sample Document) Tj ET ' +
  'BT /F1 12 Tf 50 700 Td (This is an accurate and compre-) Tj ET ' +
  'BT /F1 12 Tf 50 680 Td (hensive analysis of an inevitable, subtle, and ubi-) Tj ET ' +
  'BT /F1 12 Tf 50 660 Td (quitous phenomenon in modern literature.) Tj ET ' +
  'BT /F1 12 Tf 50 620 Td (We should acknowledge that meticulous scrutiny can mitigate) Tj ET ' +
  'BT /F1 12 Tf 50 600 Td (apparent and profound ambiguities.) Tj ET';

const contentPage2 =
  'BT /F1 20 Tf 50 740 Td (Page 2: Advanced Vocabulary) Tj ET ' +
  'BT /F1 12 Tf 50 700 Td (The eloquent speaker presented an ephemeral notion with) Tj ET ' +
  'BT /F1 12 Tf 50 680 Td (an elaborate paradigm to diminish reluctant behavior.) Tj ET ' +
  'BT /F1 12 Tf 50 640 Td (It is evident that adequate ability allows one to perceive) Tj ET ' +
  'BT /F1 12 Tf 50 620 Td (coherent ideas and contemplate complex concepts.) Tj ET';

const stream1 = `<< /Length ${contentPage1.length} >>\nstream\n${contentPage1}\nendstream`;
const stream2 = `<< /Length ${contentPage2.length} >>\nstream\n${contentPage2}\nendstream`;

const pdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 5 0 R /Resources << /Font << /F1 7 0 R >> >> >> endobj
4 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >> endobj
5 0 obj ${stream1} endobj
6 0 obj ${stream2} endobj
7 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 8
0000000000 65535 f 
trailer << /Size 8 /Root 1 0 R >>
startxref
10
%%EOF
`;

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'sample.pdf'), pdf, 'latin1');
console.log('✔ public/samples/sample.pdf created');
